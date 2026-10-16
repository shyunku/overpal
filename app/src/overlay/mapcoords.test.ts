import { describe, expect, it } from "vitest";
import { mapAt, worldPxOn } from "./mapcoords";

describe("maps", () => {
  it("puts the World Tree region on its own map", () => {
    expect(mapAt(500000, -650000)).toBe("tree");
    expect(mapAt(-216193, 242)).toBe("main");
  });

  it("projects onto the map's own rectangle", () => {
    // the World Tree map's corners: min Y at the left, max X at the top
    expect(worldPxOn("tree", 689148.5, -818197)).toEqual([0, 0]);
    expect(worldPxOn("tree", 347351.5, -476400)).toEqual([4096, 4096]);
  });
});
