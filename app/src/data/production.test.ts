import { describe, expect, it } from "vitest";
import { etaParts, exactEta, gameTimeNow, noteGameTime, typeSpeeds, workAfter, workLeft, workShare } from "./production";

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
    // older mod: not known
    expect(typeSpeeds({ remain: 1, work: 100, workRequired: 400 })).toBeNull();
    expect(typeSpeeds({ remain: 2, work: 100, workRequired: 400, types: [{ work: 50, max: 200 }, { work: 50, max: 200 }] })).toBeNull();
  });

  it("takes the work type that ends last where several pals work", () => {
    // 3 crafts of 100 per type: type A 250 left at 50/s (5 s), type B 100 left at 10/s (10 s)
    const o = { remain: 3, work: 250, workRequired: 200, types: [{ work: 50, max: 100, speed: 50 }, { work: 200, max: 100, speed: 10 }] };
    expect(exactEta(o)).toBeCloseTo(10);
    // a type with work left and nobody at it: the order does not end
    expect(exactEta({ ...o, types: [o.types[0], { ...o.types[1], speed: 0 }] })).toBeNull();
    // a type that is done does not hold it back
    expect(exactEta({ ...o, types: [o.types[0], { work: 300, max: 100, speed: 0 }] })).toBeCloseTo(5);
  });

  it("moves the work on at the known speeds, each type up to what is left", () => {
    const o = { remain: 3, work: 250, workRequired: 200, types: [{ work: 50, max: 100, speed: 50 }, { work: 200, max: 100, speed: 10 }] };
    expect(workAfter(o, 2)).toBeCloseTo(150 + 220);
    // type A stops at 300 (3 crafts)
    expect(workAfter(o, 10)).toBeCloseTo(300 + 300);
    expect(workAfter({ remain: 1, work: 100, workRequired: 400, bySec: 30 }, 2)).toBeCloseTo(160);
  });

  it("tells the game's time from the quickest arrival, whatever the others took", () => {
    // readings stamped every 0.5 s, arriving 0.05 to 0.3 s later (local = game + 1000 + delay)
    const delays = [0.3, 0.05, 0.2, 0.12, 0.25];
    delays.forEach((d, i) => noteGameTime(i * 0.5, 1000 + i * 0.5 + d));
    // the game's time at local 1003: 1003 - (1000 + 0.05)
    expect(gameTimeNow(1003)).toBeCloseTo(2.95, 5);
    // the server started over: its clock begins again
    noteGameTime(0.2, 2000.4);
    expect(gameTimeNow(2001)).toBeCloseTo(0.8, 5);
  });

  it("stays within what is left", () => {
    expect(workShare(900, 100, 3)).toBe(3);
    expect(workShare(50, 0, 3)).toBe(0);
    expect(workShare(50, 100, 0)).toBe(0);
  });
});
