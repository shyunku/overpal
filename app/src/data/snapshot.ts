// Joins the mod's base storage with PalDefender guilds/players into per-base and
// per-guild item totals. Pure functions; fetching lives in api.ts.

import type { BaseStorage, Storage, StorageKind } from "../types";
import type { PdGuilds, PdInventory, PdPlayers, Vec3 } from "./paldefender";

/**
 * Max horizontal distance (world units, 100 = 1 m) between a storage and a camp
 * for the storage to count as part of that base.
 * Assumption: the in-game base radius was not measured yet.
 */
export const BASE_RADIUS = 5000;

export interface ItemSource {
  containerId: string;
  kind: StorageKind;
  count: number;
}

export interface ItemTotal {
  item: string;
  count: number;
  sources: ItemSource[];
}

export interface BaseView {
  campId: string;
  worldPos: Vec3;
  mapPos: Vec3;
  storages: Storage[];
  totals: ItemTotal[];
}

export interface GuildView {
  guildId: string;
  name: string;
  bases: BaseView[];
  /** guild storages that are not inside any base, or have no location (pickups, guild storage) */
  elsewhere: Storage[];
  /** every storage of the guild, bases and elsewhere together (pickups excluded) */
  totals: ItemTotal[];
}

export interface PlayerView {
  uid: string;
  name: string;
  guildId: string;
  online: boolean;
  worldPos: Vec3;
  mapPos: Vec3;
}

export interface Snapshot {
  /** unix seconds of the mod output */
  storageUpdatedAt: number;
  guilds: GuildView[];
  players: PlayerView[];
}

/** Kinds that are kept in the data but not counted as stored items. */
export const EXCLUDED_FROM_TOTALS: ReadonlySet<StorageKind> = new Set<StorageKind>(["pickup"]);

export function aggregate(storages: Storage[]): ItemTotal[] {
  const byItem = new Map<string, ItemTotal>();
  for (const s of storages) {
    if (EXCLUDED_FROM_TOTALS.has(s.kind)) continue;
    for (const it of s.items) {
      let t = byItem.get(it.item);
      if (!t) {
        t = { item: it.item, count: 0, sources: [] };
        byItem.set(it.item, t);
      }
      t.count += it.count;
      const src = t.sources.find((x) => x.containerId === s.containerId);
      if (src) src.count += it.count;
      else t.sources.push({ containerId: s.containerId, kind: s.kind, count: it.count });
    }
  }
  return [...byItem.values()].sort((a, b) => b.count - a.count || a.item.localeCompare(b.item));
}

function distance2d(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The player's carried items as a storage; equipped gear and key items are left out. */
export function inventoryStorage(inv: PdInventory, group: string): Storage {
  const items: Storage["items"] = [];
  let index = 0;
  for (const c of [inv.Inventory.Items, inv.Inventory.Food]) {
    if (!c?.Available) continue;
    for (const slot of Object.values(c.Slots)) items.push({ index: index++, item: slot.ItemID, count: slot.Count });
  }
  return { containerId: "inventory", group, kind: "inventory", slotCount: index, items };
}

/** The base with the player's inventory added to its storages and totals. */
export function withInventory(base: BaseView, inv: Storage): BaseView {
  const storages = [...base.storages, inv];
  return { ...base, storages, totals: aggregate(storages) };
}

/** The base the player is in: the nearest camp within BASE_RADIUS, or null outside every base. */
export function baseAt(bases: BaseView[], pos: Vec3 | null | undefined): BaseView | null {
  if (!pos) return null;
  let best: BaseView | null = null;
  let bestDist = Infinity;
  for (const b of bases) {
    const d = distance2d(pos, b.worldPos);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best && bestDist <= BASE_RADIUS ? best : null;
}

/** Outside every base only the player's own inventory counts; campId is empty. */
export function inventoryOnly(inv: Storage): BaseView {
  const zero = { x: 0, y: 0, z: 0 };
  return { campId: "", worldPos: zero, mapPos: zero, storages: [inv], totals: aggregate([inv]) };
}

export function buildSnapshot(storage: BaseStorage, guilds: PdGuilds | null, players: PdPlayers | null): Snapshot {
  const storagesByGuild = new Map<string, Storage[]>();
  for (const s of storage.storages) {
    const list = storagesByGuild.get(s.group) ?? [];
    list.push(s);
    storagesByGuild.set(s.group, list);
  }

  // guilds known to PalDefender first, then any guild that only the mod knows about
  const guildIds = new Set<string>([...Object.keys(guilds?.Guilds ?? {}), ...storagesByGuild.keys()]);

  const guildViews: GuildView[] = [...guildIds].map((guildId) => {
    const pd = guilds?.Guilds[guildId];
    const bases: BaseView[] = (pd?.camps ?? []).map((c) => ({
      campId: c.id,
      worldPos: c.world_pos,
      mapPos: c.map_pos,
      storages: [],
      totals: [],
    }));
    const elsewhere: Storage[] = [];

    for (const s of storagesByGuild.get(guildId) ?? []) {
      let best: BaseView | null = null;
      let bestDist = Infinity;
      if (s.location) {
        for (const b of bases) {
          const d = distance2d(s.location, b.worldPos);
          if (d < bestDist) {
            bestDist = d;
            best = b;
          }
        }
      }
      if (best && bestDist <= BASE_RADIUS) best.storages.push(s);
      else elsewhere.push(s);
    }

    for (const b of bases) b.totals = aggregate(b.storages);

    return {
      guildId,
      name: pd?.name ?? "",
      bases,
      elsewhere,
      totals: aggregate(storagesByGuild.get(guildId) ?? []),
    };
  });

  const playerViews: PlayerView[] = (players?.Players ?? []).map((p) => ({
    uid: p.PlayerUID,
    name: p.Name,
    guildId: p.GuildUUID,
    online: p.Status === "Online",
    worldPos: p.WorldLocation,
    mapPos: p.MapLocation,
  }));

  return { storageUpdatedAt: storage.updatedAt, guilds: guildViews, players: playerViews };
}
