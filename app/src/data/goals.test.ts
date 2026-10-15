import { describe, expect, it } from "vitest";
import { craftableNow, goalMaterials, materialTree, materialsOf, treeProgress, type Recipes } from "./goals";

const recipes: Recipes = {
  Arrow: { n: 10, mats: [["Wood", 2], ["Stone", 2]] },
  CopperIngot: { n: 1, mats: [["CopperOre", 2]] },
  Nail: { n: 1, mats: [["CopperIngot", 1]] },
  Crossbow: { n: 1, mats: [["Wood", 50], ["Stone", 40], ["CopperIngot", 10], ["Nail", 2]] },
};
const pool = (o: Record<string, number>) => new Map(Object.entries(o));

describe("goals", () => {
  it("counts whole crafts by what one craft makes", () => {
    expect(materialsOf(recipes.Arrow, 25)).toEqual([["Wood", 6], ["Stone", 6]]);
    expect(goalMaterials({ kind: "struct", id: "Box", qty: 3 }, recipes, () => [["Wood", 5]])).toEqual([["Wood", 15]]);
  });

  it("uses the stock from the top line down", () => {
    const tree = materialTree(recipes, materialsOf(recipes.Crossbow, 2), pool({ Wood: 100, Stone: 80, CopperIngot: 18, CopperOre: 4 }));
    const ingot = tree.find((n) => n.id === "CopperIngot")!;
    expect([ingot.have, ingot.lack]).toEqual([18, 2]);
    // the ore covers the two missing ingots
    expect(ingot.children[0]).toMatchObject({ id: "CopperOre", need: 4, have: 4, lack: 0 });
    const nail = tree.find((n) => n.id === "Nail")!;
    // the ingots under the nails start from what the line above left (none)
    expect(nail.children[0]).toMatchObject({ id: "CopperIngot", need: 4, have: 0, lack: 4 });
    expect(nail.children[0].children[0]).toMatchObject({ id: "CopperOre", need: 8, have: 0 });
    expect(ingot.progress).toBe(1);
  });

  it("measures progress in base materials", () => {
    const tree = materialTree(recipes, [["CopperIngot", 10]], pool({ CopperIngot: 5, CopperOre: 4 }));
    // 5 ingots (10 ore) + 4 ore of 20 ore
    expect(treeProgress(recipes, tree)).toBeCloseTo(14 / 20);
  });

  it("makes a lacking material the way the stock covers best", () => {
    const r: Recipes = { ...recipes, CarbonFiber: { n: 1, mats: [["Coal", 2], ["FireOrgan", 1]], alt: [{ n: 1, mats: [["Charcoal", 5], ["FireOrgan", 1]] }] } };
    const [cf] = materialTree(r, [["CarbonFiber", 2]], pool({ Charcoal: 10, FireOrgan: 2 }));
    expect(cf.children.map((c) => [c.id, c.have, c.need])).toEqual([["Charcoal", 10, 10], ["FireOrgan", 2, 2]]);
    expect(cf.progress).toBe(1);
    // with coal at hand the regular recipe stays
    const [cf2] = materialTree(r, [["CarbonFiber", 2]], pool({ Coal: 4, FireOrgan: 2 }));
    expect(cf2.children[0].id).toBe("Coal");
  });

  it("tells how many the stock makes now", () => {
    expect(craftableNow(recipes.Arrow, undefined, pool({ Wood: 7, Stone: 9 }))).toBe(30);
    expect(craftableNow(undefined, [["Wood", 5]], pool({ Wood: 12 }))).toBe(2);
  });
});
