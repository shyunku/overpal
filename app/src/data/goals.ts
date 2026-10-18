// Item goals: what a goal needs, how far the base's stock covers it.

/** a game recipe (public/data/recipes.json, scripts/build_recipes.py) */
export interface Recipe {
  /** how many one craft makes */
  n: number;
  /** [material item id, count] per craft */
  mats: [string, number][];
  /** buildings that make it */
  bench?: string[];
  /** other ways to make it (carbon fiber from coal or from charcoal) */
  alt?: { n: number; mats: [string, number][] }[];
}

export type Recipes = Record<string, Recipe>;

/** a goal: an item (game item id) or a structure (dex structure id) and how many */
export interface Goal {
  kind: "item" | "struct";
  id: string;
  qty: number;
}

export const goalKey = (g: { kind: string; id: string }) => `${g.kind}:${g.id}`;

/** materials an amount of an item takes: whole crafts, each making recipe.n */
export function materialsOf(recipe: { n: number; mats: [string, number][] } | undefined, amount: number): [string, number][] {
  if (!recipe || amount <= 0) return [];
  const crafts = Math.ceil(amount / recipe.n);
  return recipe.mats.map(([m, q]) => [m, q * crafts]);
}

/** a goal's direct materials; `structMats`: a structure's materials (one building) */
export function goalMaterials(goal: Goal, recipes: Recipes, structMats: (id: string) => [string, number][] | undefined): [string, number][] {
  if (goal.kind === "struct") return (structMats(goal.id) ?? []).map(([m, q]) => [m, q * goal.qty]);
  return materialsOf(recipes[goal.id], goal.qty);
}

/** how deep materials are followed (recipes can loop) */
const MAX_DEPTH = 6;

/** base materials (all the way down) an amount of an item takes */
function leaves(recipes: Recipes, id: string, amount: number, depth = 0): number {
  const mats = depth < MAX_DEPTH ? materialsOf(recipes[id], amount) : [];
  return mats.length ? mats.reduce((a, [m, q]) => a + leaves(recipes, m, q, depth + 1), 0) : amount;
}

/** one material line of a goal, with what the stock covers (used from the top line down) */
export interface MaterialNode {
  /** unique per line (path from the goal), for its open/closed state */
  key: string;
  id: string;
  need: number;
  /** from the stock */
  have: number;
  lack: number;
  /** 0..1 in base materials: covered, plus for something craftable how far its own materials are */
  progress: number;
  /** materials of what is lacking (empty when it cannot be crafted or the depth ends) */
  children: MaterialNode[];
  /** for a filled craftable line: what the whole amount would be made of (stock not used up) */
  recipeChildren: MaterialNode[];
  craftable: boolean;
}

/**
 * Material lines of `mats` against `pool` (item -> count; used up from the top line down, so a
 * material on several lines fills the first ones first). Lacking craftable materials get their
 * own materials for the shortfall as children.
 */
export function materialTree(recipes: Recipes, mats: [string, number][], pool: Map<string, number>, path = "", depth = 0): MaterialNode[] {
  return mats.map(([id, need], i) => {
    const key = `${path}/${i}:${id}`;
    const have = Math.min(pool.get(id) ?? 0, need);
    pool.set(id, (pool.get(id) ?? 0) - have);
    const lack = need - have;
    const craftable = depth < MAX_DEPTH && !!recipes[id];
    let children: MaterialNode[] = [];
    if (lack > 0 && craftable) {
      // of the ways to make it, the one the stock covers best (the first on a tie)
      const ways = [recipes[id], ...(recipes[id].alt ?? [])];
      let best = ways[0];
      let bestFrac = -1;
      if (ways.length > 1) {
        for (const w of ways) {
          const f = covered(recipes, materialTree(recipes, materialsOf(w, lack), new Map(pool), key, depth + 1));
          if (f > bestFrac) {
            bestFrac = f;
            best = w;
          }
        }
      }
      children = materialTree(recipes, materialsOf(best, lack), pool, key, depth + 1);
    }
    // one level only: shown when a filled line is opened by hand
    const recipeChildren = lack === 0 && craftable && depth < 2 ? materialTree(recipes, materialsOf(recipes[id], need), new Map(pool), key, MAX_DEPTH) : [];
    // what is there counts whole; what is lacking counts as far as its materials are there
    const progress = need ? Math.min(1, (have + lack * (children.length ? covered(recipes, children) : 0)) / need) : 1;
    return { key, id, need, have, lack, progress, children, recipeChildren, craftable };
  });
}

/** how far lines are covered (0..1), each weighted by the base materials it takes */
function covered(recipes: Recipes, nodes: MaterialNode[]): number {
  let done = 0;
  let total = 0;
  for (const n of nodes) {
    const t = leaves(recipes, n.id, n.need);
    total += t;
    done += n.progress * t;
  }
  return total ? done / total : 1;
}

/** a goal's progress (0..1, in base materials) over its material lines */
export function treeProgress(recipes: Recipes, nodes: MaterialNode[]): number {
  let done = 0;
  let total = 0;
  for (const n of nodes) {
    const t = leaves(recipes, n.id, n.need);
    total += t;
    done += n.progress * t;
  }
  return total ? done / total : 1;
}

/** how many of the item the stock makes right now from its direct materials (whole crafts) */
export function craftableNow(recipe: Recipe | undefined, mats: [string, number][] | undefined, stock: Map<string, number>): number {
  const per = recipe ? recipe.mats : mats;
  if (!per || !per.length) return 0;
  const crafts = Math.min(...per.map(([m, q]) => Math.floor((stock.get(m) ?? 0) / q)));
  return crafts * (recipe?.n ?? 1);
}

let loading: Promise<Recipes> | null = null;
let loaded: Recipes | null = null;
/** recipe row key -> [product, how many one craft makes], where the key is not the product */
let keys: Record<string, [string, number]> = {};

/** Loads the recipes once per window. */
export function loadRecipes(): Promise<Recipes> {
  loading ??= Promise.all([
    fetch("/data/recipes.json").then((r) => (r.ok ? (r.json() as Promise<Recipes>) : {})),
    fetch("/data/recipe_keys.json").then((r) => (r.ok ? (r.json() as Promise<Record<string, [string, number]>>) : {})),
  ]).then(([r, k]) => {
    keys = k;
    return (loaded = r);
  });
  return loading;
}

/**
 * What a recipe row (a production order's recipe) makes and how many per craft. The row key is
 * mostly the product's item id; other ways to make it have keys of their own (CarbonFiber2 makes
 * CarbonFiber from charcoal). The key itself and 1 until the recipes are loaded.
 */
export function recipeOf(key: string): { product: string; n: number } {
  if (!loaded) loadRecipes();
  const k = keys[key];
  return k ? { product: k[0], n: k[1] } : { product: key, n: loaded?.[key]?.n ?? 1 };
}

/** How many one craft of the item makes (1 until the recipes are loaded, or without a recipe). */
export function recipeYield(id: string): number {
  return recipeOf(id).n;
}
