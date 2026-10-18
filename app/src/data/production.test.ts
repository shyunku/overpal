import { describe, expect, it } from "vitest";
import { etaParts, exactEta, gameSpeed, workLeft, workShare } from "./production";

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

  it("works with one work type (the order's own work)", () => {
    expect(workLeft({ remain: 3, work: 40, workRequired: 100 })).toEqual([260]);
  });

  it("writes the time in parts, largest first", () => {
    expect(etaParts(12.4)).toEqual(["12초"]);
    expect(etaParts(247)).toEqual(["4분", "7초"]);
    expect(etaParts(3672)).toEqual(["1시간", "1분", "12초"]);
    expect(etaParts(3605)).toEqual(["1시간", "0분", "5초"]);
  });

  it("takes the time left from the game's work speed where it has one", () => {
    // the test server: 277075 of 400000 at 9375/s, made 13.1 s later
    expect(exactEta({ remain: 1, work: 277075, workRequired: 400000, bySec: 9375 })).toBeCloseTo(13.11, 2);
    // nobody works
    expect(exactEta({ remain: 1, work: 100, workRequired: 400, bySec: -1 })).toBeNull();
    expect(exactEta({ remain: 1, work: 100, workRequired: 400, bySec: 0 })).toBeNull();
    // older mod, or several work types: not known this way
    expect(gameSpeed({ remain: 1, work: 100, workRequired: 400 })).toBeNull();
    expect(gameSpeed({ remain: 2, work: 100, workRequired: 400, bySec: 50, types: [{ work: 50, max: 200 }, { work: 50, max: 200 }] })).toBeNull();
  });

  it("stays within what is left", () => {
    expect(workShare(900, 100, 3)).toBe(3);
    expect(workShare(50, 0, 3)).toBe(0);
    expect(workShare(50, 100, 0)).toBe(0);
  });
});
