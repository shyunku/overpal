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
        # a few products have more than one recipe; the first row is the regular one
        if r["product"] in out:
            continue
        e = {"n": r["count"], "mats": [[m["id"], m["n"]] for m in r["mats"]]}
        if r["product"] in bench:
            e["bench"] = bench[r["product"]]
        out[r["product"]] = e

    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    multi = sum(1 for e in out.values() if e["n"] > 1)
    print(f"recipes {len(out)} (more than one per craft: {multi}, with a building: {sum(1 for e in out.values() if 'bench' in e)}), {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
