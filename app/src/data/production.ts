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
}

/**
 * Work still to do per work type: the order is done when the slowest type is. Without the
 * per-type list (one work type, or an older mod) the order counts as one.
 */
export function workLeft(o: OrderWork): number[] {
  const types = o.types?.length ? o.types : [{ work: o.work, max: o.workRequired }];
  return types.map((t) => Math.max(0, o.remain * t.max - t.work));
}

/** a reading of an order's work left, at `t` (ms) */
export interface WorkSample {
  t: number;
  left: number[];
}

/**
 * Seconds until the order is done at the pace between the oldest and the newest reading, the
 * slowest work type setting it; null while unknown or while some type that still has work does
 * not move (its pal left).
 */
export function etaSeconds(samples: WorkSample[]): number | null {
  if (samples.length < 2) return null;
  const a = samples[0];
  const b = samples[samples.length - 1];
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0 || a.left.length !== b.left.length) return null;
  let worst = 0;
  for (let i = 0; i < b.left.length; i++) {
    if (b.left[i] <= 0) continue;
    const rate = (a.left[i] - b.left[i]) / dt;
    if (rate <= 0) return null;
    worst = Math.max(worst, b.left[i] / rate);
  }
  return worst > 0 ? worst : null;
}

/**
 * how far back the pace is measured: the work speed is fixed while the same pals work, so a short
 * window only has to cover a few of the mod's 0.5 s readings, and follows a pal leaving or joining
 * soon (until the mod reads the pals' work speed itself)
 */
export const ETA_WINDOW_MS = 1500;
/** readings closer together than this are not kept */
const SAMPLE_GAP_MS = 400;

const tracks = new Map<string, WorkSample[]>();

/**
 * Keeps the readings of an order (by building) and returns the seconds it still takes. Called on
 * every render; a reading is added at most every SAMPLE_GAP_MS, so a pal that stops shows as no
 * pace once the window has only the unchanged readings.
 */
export function trackEta(id: string, o: OrderWork, now: number): number | null {
  let list = tracks.get(id);
  if (!list) tracks.set(id, (list = []));
  const left = workLeft(o);
  const last = list[list.length - 1];
  if (!last || now - last.t >= SAMPLE_GAP_MS) list.push({ t: now, left });
  while (list.length > 2 && now - list[0].t > ETA_WINDOW_MS) list.shift();
  return etaSeconds(list);
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
