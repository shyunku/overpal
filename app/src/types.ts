// Shapes produced by the mod (base_storage.json) and the app server.

export interface ClientConfig {
  serverUrl: string;
  token: string;
}

export interface StorageItem {
  index: number;
  /** game-internal item id, e.g. "Stone", "Pal_crystal_S" */
  item: string;
  count: number;
}

/** "pickup": stones, branches, berry bushes placed on the map, not something players stored */
export type StorageKind = "chest" | "guildChest" | "production" | "pickup" | "guildStorage" | "other";

export interface Storage {
  containerId: string;
  /** guild id */
  group: string;
  kind: StorageKind;
  modelClass?: string;
  buildObjectId?: string;
  location?: { x: number; y: number; z: number };
  slotCount: number;
  items: StorageItem[];
}

export interface BaseStorage {
  version: number;
  /** unix seconds */
  updatedAt: number;
  storages: Storage[];
}

export interface ModStatus {
  updatedAt: number;
  ok: boolean;
  elapsedMs: number;
  errors: string[];
}
