"""Builds the dex data for the main window (pals, structures, map markers) from the
palworld-helper project, and copies the icons it needs into app/public/icons/dex.

Item references (pal drops, structure materials) are mapped from palworld-helper item ids to
game item ids through app/src/data/itemTable.json: first by icon file, then by Korean name.
Run scripts/build_item_table.py first.

Usage: python scripts/build_dex.py ../palworld-helper
"""

import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ITEM_TABLE = ROOT / "app" / "src" / "data" / "itemTable.json"
# fetched by the main window only, so the other overlay windows do not load it
OUT_DATA = ROOT / "app" / "public" / "data" / "dex.json"
OUT_ICONS = ROOT / "app" / "public" / "icons" / "dex"
# game item id -> description, for the item tooltips; fetched by the main window
OUT_ITEM_DESC = ROOT / "app" / "public" / "data" / "itemDesc.json"
# building id (as the mod reports it, e.g. ItemChest_02) -> Korean name; small, bundled with the app
OUT_BUILDINGS = ROOT / "app" / "src" / "data" / "buildingNames.json"
# same size as the item icons (scripts/build_item_table.py)
ICON_SIZE = 96
PAL_STATS = ["HP", "공격", "방어", "작업 속도", "식사량"]


def main() -> None:
    helper = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT.parent / "palworld-helper")
    data = helper / "public" / "data"
    pals = json.loads((data / "pals.json").read_text(encoding="utf-8"))
    structs = json.loads((data / "structs.json").read_text(encoding="utf-8"))
    markers = json.loads((data / "markers.json").read_text(encoding="utf-8"))
    helper_items = json.loads((data / "items.json").read_text(encoding="utf-8"))
    table = json.loads(ITEM_TABLE.read_text(encoding="utf-8"))

    by_icon = {v[1]: k for k, v in table.items() if len(v) > 1 and v[1]}
    by_name = {}
    for k, v in table.items():
        by_name.setdefault(v[0], k)
    game_id = {}
    for it in helper_items:
        gid = by_icon.get(it.get("icon")) or by_name.get(it["name"])
        if gid:
            game_id[it["id"]] = gid
    unmapped = set()

    def item_ref(hid: str) -> str:
        if hid not in game_id:
            unmapped.add(hid)
        return game_id.get(hid, hid)

    icons: set[str] = set()

    def icon(name: str | None) -> str | None:
        if name:
            icons.add(name)
        return name

    # work suitability names by icon, taken from the pals (structures only carry the icon)
    work_names = {w["icon"]: w["name"] for p in pals for w in p.get("works", [])}

    out_pals = []
    for p in pals:
        out_pals.append({
            "id": p["id"],
            "code": p["code"],
            "no": p["no"],
            "name": p["name"],
            "icon": icon(p.get("icon")),
            "elements": [{"name": e["name"], "icon": icon(e["icon"])} for e in p.get("elements", [])],
            "works": [{"name": w["name"], "lv": w["lv"], "icon": icon(w["icon"])} for w in p.get("works", [])],
            "stats": {k: p.get("stats", {}).get(k) for k in PAL_STATS},
            "partner": p.get("partner"),
            "drops": [{"item": item_ref(d["id"]), "qty": d["qty"], "prob": d["prob"]} for d in p.get("drops", [])],
        })

    out_structs = []
    for s in structs:
        out_structs.append({
            "id": s["id"],
            "name": s["name"],
            "icon": icon(s.get("icon")),
            "cat": s.get("cat"),
            "techLv": s.get("techLv"),
            "mats": [{"item": item_ref(m["id"]), "qty": m["qty"]} for m in s.get("mats", [])],
            "works": [{"name": work_names.get(w["icon"], ""), "lv": w["lv"], "icon": icon(w["icon"])} for w in s.get("works") or []],
        })

    item_desc = {}
    for it in helper_items:
        gid = game_id.get(it["id"])
        if gid and it.get("desc"):
            item_desc.setdefault(gid, it["desc"].strip())
    OUT_ITEM_DESC.parent.mkdir(parents=True, exist_ok=True)
    OUT_ITEM_DESC.write_text(json.dumps(item_desc, ensure_ascii=False), encoding="utf-8")

    # structure icons are named after the building id: T_icon_buildObject_<id>.webp
    buildings = {}
    for s in structs:
        m = re.match(r"T_icon_buildObject_(.+)\.webp$", s.get("icon") or "")
        if m:
            buildings.setdefault(m.group(1), s["name"])
    OUT_BUILDINGS.write_text(json.dumps(buildings, ensure_ascii=False, indent=0), encoding="utf-8")

    layers = {}
    for key, label in [("fast", "빠른 이동"), ("tower", "탑"), ("dungeon", "던전"), ("alpha", "알파 팰")]:
        layers[key] = {"label": label, "icon": icon(markers["icons"][key]), "points": markers[key]}
    # watchtowers (관측탑), taken once from paldb's map data the same way (scripts/data/watchtowers.json);
    # no icon, the minimap draws one
    layers["watch"] = {"label": "관측탑", "icon": None, "points": json.loads((ROOT / "scripts" / "data" / "watchtowers.json").read_text(encoding="utf-8"))}

    OUT_DATA.parent.mkdir(parents=True, exist_ok=True)
    OUT_DATA.write_text(json.dumps({"pals": out_pals, "structs": out_structs, "markers": layers}, ensure_ascii=False), encoding="utf-8")

    OUT_ICONS.mkdir(parents=True, exist_ok=True)
    for old in OUT_ICONS.glob("*.webp"):
        old.unlink()
    missing = []
    for name in sorted(icons):
        src = helper / "public" / "icons" / name
        if not src.exists():
            missing.append(name)
            continue
        img = Image.open(src)
        img.thumbnail((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
        img.save(OUT_ICONS / name, "WEBP", quality=85)

    size = sum(f.stat().st_size for f in OUT_ICONS.glob("*.webp"))
    print(f"pals {len(out_pals)}, structures {len(out_structs)}, marker layers {len(layers)}, building names {len(buildings)}")
    print(f"icons {len(icons) - len(missing)} ({size / 1024 / 1024:.1f} MB), missing {len(missing)}: {missing[:5]}")
    print(f"item descriptions {len(item_desc)} ({OUT_ITEM_DESC.stat().st_size / 1024:.0f} KB)")
    print(f"data {OUT_DATA.stat().st_size / 1024:.0f} KB; item refs not mapped to game ids: {len(unmapped)} {sorted(unmapped)[:8]}")


if __name__ == "__main__":
    main()
