// Production orders: how far along an order is, and how long it still takes.

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

/** what the time left is worked out from (a production order as the mod writes it) */
export interface OrderWork {
  remain: number;
  work: number;
  workRequired: number;
  types?: { work: number; max: number }[];
  bySec?: number;
}

/**
 * The work speed the game keeps for the order, where it says it all: one work type (the speed of
 * several types is not known apart yet) and a mod that sends it. 0 while nobody works; null where
 * it is not known (then no time left is shown: a measured pace was too unsteady to be of use).
 */
export function gameSpeed(o: OrderWork): number | null {
  if (o.bySec === undefined || o.bySec === null || o.types?.length) return null;
  return Math.max(0, o.bySec);
}

/**
 * Seconds the order still takes at the game's work speed (exact: the work left over it was the
 * time to the finished item on the test server); null while nobody works or where the speed is
 * not known.
 */
export function exactEta(o: OrderWork): number | null {
  const speed = gameSpeed(o);
  if (!speed) return null;
  const left = workLeft(o)[0];
  return left > 0 ? left / speed : null;
}

/**
 * Work still to do per work type: the order is done when the slowest type is. Without the
 * per-type list (one work type, or an older mod) the order counts as one.
 */
export function workLeft(o: OrderWork): number[] {
  const types = o.types?.length ? o.types : [{ work: o.work, max: o.workRequired }];
  return types.map((t) => Math.max(0, o.remain * t.max - t.work));
}

/**
 * The time left in parts, largest first: [1시간, 0분, 12초], [4분, 7초], [12초]. Shown whole where
 * there is room; a narrow line drops parts from the end (1시간 0분 → 1시간), then all of them.
 */
export function etaParts(seconds: number): string[] {
  const s = Math.max(1, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return [`${h}시간`, `${m}분`, `${sec}초`];
  if (m) return [`${m}분`, `${sec}초`];
  return [`${sec}초`];
}
