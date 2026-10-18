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
  /** when it was read, in game seconds */
  at?: number;
  /** several work types: each one's work, one craft's work and its work per second (newer mod) */
  types?: { work: number; max: number; speed?: number }[];
  bySec?: number;
}

/**
 * Work per second of each work type, where the game's speeds are known: one work type, the
 * work speed the game keeps (bySec); several types (ancient furnace), the speed of the pals
 * working at each type times the server's WorkSpeedRate, sent by the mod. 0 for a type nobody
 * works at; null where not known (then no time left is shown: a measured pace was too unsteady).
 */
export function typeSpeeds(o: OrderWork): number[] | null {
  if (o.types?.length) return o.types.every((t) => typeof t.speed === "number") ? o.types.map((t) => Math.max(0, t.speed!)) : null;
  if (o.bySec === undefined || o.bySec === null) return null;
  return [Math.max(0, o.bySec)];
}

/**
 * Seconds the order still takes: per work type the work left over its speed, the type that ends
 * last setting it (an item needs every type's work). Null while a type with work left has nobody
 * at it (the order does not end) or where the speeds are not known.
 */
export function exactEta(o: OrderWork): number | null {
  const speeds = typeSpeeds(o);
  if (!speeds) return null;
  const left = workLeft(o);
  let worst = 0;
  for (let i = 0; i < left.length; i++) {
    if (left[i] <= 0) continue;
    if (!(speeds[i] > 0)) return null;
    worst = Math.max(worst, left[i] / speeds[i]);
  }
  return worst > 0 ? worst : null;
}

// ---------------------------------------------------------------- the game's clock
// The mod stamps its readings with the game's time. A reading reaches the overlay a varying while
// later (file, app server, stream); taking the time it arrived as its time made the bar and the
// time left step back and forth. Instead the game's time now is the local clock less the smallest
// gap seen lately between arrival and stamp (the reading that came quickest).

/** gaps (local seconds - game seconds) of the latest readings */
const gaps: number[] = [];
const GAPS_KEPT = 40;
let lastGameTime = -Infinity;

/** A reading stamped `t` (game seconds) arrived now (`local`: seconds, performance clock). */
export function noteGameTime(t: number, local = performance.now() / 1000): void {
  // the game started over (server restart): earlier gaps say nothing any more
  if (t < lastGameTime - 1) gaps.length = 0;
  lastGameTime = t;
  gaps.push(local - t);
  if (gaps.length > GAPS_KEPT) gaps.shift();
}

/** The game's time now (seconds), or null before any stamped reading. */
export function gameTimeNow(local = performance.now() / 1000): number | null {
  if (!gaps.length) return null;
  return local - Math.min(...gaps);
}

/**
 * The order's work `seconds` after the reading at the known speeds, each type up to what is left
 * (for the bar between readings).
 */
export function workAfter(o: OrderWork, seconds: number): number {
  const speeds = typeSpeeds(o);
  if (!speeds) return o.work;
  const types = o.types?.length ? o.types : [{ work: o.work, max: o.workRequired }];
  return types.reduce((sum, t, i) => sum + Math.min(o.remain * t.max, t.work + speeds[i] * seconds), 0);
}

/**
 * Items (crafts) made `seconds` after the reading at the known speeds: a craft is made once every
 * work type has one craft's work, so the type furthest behind sets it (0..remain).
 */
export function craftsAfter(o: OrderWork, seconds: number): number {
  const speeds = typeSpeeds(o);
  if (!speeds || o.remain <= 0) return 0;
  const types = o.types?.length ? o.types : [{ work: o.work, max: o.workRequired }];
  let crafts = o.remain;
  types.forEach((t, i) => {
    if (t.max > 0) crafts = Math.min(crafts, Math.floor(Math.min(o.remain * t.max, t.work + speeds[i] * seconds) / t.max));
  });
  return Math.max(0, crafts);
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
