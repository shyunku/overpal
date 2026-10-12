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
}

export interface ModStatus {
  updatedAt: number;
  ok: boolean;
  elapsedMs: number;
  /** the container update hook is registered (changes are pushed right away) */
  hooked?: boolean;
  errors: string[];
}
