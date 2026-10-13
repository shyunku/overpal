-- OverpalMod (Overpal's server mod)
-- Reads base storage (chests, production buildings, guild storage, items dropped by players,
-- level pickups) from the
-- running dedicated server and writes it to base_storage.json next to this mod.
-- How the objects are linked is documented in docs/game-internals.md.

local FIRST_DELAY_MS = 30000
-- full rescan: new/removed containers (dropped items), locations
local REFRESH_MS = 10000
-- containers flagged by the update hook are re-read this often
local FAST_MS = 250
-- called whenever a building's storage updates (also once a second for chests with timers)
local UPDATE_HOOK = "/Script/Pal.PalMapObjectItemContainerModule:OnUpdateContents"
-- also write the raw containers/modules/buildings lists (for investigation)
local DEBUG_DUMP = false
-- How often buildings replicate to clients (class default of PalBuildObject, 3 in the game).
-- The replication graph fixes each class's rate when it first sees the class, so this must be
-- set at startup. Higher makes build/craft progress bars smoother and costs more server CPU;
-- clients get at most about 20 updates a second, so values above 20 only cost CPU.
-- 0 leaves the game's value. See docs/game-internals.md, "작업 진행도 복제".
local BUILD_NET_UPDATE_HZ = 20

-- Stall log: a game-thread callback every STALL_WATCH_MS notes when it comes STALL_WARN_MS or
-- more late, i.e. the server did nothing else for that long. Lines go to stalls.txt
-- ("HH:MM:SS <late ms>[ scan]", "scan" when this mod's full scan ran in that time); the app
-- server prints them as warnings.
local STALL_WATCH_MS = 50
local STALL_WARN_MS = 50
local STALL_FILE = "stalls.txt"

local ZERO_GUID = "00000000-00000000-00000000-00000000"

local KIND_BY_MODEL_CLASS = {
    PalMapObjectItemChestModel = "chest",
    -- refrigerator (slows food decay)
    PalMapObjectItemChest_AffectCorruption = "chest",
    -- feed boxes and the medicine shelf hold items players put in
    PalMapObjectPalFoodBoxModel = "chest",
    PalMapObjectPalMedicineBoxModel = "chest",
    PalMapObjectGuildChestModel = "guildChest",
    PalMapObjectConvertItemModel = "production",
    -- output storage of quarries, logging sites, coal mines and oil pumps
    PalMapObjectProductItemModel = "production",
    -- items a player dropped on the ground
    PalMapObjectDropItemModel = "dropped",
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
    return "Mods/OverpalMod/"
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

local function append_line(name, line)
    local f = io.open(DIR .. name, "a")
    if not f then return end
    f:write(line, "\n")
    f:close()
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

-- production building's model by buildObjectId, filled by the full scan: the fast tick re-reads
-- what is left to make when that building's storage changes (else "made" moves on its own)
local production_models = {}

-- Building entry for the main window's "mine" structures: id, name given in game, location,
-- guild, and for production buildings what they make and how far along it is.
-- `progress`: work progress by concrete model address (work_progress_by_model).
local function building_entry(a, id, model, location, custom_name, progress)
    local entry = { buildObjectId = id, group = guid_of(model.GroupIdBelongTo), location = location, customName = custom_name }
    local concrete = model.ConcreteModel
    if concrete and concrete:IsValid() and concrete:GetClass():GetFName():ToString() == "PalMapObjectConvertItemModel" then
        local recipe = concrete.CurrentRecipeId:ToString()
        if recipe ~= "None" then
            local w = progress[concrete:GetAddress()]
            production_models[id] = concrete
            entry.production = {
                recipe = recipe,
                requested = concrete.RequestedProductNum,
                remain = concrete.RemainProductNum,
                work = w and w.CurrentWorkAmount or 0,
                workRequired = w and w.RequiredWorkAmount or 0,
            }
        end
    end
    return entry
end

local function work_progress_by_model()
    local progress = {}
    for _, w in ipairs(FindAllOf("PalWorkProgress") or {}) do
        pcall(function()
            local m = w.CachedOwnerMapObjectConcreteModel
            if m and m:IsValid() then progress[m:GetAddress()] = w end
        end)
    end
    return progress
end

-- map object model instance id -> { location, buildObjectId, customName }
-- Actor classes whose location is looked up: buildings and items dropped on the ground.
local LOCATED_ACTOR_CLASSES = { "PalBuildObject", "PalMapObjectCommonDropItem3D" }

-- Also returns the guild buildings (building_entry), read in the same pass over the actors.
local function collect_actor_locations()
    production_models = {}
    local by_model = {}
    local buildings = {}
    local progress = work_progress_by_model()
    for _, class_name in ipairs(LOCATED_ACTOR_CLASSES) do
        for _, a in ipairs(FindAllOf(class_name) or {}) do
            if a:IsValid() then
                local id = try("actor id", function() return guid_of(a.ModelInstanceId) end)
                if id then
                    local loc = a:K2_GetActorLocation()
                    local entry = { location = { x = loc.X, y = loc.Y, z = loc.Z } }
                    if class_name == "PalBuildObject" then
                        entry.buildObjectId = try("build object id", function() return a.BuildObjectId:ToString() end)
                        -- the name players give a building (e.g. a chest) in game, empty if none
                        local model = a.MapObjectModel
                        local name = try("custom name", function() return model.CustomName:ToString() end)
                        if name and name ~= "" then entry.customName = name end
                        if entry.buildObjectId and entry.buildObjectId ~= "None" then
                            local b = try("building", function()
                                return building_entry(a, entry.buildObjectId, model, entry.location, entry.customName, progress)
                            end)
                            if b then buildings[#buildings + 1] = b end
                        end
                    end
                    by_model[id] = entry
                end
            end
        end
    end
    return by_model, buildings
end

local function collect_storages(modules, buildings)
    local storages = {}
    local raw = {}
    local objects = {}
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
                        entry.customName = b.customName
                    end
                else
                    -- the guild-wide storage has no owning map object
                    entry.kind = "guildStorage"
                end
                storages[#storages + 1] = entry
                objects[id] = c
            end
        end
    end
    return storages, raw, objects
end

-- ---------------------------------------------------------------- change push
-- The last full scan, kept so a single container can be refreshed without scanning again.
local current = { storages = {}, byId = {}, objects = {}, buildings = {}, buildingsById = {} }
-- container ids flagged by the update hook since the last fast tick
local dirty = {}
local hooked = false
local seq = 0

local function write_storage()
    seq = seq + 1
    write_file("base_storage.json", to_json({ version = 1, updatedAt = os.time(), seq = seq, storages = current.storages, buildings = current.buildings }))
end

local function set_current(storages, objects, buildings)
    local by_id = {}
    for _, s in ipairs(storages) do by_id[s.containerId] = s end
    local buildings_by_id = {}
    for _, b in ipairs(buildings) do buildings_by_id[b.buildObjectId] = b end
    current = { storages = storages, byId = by_id, objects = objects, buildings = buildings, buildingsById = buildings_by_id }
end

local function try_hook()
    if hooked then return end
    local ok, err = pcall(function()
        RegisterHook(UPDATE_HOOK, function(self)
            pcall(function()
                local id = guid_of(self:get().TargetContainer.ID.ID)
                if id then dirty[id] = true end
            end)
        end)
    end)
    hooked = ok
    if not ok then log_error("hook", err) end
end

-- re-read the flagged containers and write the file only when something actually changed
local function fast_tick()
    if next(dirty) == nil then return end
    local changed = false
    for id in pairs(dirty) do
        local entry, obj = current.byId[id], current.objects[id]
        if entry and obj and obj:IsValid() then
            local ok, items = pcall(read_items, obj)
            if ok and to_json(items) ~= to_json(entry.items) then
                entry.items = items
                changed = true
                -- a production building's storage: the order's counts moved with it
                local b = entry.buildObjectId and current.buildingsById[entry.buildObjectId]
                local model = entry.buildObjectId and production_models[entry.buildObjectId]
                if b and b.production and model then
                    pcall(function()
                        if model:IsValid() then
                            b.production.requested = model.RequestedProductNum
                            b.production.remain = model.RemainProductNum
                        end
                    end)
                end
            end
        end
    end
    dirty = {}
    if changed then write_storage() end
end

-- ---------------------------------------------------------------- development probe
-- Drop a probe.lua next to this mod to run it once on the game thread without restarting
-- the server. Its output goes to probe_out.txt and the script is renamed to probe.done.lua.
-- Anyone who can write to this folder can already change the mod itself.
local ENABLE_PROBE = true

-- properties of an object's class and its parents, as "Name : PropertyType" lines
local function list_props(obj, max_depth)
    local lines = {}
    local cls = obj:GetClass()
    local depth = 0
    while cls and cls:IsValid() and depth < (max_depth or 8) do
        local name = cls:GetFName():ToString()
        if name == "Object" or name == "Actor" then break end
        lines[#lines + 1] = "-- " .. name
        cls:ForEachProperty(function(prop)
            lines[#lines + 1] = ("   %s : %s"):format(prop:GetFName():ToString(), prop:GetClass():GetFName():ToString())
        end)
        cls = cls:GetSuperStruct()
        depth = depth + 1
    end
    return lines
end

local function run_probe()
    local path = DIR .. "probe.lua"
    local f = io.open(path, "r")
    if not f then return end
    f:close()
    local out = {}
    local env = setmetatable({
        out = function(...)
            local parts = {}
            for i = 1, select("#", ...) do parts[#parts + 1] = tostring(select(i, ...)) end
            out[#out + 1] = table.concat(parts, " ")
        end,
        guid_of = guid_of,
        list_props = list_props,
        to_json = to_json,
    }, { __index = _G })
    local chunk, load_err = loadfile(path, "t", env)
    if chunk then
        local ok, err = pcall(chunk)
        if not ok then out[#out + 1] = "error: " .. tostring(err) end
    else
        out[#out + 1] = "load error: " .. tostring(load_err)
    end
    os.remove(DIR .. "probe.done.lua")
    os.rename(path, DIR .. "probe.done.lua")
    write_file("probe_out.txt", table.concat(out, "\n"))
end

-- ---------------------------------------------------------------- building replication rate
-- class default rate after the change below; nil until applied
local build_rate = nil

-- Runs as soon as the mod loads, before any building class or the replication graph exists:
-- blueprint building classes copy the PalBuildObject default when they load.
local function raise_build_rate()
    local cls = StaticFindObject("/Script/Pal.PalBuildObject")
    if not cls or not cls:IsValid() then return false end
    local cdo = cls:GetCDO()
    cdo.NetUpdateFrequency = BUILD_NET_UPDATE_HZ
    cdo.MinNetUpdateFrequency = BUILD_NET_UPDATE_HZ
    build_rate = cdo.NetUpdateFrequency
    return true
end

-- end of the last full scan (os.clock), to tell the mod's own stalls apart
local scan_ended = -math.huge

local function tick()
    if ENABLE_PROBE then
        local ok, err = pcall(run_probe)
        if not ok then print("[OverpalMod] probe failed: " .. tostring(err)) end
    end
    errors = {}
    local started = os.clock()
    local ok, err = pcall(function()
        local modules = collect_modules()
        local located, buildings = collect_actor_locations()
        local storages, raw, objects = collect_storages(modules, located)
        set_current(storages, objects, buildings)
        dirty = {}
        write_storage()
        -- the hooked class exists once the world is loaded
        try_hook()
        if DEBUG_DUMP then
            write_file("debug_containers.json", to_json({ containers = raw }))
        end
    end)
    if not ok then log_error("tick", err) end
    scan_ended = os.clock()
    write_file("status.json", to_json({
        updatedAt = os.time(),
        ok = ok and #errors == 0,
        elapsedMs = math.floor((os.clock() - started) * 1000),
        hooked = hooked,
        buildNetUpdateHz = build_rate,
        errors = errors,
    }))
end

print("[OverpalMod] loaded, output: " .. DIR)
-- stalls of this run only
os.remove(DIR .. STALL_FILE)
local last_watch = nil
LoopInGameThreadWithDelay(STALL_WATCH_MS, function()
    local now = os.clock()
    if last_watch then
        local late = (now - last_watch) * 1000 - STALL_WATCH_MS
        if late >= STALL_WARN_MS then
            append_line(STALL_FILE, ("%s %d%s"):format(os.date("%H:%M:%S"), math.floor(late), scan_ended > last_watch and " scan" or ""))
        end
    end
    last_watch = now
end)
if BUILD_NET_UPDATE_HZ > 0 then
    local function retry()
        local ok, done = pcall(raise_build_rate)
        if not ok then
            print("[OverpalMod] building rate failed: " .. tostring(done))
        elseif not done then
            ExecuteInGameThreadWithDelay(100, retry)
        end
    end
    retry()
end
-- Everything runs on the game thread. LoopAsync callbacks run on another thread and touch the
-- same Lua state as the update hook (game thread); at 250 ms that race corrupted the state
-- ("Ref was not function") and crashed the server.
ExecuteInGameThreadWithDelay(FIRST_DELAY_MS, function()
    LoopInGameThreadWithDelay(REFRESH_MS, tick)
    LoopInGameThreadWithDelay(FAST_MS, function()
        local ok, err = pcall(fast_tick)
        if not ok then print("[OverpalMod] fast tick failed: " .. tostring(err)) end
    end)
end)
