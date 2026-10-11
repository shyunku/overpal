-- PalHelperMod
-- Reads base storage (chests, production outputs, guild storage, level pickups) from the
-- running dedicated server and writes it to base_storage.json next to this mod.
-- How the objects are linked is documented in docs/game-internals.md.

local FIRST_DELAY_MS = 30000
local REFRESH_MS = 10000
-- also write the raw containers/modules/buildings lists (for investigation)
local DEBUG_DUMP = false

local ZERO_GUID = "00000000-00000000-00000000-00000000"

local KIND_BY_MODEL_CLASS = {
    PalMapObjectItemChestModel = "chest",
    PalMapObjectGuildChestModel = "guildChest",
    PalMapObjectConvertItemModel = "production",
    -- small stones, branches, berry bushes placed on the map (not stored by players)
    PalMapObjectPickupItemOnLevelModel = "pickup",
}

-- ---------------------------------------------------------------- output location
local function mod_dir()
    local src = debug.getinfo(1, "S").source or ""
    src = src:gsub("^@", ""):gsub("\\", "/")
    local dir = src:match("^(.*)/Scripts/[^/]+$")
    if dir then return dir .. "/" end
    -- UE4SS runs with the ue4ss folder as the working directory
    return "Mods/PalHelperMod/"
end

local DIR = mod_dir()

local function write_file(name, text)
    local tmp = DIR .. name .. ".tmp"
    local f = io.open(tmp, "w")
    if not f then return false end
    f:write(text)
    f:close()
    -- replace in one step so readers never see a half-written file
    os.remove(DIR .. name)
    return os.rename(tmp, DIR .. name)
end

local errors = {}
local function log_error(where, err)
    if #errors < 50 then
        errors[#errors + 1] = where .. ": " .. tostring(err)
    end
end

-- ---------------------------------------------------------------- json
local function esc(s)
    return (tostring(s):gsub('[%c"\\]', function(c)
        return string.format("\\u%04x", c:byte())
    end))
end

local function to_json(v)
    local t = type(v)
    if t == "table" then
        if #v > 0 or next(v) == nil then
            local parts = {}
            for _, x in ipairs(v) do parts[#parts + 1] = to_json(x) end
            return "[" .. table.concat(parts, ",") .. "]"
        end
        local keys = {}
        for k in pairs(v) do keys[#keys + 1] = k end
        table.sort(keys)
        local parts = {}
        for _, k in ipairs(keys) do
            parts[#parts + 1] = '"' .. esc(k) .. '":' .. to_json(v[k])
        end
        return "{" .. table.concat(parts, ",") .. "}"
    elseif t == "number" or t == "boolean" then
        return tostring(v)
    elseif v == nil then
        return "null"
    end
    return '"' .. esc(v) .. '"'
end

-- ---------------------------------------------------------------- readers
local function hex32(n)
    return string.format("%08X", n & 0xFFFFFFFF)
end

local function guid_of(g)
    local ok, s = pcall(function()
        return hex32(g.A) .. "-" .. hex32(g.B) .. "-" .. hex32(g.C) .. "-" .. hex32(g.D)
    end)
    if ok then return s end
    return nil
end

local function try(where, fn)
    local ok, res = pcall(fn)
    if ok then return res end
    log_error(where, res)
    return nil
end

local function read_items(container)
    local items = {}
    local arr = container.ItemSlotArray
    for i = 1, #arr do
        local s = arr[i]
        if s and s:IsValid() then
            local slot = try("slot", function()
                return { index = s.SlotIndex, item = s.ItemId.StaticId:ToString(), count = s.StackCount }
            end)
            if slot and slot.item ~= "None" and slot.count and slot.count > 0 then
                items[#items + 1] = slot
            end
        end
    end
    return items, #arr
end

-- container id -> { kind, modelClass, modelRef }
local function collect_modules()
    local by_container = {}
    for _, m in ipairs(FindAllOf("PalMapObjectItemContainerModule") or {}) do
        if m:IsValid() then
            local cid = try("module container", function() return guid_of(m.TargetContainer.ID.ID) end)
            local model = try("module outer", function() return m:GetOuter() end)
            if cid and model and model:IsValid() then
                local cls = model:GetClass():GetFName():ToString()
                by_container[cid] = {
                    modelClass = cls,
                    kind = KIND_BY_MODEL_CLASS[cls] or "other",
                    -- concrete model -> map object actor link
                    modelRef = try("model ref", function() return guid_of(model.ModelInstanceId) end),
                }
            end
        end
    end
    return by_container
end

-- map object model instance id -> { location, buildObjectId }
local function collect_buildings()
    local by_model = {}
    for _, a in ipairs(FindAllOf("PalBuildObject") or {}) do
        if a:IsValid() then
            local id = try("building id", function() return guid_of(a.ModelInstanceId) end)
            if id then
                local loc = a:K2_GetActorLocation()
                by_model[id] = {
                    location = { x = loc.X, y = loc.Y, z = loc.Z },
                    buildObjectId = try("build object id", function() return a.BuildObjectId:ToString() end),
                }
            end
        end
    end
    return by_model
end

local function collect_storages(modules, buildings)
    local storages = {}
    local raw = {}
    for _, c in ipairs(FindAllOf("PalItemContainer") or {}) do
        if c:IsValid() then
            local id = try("container id", function() return guid_of(c.ID.ID) end)
            local group = try("container group", function() return guid_of(c.BelongInfo.GroupId) end)
            local items, slot_count = read_items(c)
            if DEBUG_DUMP then
                raw[#raw + 1] = { id = id, group = group, slotCount = slot_count, items = items }
            end
            if id and group and group ~= ZERO_GUID then
                local m = modules[id]
                local entry = {
                    containerId = id,
                    group = group,
                    slotCount = slot_count,
                    items = items,
                }
                if m then
                    entry.kind = m.kind
                    entry.modelClass = m.modelClass
                    local b = m.modelRef and buildings[m.modelRef]
                    if b then
                        entry.location = b.location
                        entry.buildObjectId = b.buildObjectId
                    end
                else
                    -- the guild-wide storage has no owning map object
                    entry.kind = "guildStorage"
                end
                storages[#storages + 1] = entry
            end
        end
    end
    return storages, raw
end

local function tick()
    errors = {}
    local started = os.clock()
    local ok, err = pcall(function()
        local modules = collect_modules()
        local buildings = collect_buildings()
        local storages, raw = collect_storages(modules, buildings)
        write_file("base_storage.json", to_json({ version = 1, updatedAt = os.time(), storages = storages }))
        if DEBUG_DUMP then
            write_file("debug_containers.json", to_json({ containers = raw }))
        end
    end)
    if not ok then log_error("tick", err) end
    write_file("status.json", to_json({
        updatedAt = os.time(),
        ok = ok and #errors == 0,
        elapsedMs = math.floor((os.clock() - started) * 1000),
        errors = errors,
    }))
end

print("[PalHelperMod] loaded, output: " .. DIR)
ExecuteWithDelay(FIRST_DELAY_MS, function()
    LoopAsync(REFRESH_MS, function()
        ExecuteInGameThread(tick)
        return false
    end)
end)
