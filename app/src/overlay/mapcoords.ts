// PalDefender map coordinates -> pixels on public/map/palpagos.webp (4096 x 4096).
// Calibrated by hand against known fast travel points (Scorched Ashland, Fisherman's Point);
// the test base lands next to "시작의 언덕" as expected. Accurate to a few map px.

export const MAP_SIZE = 4096;

export function mapPx(mapX: number, mapY: number): [number, number] {
  return [1442 + (mapX + 814) * 1.3, 2413 - (mapY + 824) * 1.3];
}
