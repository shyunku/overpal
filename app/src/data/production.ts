// Production orders: how far along an order is.

/**
 * Crafts' worth of work done on what is left of an order (0..remain). Where several pals work
 * (ancient furnace: two work types) the mod sums each type's stored work, which runs ahead of the
 * other type's; work / workRequired is then the average over the types, e.g. one type 4 crafts
 * ahead and the other at half a craft: (4 + 0.5) / 2. Finished crafts stay the game's count.
 */
export function workShare(work: number, workRequired: number, remain: number): number {
  if (!(workRequired > 0) || remain <= 0) return 0;
  return Math.min(remain, Math.max(0, work / workRequired));
}
