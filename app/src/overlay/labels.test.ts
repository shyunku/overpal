import { describe, expect, it } from "vitest";
import { matchRank, textMatches } from "./labels";

describe("search text", () => {
  it("ignores spaces and case", () => {
    expect(textMatches("고대 문명 화로", "고대문명")).toBe(true);
    expect(textMatches("고대 문명 화로", "화로")).toBe(true);
    expect(textMatches("고대 문명 화로", "문명 화로")).toBe(true);
    expect(textMatches("Ancient Furnace", "ancientfur")).toBe(true);
    expect(textMatches("고대 문명 화로", "전기")).toBe(false);
  });

  it("ranks a name starting with the text first, then a word", () => {
    expect(matchRank("고대 문명 화로", "고대문명")).toBe(0);
    expect(matchRank("고대 문명 화로", "화로")).toBe(1);
    expect(matchRank("고대 문명 화로", "명화")).toBe(2);
    expect(matchRank("고대 문명 화로", "전기")).toBe(-1);
  });
});
