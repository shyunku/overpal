"""Builds app/src/data/itemTable.json (game item id -> Korean name, icon) and copies the icons
into app/public/icons/items.

Names come from the game's Korean item name table. The item data table (with the icon names)
is cooked with unversioned properties and cannot be read without its schema, so icons are
taken from the palworld-helper project: first by the same Korean name, then by the icon file
name, which usually contains the game id (T_itemicon_Material_Pal_crystal_S.webp).

Usage:
  1. extract the name table from the client pak (see docs/game-internals.md):
     repak unpack Pal-Windows.pak -i "Pal/Content/L10N/ko/Pal/DataTable/Text/DT_ItemNameText_Common*" -o .local/gamedata
  2. python scripts/build_item_table.py .local/gamedata ../palworld-helper
"""

import json
import re
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from ue_datatable import read_text_table  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT_TABLE = ROOT / "app" / "src" / "data" / "itemTable.json"
OUT_ICONS = ROOT / "app" / "public" / "icons" / "items"

# icon file names: T_itemicon_<category>_<id>.webp
ICON_RE = re.compile(r"^T_itemicon_(?:[A-Za-z]+_)?(.+)\.webp$", re.I)
# the overlay shows icons at most ~80 px (4K); smaller files keep the app light
ICON_SIZE = 96
# names the game leaves untranslated, filled in by hand (sources: namu.wiki, paldb)
MANUAL_NAMES = Path(__file__).parent / "item_names_manual.json"


def has_hangul(s: str) -> bool:
    return bool(re.search("[가-힣]", s))


def icon_id(icon: str) -> str | None:
    m = ICON_RE.match(icon)
    return m.group(1) if m else None


def main(gamedata: Path, helper: Path) -> None:
    names = read_text_table(gamedata / "Pal/Content/L10N/ko/Pal/DataTable/Text/DT_ItemNameText_Common")
    helper_items = json.loads((helper / "public/data/items.json").read_text(encoding="utf-8"))

    by_name: dict[str, list[str]] = {}
    by_icon_id: dict[str, str] = {}
    for it in helper_items:
        by_name.setdefault(it["name"], []).append(it["icon"])
        iid = icon_id(it["icon"])
        if iid:
            by_icon_id.setdefault(iid.lower(), it["icon"])

    def find_icon(item: str, name: str) -> str | None:
        exact = by_icon_id.get(item.lower())
        candidates = by_name.get(name, [])
        if exact and (not candidates or exact in candidates):
            return exact
        if candidates:
            return candidates[0]
        if exact:
            return exact
        # upgraded accessories share the base icon: "무저항 반지+1" -> "무저항 반지"
        plain = re.sub(r"\+\d+$", "", name)
        if plain != name and by_name.get(plain):
            return by_name[plain][0]
        # tiers often share one icon: PalEgg_Fire_02 -> PalEgg_Fire_01
        base = re.sub(r"_?\d+$", "", item).lower()
        for iid, icon in by_icon_id.items():
            if base and re.sub(r"_?\d+$", "", iid) == base:
                return icon
        return None

    ids = {row[len("ITEM_NAME_") :]: name for row, name in names.items() if row.startswith("ITEM_NAME_")}
    manual = json.loads(MANUAL_NAMES.read_text(encoding="utf-8")) if MANUAL_NAMES.exists() else {}
    helper_name_by_icon = {it["icon"]: it["name"] for it in helper_items if has_hangul(it["name"])}

    def korean_name(item: str, name: str) -> str | None:
        if has_hangul(name):
            return name
        if item in manual:
            return manual[item]
        # rarity/tier variants are untranslated ("ko_Text"); they show the base item's name
        base = re.sub(r"_?\d+$", "", item)
        for cand in (base, f"{base}_1", f"{base}1", f"{base}_01"):
            if cand != item and has_hangul(ids.get(cand, "")):
                return ids[cand]
        icon = find_icon(item, name)
        return helper_name_by_icon.get(icon) if icon else None

    table: dict[str, list[str]] = {}
    missing: list[str] = []
    for item, raw in ids.items():
        name = korean_name(item, raw)
        if not name:
            missing.append(item)
        table[item] = [name or item, find_icon(item, name or raw) or ""]

    OUT_ICONS.mkdir(parents=True, exist_ok=True)
    used = sorted({icon for _, icon in table.values() if icon})
    for old in OUT_ICONS.glob("*.webp"):
        if old.name not in used:
            old.unlink()
    for icon in used:
        img = Image.open(helper / "public/icons" / icon)
        img.thumbnail((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
        img.save(OUT_ICONS / icon, "WEBP", quality=82, method=6)

    OUT_TABLE.write_text(json.dumps(dict(sorted(table.items())), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    with_icon = sum(1 for _, icon in table.values() if icon)
    print(f"{len(table)} items, {with_icon} with icon, {len(used)} icon files -> {OUT_TABLE.relative_to(ROOT)}")
    print(f"{len(missing)} without a Korean name (shown by id): {', '.join(missing)}")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
