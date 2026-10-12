// Display names for items and storage places.
// Temporary: only the items seen on the test server. Task #8 replaces this with the full
// game item table (names and icons).

import type { Storage } from "../types";

const ITEM_NAMES: Record<string, string> = {
  Pal_crystal_S: "팰지움 파편",
  Pal_crystal_L: "팰지움 덩어리",
  PalSphere: "팰 스피어",
  BakedMeat_GrassMammoth: "그린모스 스테이크",
  Wool: "양털",
  BerrySeeds: "열매 씨",
  Berries: "빨간 열매",
  Wood: "목재",
  Stone: "돌",
};

const BUILDING_NAMES: Record<string, string> = {
  ItemChest: "나무 상자",
  Workbench: "원시적인 작업대",
  CampFire: "모닥불",
};

export const itemName = (id: string): string => ITEM_NAMES[id] ?? id;

export interface Place {
  key: string;
  name: string;
  storages: Storage[];
}

/**
 * Groups a base's storages into named places: one place per building (same buildings
 * numbered by position) and one place for everything dropped on the ground.
 */
export function placesOf(storages: Storage[]): Place[] {
  const places: Place[] = [];
  const dropped: Storage[] = [];
  const byBuilding = new Map<string, Storage[]>();
  for (const s of storages) {
    if (s.kind === "pickup") continue;
    if (s.kind === "dropped") {
      dropped.push(s);
      continue;
    }
    const key = s.kind === "guildStorage" ? "guildStorage" : (s.buildObjectId ?? s.kind);
    byBuilding.set(key, [...(byBuilding.get(key) ?? []), s]);
  }
  for (const [key, list] of byBuilding) {
    const base = key === "guildStorage" ? "길드 창고" : (BUILDING_NAMES[key] ?? key);
    // stable numbering: west to east, then north to south
    list.sort((a, b) => (a.location?.x ?? 0) - (b.location?.x ?? 0) || (a.location?.y ?? 0) - (b.location?.y ?? 0));
    list.forEach((s, i) => places.push({ key: s.containerId, name: list.length > 1 ? `${base} ${i + 1}` : base, storages: [s] }));
  }
  if (dropped.length) places.push({ key: "dropped", name: "바닥 (버린 아이템)", storages: dropped });
  return places;
}
