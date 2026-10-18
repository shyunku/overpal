// Shapes produced by the mod (base_storage.json) and the app server.

export interface ClientConfig {
  serverUrl: string;
  token: string;
  /** whose position the minimap follows; the first online player when missing */
  playerName?: string | null;
}

export interface StorageItem {
  index: number;
  /** game-internal item id, e.g. "Stone", "Pal_crystal_S" */
  item: string;
  count: number;
}

/**
 * "dropped": items a player dropped on the ground (counted).
 * "pickup": stones, branches, berry bushes placed on the map, not something players stored (not counted).
 * "inventory": the viewing player's own inventory, added by the app (not from the mod).
 */
export type StorageKind = "chest" | "guildChest" | "production" | "dropped" | "pickup" | "guildStorage" | "inventory" | "other";

export interface Storage {
  containerId: string;
  /** guild id */
  group: string;
  kind: StorageKind;
  modelClass?: string;
  buildObjectId?: string;
  /** name the players gave the building in game, if any */
  customName?: string;
  location?: { x: number; y: number; z: number };
  slotCount: number;
  items: StorageItem[];
}

export interface BaseStorage {
  version: number;
  /** unix seconds */
  updatedAt: number;
  /** increases with every write of the mod output */
  seq?: number;
  storages: Storage[];
  /** every guild building (refreshed on the full scan, every 10 s) */
  buildings?: Building[];
}

export interface Building {
  /** unique per building (map object model instance id); older mod output has none */
  id?: string;
  /** e.g. ItemChest_02, BlastFurnace3 */
  buildObjectId: string;
  /** guild id */
  group: string;
  location: { x: number; y: number; z: number };
  /** name the players gave the building in game */
  customName?: string;
  /** production buildings with an order */
  production?: {
    /** item being made (game item id) */
    recipe: string;
    requested: number;
    /** still to make; 0 when the order is done */
    remain: number;
    /** finished items still in the building, read with `remain` (newer mod output) */
    made?: number;
    /**
     * work done on what is left and one craft's work; work / workRequired is in crafts, more than
     * one where several pals work ahead of each other (each work type's stored work, summed)
     */
    work: number;
    workRequired: number;
    /** buildings several pals work on: each work type's work (up to what is left) and one craft's */
    types?: { work: number; max: number }[];
    /** the work speed the game keeps (work per second of the pals and players at it); -1 or 0 while nobody works */
    bySec?: number;
  };
}

export interface ModStatus {
  updatedAt: number;
  ok: boolean;
  elapsedMs: number;
  /** the container update hook is registered (changes are pushed right away) */
  hooked?: boolean;
  errors: string[];
}
