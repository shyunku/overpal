"""Reader for Palworld's cooked localized text DataTables (e.g. DT_ItemNameText_Common).

The game cooks with unversioned properties, so rows carry no property tags. The text tables
have a single FText per row, which makes them readable without the row struct schema:

    uexp:   [u16 unversioned header][i32 RowStruct import] [i32 0]   table object
            [i32 row count]
            per row: [FName row name (i32 index, i32 number)] [u16 unversioned header] [FText]
    FText:  [u32 flags] [i8 history] then for history 0 (base): FString namespace, key, source

The key is "<row name>_TextData", so rows are returned by their name.
"""

import struct
from pathlib import Path


class Reader:
    def __init__(self, data: bytes):
        self.d = data
        self.p = 0

    def take(self, fmt: str):
        v = struct.unpack_from(fmt, self.d, self.p)[0]
        self.p += struct.calcsize(fmt)
        return v

    def fstring(self) -> str:
        n = self.take("<i")
        if n == 0:
            return ""
        if n > 0:
            s = self.d[self.p : self.p + n - 1].decode("latin-1")
            self.p += n
            return s
        n = -n
        s = self.d[self.p : self.p + 2 * (n - 1)].decode("utf-16-le")
        self.p += 2 * n
        return s


def read_name_map(uasset: Path) -> list[str]:
    r = Reader(uasset.read_bytes())
    assert r.take("<I") == 0x9E2A83C1, "not an unreal package"
    legacy = r.take("<i")
    if legacy != -4:
        r.take("<i")  # LegacyUE3Version
    r.take("<i")  # FileVersionUE4
    if legacy <= -8:
        r.take("<i")  # FileVersionUE5
    r.take("<i")  # FileVersionLicenseeUE4
    for _ in range(r.take("<i")):  # custom versions: guid + version
        r.p += 20
    r.take("<i")  # TotalHeaderSize
    r.fstring()  # FolderName
    r.take("<I")  # PackageFlags
    count = r.take("<i")
    r.p = r.take("<i")  # NameOffset
    names = []
    for _ in range(count):
        names.append(r.fstring())
        r.take("<I")  # name hashes
    return names


def _skip_unversioned_header(r: Reader) -> None:
    while True:
        frag = r.take("<H")
        has_zeroes = frag & 0x80
        if has_zeroes:
            raise ValueError(f"zero mask in unversioned header at {r.p - 2}; not a plain text row")
        if frag & 0x100:  # last fragment
            return


def read_text_table(asset_base: Path) -> dict[str, str]:
    """{row name: text} of a localized text DataTable; `asset_base` is the path without extension."""
    names = read_name_map(asset_base.with_suffix(".uasset"))
    r = Reader(asset_base.with_suffix(".uexp").read_bytes())
    _skip_unversioned_header(r)
    r.take("<i")  # RowStruct
    r.take("<i")  # object guid flag
    rows: dict[str, str] = {}
    for _ in range(r.take("<i")):
        idx, num = r.take("<i"), r.take("<i")
        row = names[idx] if num == 0 else f"{names[idx]}_{num - 1}"
        _skip_unversioned_header(r)
        r.take("<I")  # text flags
        history = r.take("<b")
        if history == 0:
            r.fstring()  # namespace
            r.fstring()  # key
            rows[row] = r.fstring()
        elif history == -1:
            has_string = r.take("<i")
            rows[row] = r.fstring() if has_string else ""
        else:
            raise ValueError(f"unsupported text history {history} in row {row}")
    return rows
