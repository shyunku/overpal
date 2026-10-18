-- OverpalMod (Overpal's server mod)
-- Reads base storage (chests, production buildings, guild storage) from the running dedicated
-- server and writes it to base_storage.json next to this mod, and the players' positions to
-- positions.json.
-- How the objects are linked is documented in docs/game-internals.md.

local FIRST_DELAY_MS = 30000
-- full rescan: new/removed containers, buildings, production progress (spread over slices, see
-- "slicing")
local REFRESH_MS = 10000
-- containers flagged by the update hook are re-read this often
local FAST_MS = 250
-- called whenever a building's storage updates (also once a second for chests with timers)
local UPDATE_HOOK = "/Script/Pal.PalMapObjectItemContainerModule:OnUpdateContents"
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
-- Player positions and camera directions go to positions.json this often (only when changed).
-- The controllers come from the object lists (see "object lists"); reading them costs about
-- 10 us per player.
local POSITIONS_MS = 100
local POSITIONS_FILE = "positions.json"
-- Production orders (what each production building makes, how many are left, the current
-- item's progress) go to production.json this often (only when changed); the full scan only
-- finds the buildings. About 70 objects, well under 1 ms.
local PRODUCTION_MS = 500
local PRODUCTION_FILE = "production.json"

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

-- ---------------------------------------------------------------- object lists
-- FindAllOf walks every object of the server (about 40 ms each, also for a class with one
-- object), so the lists are found once and then kept up to date by NotifyOnNewObject; objects
-- that went away are dropped when they turn invalid. One class is found again every
-- RESYNC_EVERY scans in case a notification was missed (that one call stops the server about
-- 50 ms; the notifications were seen working on the test server, 2026-10-13).
local CLASSES = {
    { key = "containers", name = "PalItemContainer", path = "/Script/Pal.PalItemContainer" },
    { key = "modules", name = "PalMapObjectItemContainerModule", path = "/Script/Pal.PalMapObjectItemContainerModule" },
    { key = "buildings", name = "PalBuildObject", path = "/Script/Pal.PalBuildObject" },
    { key = "progress", name = "PalWorkProgress", path = "/Script/Pal.PalWorkProgress" },
    { key = "players", name = "PalPlayerController", path = "/Script/Pal.PalPlayerController" },
}
local RESYNC_EVERY = 30
-- key -> { [address] = object }
local objects = {}
-- objects announced by NotifyOnNewObject, added to `objects` when a scan step starts (a scan
-- paused in the middle of going through a list must not see it grow)
local pending = {}
-- objects announced by NotifyOnNewObject since start, per key (status.json)
local notified = {}
-- per object address, what never changes once read: { id, group, skip } of a container,
-- { cid, info } of a module, { buildObjectId, modelRef, location, model } of a building
local known = {}

local function find_all(c)
    local set = {}
    for _, o in ipairs(FindAllOf(c.name) or {}) do
        if o:IsValid() then set[o:GetAddress()] = o end
    end
    objects[c.key] = set
    -- what was read for the old objects is read again
    for addr in pairs(known) do
        if known[addr].key == c.key then known[addr] = nil end
    end
end

local function take_pending(key)
    for addr, o in pairs(pending[key]) do
        objects[key][addr] = o
        known[addr] = nil
    end
    pending[key] = {}
end

local function watch_new_objects()
    for _, c in ipairs(CLASSES) do
        pending[c.key] = {}
        notified[c.key] = 0
        local ok, err = pcall(function()
            NotifyOnNewObject(c.path, function(o)
                -- still being built here: only noted, read by the next scan
                pending[c.key][o:GetAddress()] = o
                notified[c.key] = notified[c.key] + 1
            end)
        end)
        if not ok then
            print("[OverpalMod] NotifyOnNewObject " .. c.name .. " failed: " .. tostring(err))
            notified[c.key] = -1
        end
    end
end

-- ---------------------------------------------------------------- slicing
-- The scan goes through its lists a piece at a time: every SLICE_MS on the game thread it works
-- for about SLICE_BUDGET_MS and continues there next time, so the server never stops for long in
-- one go. (Not a coroutine: UE4SS cannot reach game objects from a coroutine's Lua state.)
local SLICE_MS = 10
local SLICE_BUDGET_MS = 4

-- each value is a JSON piece kept until its table changes (fast tick or a new scan)
local json_cache = setmetatable({}, { __mode = "k" })
local function json_of(t)
    local j = json_cache[t]
    if not j then
        j = to_json(t)
        json_cache[t] = j
    end
    return j
end

-- ---------------------------------------------------------------- scan steps
-- Each step reads one object into the scan state `st`; objects that went away leave the lists.

-- st.modules: container id -> { kind, modelClass, modelRef }
local function module_step(st, addr, m)
    if not m:IsValid() then
        objects.modules[addr] = nil
        return
    end
    local k = known[addr]
    if not k then
        k = { key = "modules" }
        k.cid = try("module container", function() return guid_of(m.TargetContainer.ID.ID) end)
        local model = try("module outer", function() return m:GetOuter() end)
        if k.cid and model and model:IsValid() then
            local cls = model:GetClass():GetFName():ToString()
            k.info = {
                modelClass = cls,
                kind = KIND_BY_MODEL_CLASS[cls] or "other",
                -- concrete model -> map object actor link
                modelRef = try("model ref", function() return guid_of(model.ModelInstanceId) end),
            }
        end
        -- an unfinished module is read again next time
        if k.info then known[addr] = k end
    end
    if k.info then st.modules[k.cid] = k.info end
end

-- Building entry for the main window's "mine" structures: id (unique per building; the
-- buildObjectId is its type), name given in game, location, guild. Production buildings are
-- noted in st.converters; their orders are read by the production tick.
local function building_entry(st, k)
    local model = k.model
    local entry = { id = k.modelRef, buildObjectId = k.buildObjectId, group = guid_of(model.GroupIdBelongTo), location = k.location }
    -- the name players give a building (e.g. a chest) in game, empty if none
    local name = try("custom name", function() return model.CustomName:ToString() end)
    if name and name ~= "" then entry.customName = name end
    local concrete = model.ConcreteModel
    if concrete and concrete:IsValid() and concrete:GetClass():GetFName():ToString() == "PalMapObjectConvertItemModel" then
        st.converters[k.modelRef] = concrete
    end
    return entry
end

-- st.buildings (guild buildings) and st.located (the same by map object model instance id).
-- Items dropped on the ground are not collected (their actors cost a FindAllOf of their own).
local function building_step(st, addr, a)
    if not a:IsValid() then
        objects.buildings[addr] = nil
        return
    end
    local k = known[addr]
    if not k then
        k = { key = "buildings" }
        k.modelRef = try("actor id", function() return guid_of(a.ModelInstanceId) end)
        k.buildObjectId = try("build object id", function() return a.BuildObjectId:ToString() end)
        k.model = a.MapObjectModel
        local loc = a:K2_GetActorLocation()
        k.location = { x = loc.X, y = loc.Y, z = loc.Z }
        if not (k.modelRef and k.buildObjectId and k.model and k.model:IsValid()) then return end
        known[addr] = k
    end
    if k.buildObjectId == "None" or not k.model:IsValid() then return end
    local b = try("building", function() return building_entry(st, k) end)
    if b then
        st.buildings[#st.buildings + 1] = b
        st.located[k.modelRef] = b
    end
end

-- the kinds not collected: items dropped on the ground and map pickups (not stored by players)
local SKIP_KINDS = { dropped = true, pickup = true }

-- st.storages: guild containers only. Containers of no guild (map pickups and the like, most of
-- them) are noted once and not read again.
local function container_step(st, addr, c)
    if not c:IsValid() then
        objects.containers[addr] = nil
        return
    end
    local k = known[addr]
    if not k then
        local id = try("container id", function() return guid_of(c.ID.ID) end)
        local group = try("container group", function() return guid_of(c.BelongInfo.GroupId) end)
        if not (id and group) then return end
        k = { key = "containers", id = id, group = group, skip = group == ZERO_GUID }
        known[addr] = k
    end
    if k.skip then return end
    local m = st.modules[k.id]
    if m and SKIP_KINDS[m.kind] then return end
    local items, slot_count = read_items(c)
    local entry = { containerId = k.id, group = k.group, slotCount = slot_count, items = items }
    if m then
        entry.kind = m.kind
        entry.modelClass = m.modelClass
        local b = m.modelRef and st.located[m.modelRef]
        if b then
            entry.buildingId = b.id
            entry.location = b.location
            entry.buildObjectId = b.buildObjectId
            entry.customName = b.customName
        end
    else
        -- the guild-wide storage has no owning map object
        entry.kind = "guildStorage"
    end
    st.storages[#st.storages + 1] = entry
    st.by_object[k.id] = c
end

-- ---------------------------------------------------------------- change push
-- The last full scan, kept so a single container can be refreshed without scanning again.
local current = { storages = {}, byId = {}, objects = {}, buildings = {}, buildingsById = {}, converters = {}, outputOf = {} }
-- container ids flagged by the update hook since the last fast tick
local dirty = {}
-- set by the fast tick when a production building's storage changed
local production_now = false
local hooked = false
local seq = 0

-- the file is put together from the cached JSON of each storage and building
local function write_storage()
    seq = seq + 1
    local s, b = {}, {}
    for i, x in ipairs(current.storages) do s[i] = json_of(x) end
    for i, x in ipairs(current.buildings) do b[i] = json_of(x) end
    write_file("base_storage.json", ('{"buildings":[%s],"seq":%d,"storages":[%s],"updatedAt":%d,"version":1}'):format(table.concat(b, ","), seq, table.concat(s, ","), os.time()))
end

local function set_current(storages, by_object, buildings, converters)
    local by_id = {}
    for _, s in ipairs(storages) do by_id[s.containerId] = s end
    local buildings_by_id = {}
    for _, b in ipairs(buildings) do buildings_by_id[b.id] = b end
    -- a production building's own storage (finished items not taken out yet)
    local output_of = {}
    for _, s in ipairs(storages) do
        if s.buildingId and converters[s.buildingId] then output_of[s.buildingId] = by_object[s.containerId] end
    end
    current = { storages = storages, byId = by_id, objects = by_object, buildings = buildings, buildingsById = buildings_by_id, converters = converters, outputOf = output_of }
end

-- ---------------------------------------------------------------- production orders
local last_production = nil

-- Reads the orders of the production buildings into their entries in `current` and writes
-- production.json ({ buildings: [{ id, production | null }] }, every production building)
-- when anything changed. `force`: also when nothing changed (after a scan).
-- current item's work done and required. Buildings several pals work on together (ancient
-- furnace, ancient workbench) use PalWorkProgressMultiType: its CurrentWorkAmount stays 0 and each
-- work type has its own entry (CurrentProgress may run past MaxProgress, kept for the next items);
-- an item is done when every type reaches its MaxProgress, the maxima adding up to the requirement.
-- Work done on the order and the work one craft takes. Buildings several pals work on
-- (PalWorkProgressMultiType) keep an entry per work type: MaxProgress is one craft's work of that
-- type, CurrentProgress all the work of that type stored so far, which runs ahead of the other
-- types (up to MaxStorableProgress, e.g. 111 crafts' worth while the other type had 0.16). A craft
-- is made once every type has one craft's work. So the work counts up to `remain` crafts per type,
-- and done / required can be more than one craft (the app turns it into the order's share). The
-- third value lists each type's work ({work, max, speed}) for the time left: the slowest type sets it.

-- The server's WorkSpeedRate (PalWorldSettings.ini; the game's default 1). A pal's work per second
-- is its craft speed for the work type times this (2.5 on both servers: measured on the test
-- server 2026-10-19 against the game clock, for one work type and for each type of a multi-type work).
local function read_work_speed_rate()
    local root = DIR:gsub("\\", "/"):match("^(.*)/Pal/Binaries/")
    if not root then return 1 end
    local f = io.open(root .. "/Pal/Saved/Config/WindowsServer/PalWorldSettings.ini", "r")
    if not f then return 1 end
    local text = f:read("*a")
    f:close()
    return tonumber(text:match("WorkSpeedRate=([%d%.]+)")) or 1
end
local WORK_SPEED_RATE = read_work_speed_rate()

-- work per second of each work type at the multi-type works: work address -> { [suitability] = speed },
-- from the pals working there now (WorkingState 2; 1 is a pal assigned but resting or on its way)
local type_speeds = {}
local function collect_type_speeds()
    local by = {}
    for _, comp in ipairs(FindAllOf("PalCharacterParameterComponent") or {}) do
        pcall(function()
            if tonumber(comp.WorkingState) ~= 2 then return end
            local work = comp:GetWork()
            if not work or not work:IsValid() then return end
            -- only the multi-type assignment says which work type the pal does
            local suit = tonumber(comp:GetWorkAssign().AssignedWorkSuitability)
            if not suit then return end
            local speed = comp:GetIndividualParameter():GetCraftSpeed_withBuff_WorkSuitability(suit)
            local key = work:GetAddress()
            by[key] = by[key] or {}
            by[key][suit] = (by[key][suit] or 0) + speed * WORK_SPEED_RATE
        end)
    end
    type_speeds = by
end

local function work_of(w, remain)
    if not w then return 0, 0, nil end
    local entries = nil
    pcall(function()
        if w:GetClass():GetFName():ToString() == "PalWorkProgressMultiType" then entries = w.ProgressEntries end
    end)
    if not entries then return w.CurrentWorkAmount, w.RequiredWorkAmount, nil end
    local crafts = math.max(remain or 1, 1)
    local done, total, types = 0, 0, {}
    for i = 1, #entries do
        local e = entries[i]
        local max = e.MaxProgress
        local work = math.min(e.CurrentProgress, max * crafts)
        done = done + work
        total = total + max
        local speed = 0
        pcall(function() speed = (type_speeds[w:GetAddress()] or {})[tonumber(e.WorkSuitability)] or 0 end)
        types[#types + 1] = { work = work, max = max, speed = speed }
    end
    return done, total, types
end

-- the game's clock (world time in seconds), nil until the world is there
local gameplay_statics, world_context = nil, nil
local function game_seconds()
    local t = nil
    pcall(function()
        if not gameplay_statics or not gameplay_statics:IsValid() then gameplay_statics = StaticFindObject("/Script/Engine.Default__GameplayStatics") end
        if not world_context or not world_context:IsValid() then world_context = FindFirstOf("PalGameStateInGame") end
        t = gameplay_statics:GetTimeSeconds(world_context)
    end)
    return t
end

-- production ticks until the pals at multi-type works are looked up again (see collect_type_speeds)
local SPEEDS_EVERY = 10
local speeds_in = 0
local multi_running = false

local function production_tick(force)
    take_pending("progress")
    if multi_running then
        speeds_in = speeds_in - 1
        if speeds_in <= 0 then
            speeds_in = SPEEDS_EVERY
            pcall(collect_type_speeds)
        end
    end
    local any_multi = false
    local progress = {}
    for addr, w in pairs(objects.progress) do
        if not w:IsValid() then
            objects.progress[addr] = nil
        else
            pcall(function()
                local m = w.CachedOwnerMapObjectConcreteModel
                if m and m:IsValid() then progress[m:GetAddress()] = w end
            end)
        end
    end
    local parts = {}
    for id, concrete in pairs(current.converters) do
        local p = nil
        pcall(function()
            if not concrete:IsValid() then return end
            local recipe = concrete.CurrentRecipeId:ToString()
            if recipe == "None" then return end
            local w = progress[concrete:GetAddress()]
            -- finished items still in the building, read together with what is left: read apart
            -- (storage output vs this file) the total made + remain jumped by one
            local made = 0
            local out = current.outputOf[id]
            if out and out:IsValid() then
                for _, it in ipairs(read_items(out)) do
                    if it.item == recipe then made = made + it.count end
                end
            end
            local remain = concrete.RemainProductNum
            local work, required, types = work_of(w, remain)
            if types and remain > 0 then any_multi = true end
            -- the work speed the game keeps: the sum of the working pals' (and players') speed,
            -- updated as they join or leave (-1 or 0 while nobody works); checked on the test
            -- server 2026-10-19: work left / this was the time to the finished item
            local by_sec = nil
            pcall(function() by_sec = w.ReplicatedWorkAmountBySec end)
            p = {
                recipe = recipe,
                requested = concrete.RequestedProductNum,
                remain = remain,
                made = made,
                work = work,
                workRequired = required,
                types = types,
                bySec = by_sec,
            }
        end)
        local pj = p and to_json(p) or "null"
        parts[#parts + 1] = ('{"id":"%s","production":%s}'):format(id, pj)
        local b = current.buildingsById[id]
        if b and (b.production and to_json(b.production) or "null") ~= pj then
            b.production = p
            json_cache[b] = nil
        end
    end
    multi_running = any_multi
    table.sort(parts)
    local body = '"buildings":[' .. table.concat(parts, ",") .. "]"
    if body == last_production and not force then return end
    last_production = body
    -- when it was read, in game seconds: the overlay moves the work on from here, not from when the
    -- reading reached it (that took a varying while, and the bar stepped back and forth with it)
    local t = game_seconds()
    write_file(PRODUCTION_FILE, "{" .. (t and ('"t":%.3f,'):format(t) or "") .. body .. "}")
end

-- Work on production buildings started (a pal or player joined), ended (one left) or made an item.
-- The game calls these from the work's own events (dynamic delegates), so Lua hooks see them
-- (test server 2026-10-19). The orders are written again on the next fast tick, not in the hook.
local WORK_HOOKS = {
    "/Script/Pal.PalMapObjectConvertItemModel:OnStartWorkAnyone_ServerInternal",
    "/Script/Pal.PalMapObjectConvertItemModel:OnEndWorkAnyone_ServerInternal",
    "/Script/Pal.PalMapObjectConvertItemModel:OnFinishWorkInServer",
}
local work_event = false
local work_hooked = false

local function try_hook()
    if not hooked then
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
    if not work_hooked then
        local ok, err = pcall(function()
            for _, path in ipairs(WORK_HOOKS) do
                RegisterHook(path, function() work_event = true end)
            end
        end)
        work_hooked = ok
        if not ok then log_error("work hook", err) end
    end
end

-- re-read the flagged containers and write the file only when something actually changed
local function fast_tick()
    -- a work started, ended or made an item: the orders go out now, not at the next half second
    if work_event then
        work_event = false
        -- who works where changed: the multi-type works' speeds now, and again in a second
        pcall(collect_type_speeds)
        speeds_in = 2
        production_tick()
    end
    if next(dirty) == nil then return end
    local changed = false
    production_now = false
    for id in pairs(dirty) do
        local entry, obj = current.byId[id], current.objects[id]
        if entry and obj and obj:IsValid() then
            local ok, items = pcall(read_items, obj)
            if ok and to_json(items) ~= to_json(entry.items) then
                entry.items = items
                json_cache[entry] = nil
                changed = true
                -- a production building's storage: the order's counts moved with it
                if entry.buildingId and current.converters[entry.buildingId] then production_now = true end
            end
        end
    end
    dirty = {}
    if production_now then production_tick() end
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

-- ---------------------------------------------------------------- player positions
-- { controller, uid } of the connected players, refreshed by the full scan
local player_controllers = {}
local last_positions = nil

local function collect_players()
    local list = {}
    take_pending("players")
    for addr, pc in pairs(objects.players) do
        if not pc:IsValid() then
            objects.players[addr] = nil
        else
            local uid = try("player uid", function()
                local ps = pc.PlayerState
                return ps and ps:IsValid() and guid_of(ps.PlayerUId) or nil
            end)
            if uid then list[#list + 1] = { pc = pc, uid = uid } end
        end
    end
    player_controllers = list
end

-- uid, world position (cm) and camera yaw (degrees, 0 = world +X, 90 = +Y) of each player
local function write_positions()
    local players = {}
    for _, p in ipairs(player_controllers) do
        pcall(function()
            if not p.pc:IsValid() then return end
            local pawn = p.pc.Pawn
            if not pawn or not pawn:IsValid() then return end
            local l = pawn:K2_GetActorLocation()
            local yaw = p.pc.ControlRotation.Yaw
            players[#players + 1] = ('{"uid":"%s","x":%.0f,"y":%.0f,"z":%.0f,"yaw":%.1f}'):format(p.uid, l.X, l.Y, l.Z, yaw)
        end)
    end
    local text = '{"players":[' .. table.concat(players, ",") .. "]}"
    if text == last_positions then return end
    last_positions = text
    write_file(POSITIONS_FILE, text)
end

-- ---------------------------------------------------------------- full scan
-- the running scan (state, see PHASES), when the last one ended (os.clock), how many ran
local scan = nil
local scan_ended = -math.huge
local scan_count = 0
local last_status = nil

-- the objects of a list as it is now (new ones join; the scan goes through this copy)
local function list_of(key)
    take_pending(key)
    local list = {}
    for addr, o in pairs(objects[key]) do list[#list + 1] = { addr, o } end
    return list
end

-- the JSON pieces of the new storages and buildings, made a piece at a time
local function json_list(st)
    local list = {}
    for _, x in ipairs(st.storages) do list[#list + 1] = { nil, x } end
    for _, x in ipairs(st.buildings) do list[#list + 1] = { nil, x } end
    return list
end

local PHASES = {
    { key = "modules", step = module_step },
    { key = "buildings", step = building_step },
    { key = "containers", step = container_step },
    { list = json_list, step = function(_, _, x) json_of(x) end },
}

local function finish_scan(st)
    set_current(st.storages, st.by_object, st.buildings, st.converters)
    production_tick(true)
    collect_players()
    -- containers flagged during the scan stay flagged: the fast tick reads them again
    write_storage()
    -- the hooked class exists once the world is loaded
    try_hook()
    local counts = {}
    for _, c in ipairs(CLASSES) do
        local n = 0
        for _ in pairs(objects[c.key]) do n = n + 1 end
        counts[c.key] = n
    end
    last_status = {
        ok = #errors == 0,
        -- game thread time spent on it, in slices of at most about SLICE_BUDGET_MS
        elapsedMs = math.floor(st.work * 1000),
        slices = st.slices,
        longestSliceMs = math.floor(st.longest * 1000),
        resyncMs = st.resync_ms,
        wallMs = math.floor((os.clock() - st.started) * 1000),
        objects = counts,
        notified = notified,
        storages = #st.storages,
        buildings = #st.buildings,
        errors = errors,
    }
end

local function write_status()
    local s = last_status or {}
    s.updatedAt = os.time()
    s.hooked = hooked
    s.buildNetUpdateHz = build_rate
    write_file("status.json", to_json(s))
end

-- every REFRESH_MS: starts a scan (unless one still runs)
local function tick()
    if ENABLE_PROBE then
        local ok, err = pcall(run_probe)
        if not ok then print("[OverpalMod] probe failed: " .. tostring(err)) end
    end
    if scan then return end
    errors = {}
    local st = {
        phase = 0, list = nil, i = 0,
        modules = {}, converters = {}, located = {}, buildings = {}, storages = {}, by_object = {},
        started = os.clock(), work = 0, slices = 0, longest = 0, resync_ms = 0,
    }
    -- one class found again (FindAllOf) per RESYNC_EVERY scans, in turn, in case a
    -- notification was missed; this one call cannot be split
    if scan_count > 0 and scan_count % RESYNC_EVERY == 0 then
        local c = CLASSES[(scan_count // RESYNC_EVERY) % #CLASSES + 1]
        local t = os.clock()
        local ok, err = pcall(find_all, c)
        if not ok then log_error("resync " .. c.name, err) end
        st.resync_ms = math.floor((os.clock() - t) * 1000)
    end
    scan_count = scan_count + 1
    scan = st
end

-- every SLICE_MS: works on the running scan for about SLICE_BUDGET_MS
local function slice()
    local st = scan
    if not st then return end
    local t0 = os.clock()
    local done = false
    local ok, err = pcall(function()
        while (os.clock() - t0) * 1000 < SLICE_BUDGET_MS do
            if st.list and st.i < #st.list then
                st.i = st.i + 1
                local e = st.list[st.i]
                PHASES[st.phase].step(st, e[1], e[2])
            else
                st.phase = st.phase + 1
                local p = PHASES[st.phase]
                if not p then
                    done = true
                    return
                end
                st.list = p.key and list_of(p.key) or p.list(st)
                st.i = 0
            end
        end
    end)
    local spent = os.clock() - t0
    st.work = st.work + spent
    st.slices = st.slices + 1
    if spent > st.longest then st.longest = spent end
    if not ok then
        log_error("scan", err)
        done = true
    end
    if done then
        local ok2, err2 = pcall(finish_scan, st)
        if not ok2 then print("[OverpalMod] scan finish failed: " .. tostring(err2)) end
        scan = nil
        scan_ended = os.clock()
        write_status()
    end
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
            local during_scan = scan ~= nil or scan_ended > last_watch
            append_line(STALL_FILE, ("%s %d%s"):format(os.date("%H:%M:%S"), math.floor(late), during_scan and " scan" or ""))
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
    -- the lists: found once (spread over a few slices), then kept by notifications
    for _, c in ipairs(CLASSES) do objects[c.key] = {} end
    watch_new_objects()
    for i, c in ipairs(CLASSES) do
        ExecuteInGameThreadWithDelay(i * 200, function()
            local ok, err = pcall(find_all, c)
            if not ok then print("[OverpalMod] FindAllOf " .. c.name .. " failed: " .. tostring(err)) end
        end)
    end
    -- the first scan after the lists
    ExecuteInGameThreadWithDelay((#CLASSES + 1) * 200, function()
        tick()
        LoopInGameThreadWithDelay(REFRESH_MS, tick)
        LoopInGameThreadWithDelay(SLICE_MS, slice)
        LoopInGameThreadWithDelay(FAST_MS, function()
            local ok, err = pcall(fast_tick)
            if not ok then print("[OverpalMod] fast tick failed: " .. tostring(err)) end
        end)
        LoopInGameThreadWithDelay(POSITIONS_MS, function()
            local ok, err = pcall(write_positions)
            if not ok then print("[OverpalMod] positions failed: " .. tostring(err)) end
        end)
        LoopInGameThreadWithDelay(PRODUCTION_MS, function()
            local ok, err = pcall(production_tick)
            if not ok then print("[OverpalMod] production failed: " .. tostring(err)) end
        end)
    end)
end)
