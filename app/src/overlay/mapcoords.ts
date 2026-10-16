// World and PalDefender map coordinates -> pixels on public/map/palpagos.webp (4096 x 4096).
// The image covers the same world rectangle the map markers were projected with
// (palworld-helper scripts/fetch_markers.py, from paldb.cc), so players and bases land on the
// same spots as the markers and the terrain. The earlier hand calibration was 4-7 px off.

export const MAP_SIZE = 4096;

// world rectangle of the image (cm): world Y runs left to right, world X bottom to top
const MIN_X = -1099400;
const MAX_X = 349400;
const MIN_Y = -724400;
const MAX_Y = 724400;

/** world units (cm) per map pixel */
export const WORLD_PER_PX = (MAX_Y - MIN_Y) / MAP_SIZE;

/** world position (cm) -> map image pixels */
export function worldPx(worldX: number, worldY: number): [number, number] {
  return [((worldY - MIN_Y) / (MAX_Y - MIN_Y)) * MAP_SIZE, (1 - (worldX - MIN_X) / (MAX_X - MIN_X)) * MAP_SIZE];
}

/** PalDefender map coordinates (world / 459 with an offset, checked against its own output) -> map image pixels */
export function mapPx(mapX: number, mapY: number): [number, number] {
  return worldPx(mapY * 459 - 123888, mapX * 459 + 158000);
}

/**
 * The game's maps (DT_WorldMapUIData, read on the server 2026-10-17): the main islands and the
 * World Tree, a region of its own outside the main map's rectangle with its own texture
 * (T_TreeMap, 4.2 times finer). Images are 4096 px; world Y runs left to right, X bottom to top.
 */
export type MapId = "main" | "tree";
const MAPS: Record<MapId, { minX: number; maxX: number; minY: number; maxY: number; image: string }> = {
  main: { minX: MIN_X, maxX: MAX_X, minY: MIN_Y, maxY: MAX_Y, image: "/map/palpagos.webp" },
  tree: { minX: 347351.5, maxX: 689148.5, minY: -818197, maxY: -476400, image: "/map/worldtree.webp" },
};

/** the map a world position is on */
export function mapAt(worldX: number, worldY: number): MapId {
  const t = MAPS.tree;
  return worldX >= t.minX && worldX <= t.maxX && worldY >= t.minY && worldY <= t.maxY ? "tree" : "main";
}

/** world position (cm) -> pixels on that map's image */
export function worldPxOn(map: MapId, worldX: number, worldY: number): [number, number] {
  const m = MAPS[map];
  return [((worldY - m.minY) / (m.maxY - m.minY)) * MAP_SIZE, (1 - (worldX - m.minX) / (m.maxX - m.minX)) * MAP_SIZE];
}

/** world units (cm) per pixel of that map's image */
export const worldPerPxOn = (map: MapId): number => (MAPS[map].maxY - MAPS[map].minY) / MAP_SIZE;

export const mapImage = (map: MapId): string => MAPS[map].image;

