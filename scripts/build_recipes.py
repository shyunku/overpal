"""Builds app/public/data/recipes.json for the main window's goals: per product (game item id) how
many one craft makes, its materials and where it is made.

Recipes come from the game's DT_ItemRecipeDataTable, dumped on a running server through the mod's
probe (scripts/data/recipes_dump.json: [{key, product, count, work, mats: [{id, n}]}]). The
building names come from the palworld-helper project (its item ids are mapped to game ids by icon
or name, as in build_dex.py).

Usage: python scripts/build_recipes.py ../palworld-helper
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DUMP = ROOT / "scripts" / "data" / "recipes_dump.json"
ITEM_TABLE = ROOT / "app" / "src" / "data" / "itemTable.json"
OUT = ROOT / "app" / "public" / "data" / "recipes.json"
KEYS_OUT = ROOT / "app" / "public" / "data" / "recipe_keys.json"


def main() -> None:
    helper = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT.parent / "palworld-helper")
    helper_items = json.loads((helper / "public" / "data" / "items.json").read_text(encoding="utf-8"))
    table = json.loads(ITEM_TABLE.read_text(encoding="utf-8"))
    rows = json.loads(DUMP.read_text(encoding="utf-8"))

    by_icon = {v[1]: k for k, v in table.items() if len(v) > 1 and v[1]}
    by_name = {}
    for k, v in table.items():
        by_name.setdefault(v[0], k)
    bench = {}
    for it in helper_items:
        gid = by_icon.get(it.get("icon")) or by_name.get(it["name"])
        # untranslated entries (e.g. "ko_Text") are left out
        names = [b for b in it.get("bench") or [] if not b.isascii()]
        if gid and names:
            bench[gid] = names

    out = {}
    for r in rows:
        if not r["mats"] or r["count"] <= 0:
            continue
        mats = [[m["id"], m["n"]] for m in r["mats"]]
        # a few products have more than one recipe (carbon fiber from coal or charcoal): the first
        # row is the regular one, the others go to "alt" (made into the same product, not from it)
        if r["product"] in out:
            if all(m[0] != r["product"] for m in mats):
                out[r["product"]].setdefault("alt", []).append({"n": r["count"], "mats": mats})
            continue
        e = {"n": r["count"], "mats": mats}
        if r["product"] in bench:
            e["bench"] = bench[r["product"]]
        out[r["product"]] = e

    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # production orders name the recipe row, which is not always the product (CarbonFiber2 makes
    # CarbonFiber): row key -> [product, how many one craft makes] where they differ
    keys = {r["key"]: [r["product"], r["count"]] for r in rows if r["key"] != r["product"] and r["count"] > 0}
    KEYS_OUT.write_text(json.dumps(keys, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"recipe keys other than their product: {len(keys)}")
    multi = sum(1 for e in out.values() if e["n"] > 1)
    print(f"recipes {len(out)} (more than one per craft: {multi}, with a building: {sum(1 for e in out.values() if 'bench' in e)}), {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
