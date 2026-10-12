"""Copies the gameplay settings of a co-op world (WorldOption.sav) into a dedicated server's
PalWorldSettings.ini, keeping the server's own operation settings (name, passwords, ports,
REST/RCON, auth, crossplay, ban list).

A dedicated server uses WorldOption.sav instead of PalWorldSettings.ini when the file is in
the world folder; a co-op WorldOption has REST off and no admin password, so after running
this, remove WorldOption.sav from the server's copy of the world.

Usage: python scripts/world_option_to_ini.py <WorldOption.sav> <PalWorldSettings.ini>
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pal_sav import read_save  # noqa: E402

# kept from the server's ini
SERVER_KEYS = {
    "ServerName", "ServerDescription", "AdminPassword", "ServerPassword", "PublicPort", "PublicIP",
    "RCONEnabled", "RCONPort", "RESTAPIEnabled", "RESTAPIPort", "Region", "bUseAuth", "BanListURL",
    "bShowPlayerList", "CrossplayPlatforms", "LogFormatType", "ServerPlayerMaxNum", "bIsMultiplay", "CoopPlayerMaxNum",
}


def split_top(s: str) -> list[str]:
    """Splits on commas that are not inside parentheses."""
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return out


def fmt(v) -> str | None:
    if isinstance(v, bool):
        return "True" if v else "False"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return f"{v:.6f}"
    if isinstance(v, str):
        if "::" in v:
            return v.split("::", 1)[1]
        return f'"{v}"'
    return None  # arrays etc. are left as they are


def main() -> None:
    # the ini and the save spell a few keys differently (autoSaveSpan / AutoSaveSpan)
    option = {k.lower(): v for k, v in read_save(Path(sys.argv[1]))["OptionWorldData"]["Settings"].items()}
    ini_path = Path(sys.argv[2])
    text = ini_path.read_text(encoding="utf-8-sig")
    m = re.search(r"^OptionSettings=\((.*)\)\s*$", text, re.M)
    if not m:
        raise SystemExit("OptionSettings not found")
    entries = []
    for part in split_top(m.group(1)):
        key, _, value = part.partition("=")
        entries.append([key, value])
    known = {k.lower() for k, _ in entries}
    changed, kept, skipped = [], [], []
    for e in entries:
        key, old = e
        if key.lower() not in option:
            continue
        if key in SERVER_KEYS:
            kept.append(key)
            continue
        new = fmt(option[key.lower()])
        if new is None:
            skipped.append(key)
            continue
        # enums in the ini have no type prefix; compare as the server would write them
        if new != old:
            changed.append(f"{key}: {old} -> {new}")
            e[1] = new
    missing = sorted(k for k in option if k not in known)
    line = "OptionSettings=(" + ",".join(f"{k}={v}" for k, v in entries) + ")"
    ini_path.write_text(text[: m.start()] + line + text[m.end():], encoding="utf-8")
    print(f"changed {len(changed)}:")
    for c in changed:
        print("  " + c)
    print(f"kept from server: {', '.join(sorted(kept))}")
    print(f"not copied (arrays): {skipped}")
    print(f"in WorldOption but not in the ini: {missing}")


if __name__ == "__main__":
    main()
