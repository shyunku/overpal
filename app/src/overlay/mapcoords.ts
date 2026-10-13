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
