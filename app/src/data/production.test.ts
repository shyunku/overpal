import { describe, expect, it } from "vitest";
import { etaParts, etaSeconds, workLeft, workShare } from "./production";

describe("production share", () => {
  it("counts a single pal's current craft", () => {
    expect(workShare(30, 100, 5)).toBeCloseTo(0.3);
  });

  it("averages the work types of a building several pals work on", () => {
    // 50 bundles: one type finished 7, the other 3 (made 3, 47 left). The mod caps each type at
    // what is left: the first type is 4 crafts ahead, the other has half a craft done.
    const per = 100;
    const share = workShare(4 * per + 0.5 * per, 2 * per, 47);
    expect(share).toBeCloseTo(2.25);
    // the order's share: (3 made + 2.25) / 50 = (3 + 7 + 0.5) / 100
    expect((3 + share) / 50).toBeCloseTo((3 + 7 + 0.5) / 100);
  });

  it("takes the time left from the slowest work type", () => {
    // 10 crafts left, 100 work each; type A at 400 done, type B at 50
    const o = { remain: 10, work: 450, workRequired: 200, types: [{ work: 400, max: 100 }, { work: 50, max: 100 }] };
    expect(workLeft(o)).toEqual([600, 950]);
    // over 2 s A did 100 (50/s), B 40 (20/s): B needs 950 / 20 = 47.5 s
    const s = [
      { t: 0, left: [700, 990] },
      { t: 2000, left: [600, 950] },
    ];
    expect(etaSeconds(s)).toBeCloseTo(47.5);
  });

  it("has no time left while a type that still has work does not move", () => {
    expect(etaSeconds([{ t: 0, left: [500, 300] }, { t: 2000, left: [400, 300] }])).toBeNull();
    // a type that is done does not hold it back
    expect(etaSeconds([{ t: 0, left: [500, 0] }, { t: 2000, left: [400, 0] }])).toBeCloseTo(8);
    expect(etaSeconds([{ t: 0, left: [500] }])).toBeNull();
  });

  it("works with one work type (the order's own work)", () => {
    expect(workLeft({ remain: 3, work: 40, workRequired: 100 })).toEqual([260]);
  });

  it("writes the time in parts, largest first", () => {
    expect(etaParts(12.4)).toEqual(["12초"]);
    expect(etaParts(247)).toEqual(["4분", "7초"]);
    expect(etaParts(3672)).toEqual(["1시간", "1분", "12초"]);
    expect(etaParts(3605)).toEqual(["1시간", "0분", "5초"]);
  });

  it("stays within what is left", () => {
    expect(workShare(900, 100, 3)).toBe(3);
    expect(workShare(50, 0, 3)).toBe(0);
    expect(workShare(50, 100, 0)).toBe(0);
  });
});
