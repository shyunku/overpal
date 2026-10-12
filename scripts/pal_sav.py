"""Reads Palworld .sav files: PlM (Oodle) or PlZ (zlib) container around a GVAS save game.

Only what this project needs: decompress, and read the tagged properties of a GVAS body
(enough for WorldOption.sav). Oodle needs oo2core_9_win64.dll (shipped with repak, see
docs/game-internals.md).

Usage: python scripts/pal_sav.py <WorldOption.sav> [oo2core_9_win64.dll]   -> prints JSON
"""

import ctypes
import json
import struct
import sys
import zlib
from pathlib import Path

DEFAULT_OODLE = Path(__file__).resolve().parent.parent / ".local" / "tools" / "repak" / "oo2core_9_win64.dll"


def decompress(data: bytes, oodle_dll: Path = DEFAULT_OODLE) -> bytes:
    raw_len, comp_len = struct.unpack_from("<II", data, 0)
    magic, kind = data[8:11], data[11]
    body = data[12:]
    if magic == b"PlZ":
        out = zlib.decompress(body)
        # 0x32: compressed twice
        return zlib.decompress(out) if kind == 0x32 else out
    if magic == b"PlM":
        lib = ctypes.WinDLL(str(oodle_dll))
        fn = lib.OodleLZ_Decompress
        fn.restype = ctypes.c_int64
        # OodleLZ_Decompress(comp, compLen, raw, rawLen, fuzzSafe, checkCRC, verbosity,
        #   decBufBase, decBufSize, callback, callbackUserData, decoderMemory, decoderMemorySize, threadPhase)
        fn.argtypes = [ctypes.c_char_p, ctypes.c_int64, ctypes.c_char_p, ctypes.c_int64, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                       ctypes.c_void_p, ctypes.c_int64, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int64, ctypes.c_int]
        dst = ctypes.create_string_buffer(raw_len)
        n = fn(body[:comp_len], comp_len, dst, raw_len, 1, 0, 0, None, 0, None, None, None, 0, 3)
        if n != raw_len:
            raise ValueError(f"oodle: got {n} of {raw_len} bytes")
        return dst.raw
    raise ValueError(f"unknown save container {magic!r}")


class Reader:
    def __init__(self, b: bytes):
        self.b, self.p = b, 0

    def take(self, n: int) -> bytes:
        v = self.b[self.p : self.p + n]
        self.p += n
        return v

    def u8(self): return self.take(1)[0]
    def i32(self): return struct.unpack("<i", self.take(4))[0]
    def u32(self): return struct.unpack("<I", self.take(4))[0]
    def i64(self): return struct.unpack("<q", self.take(8))[0]
    def f32(self): return struct.unpack("<f", self.take(4))[0]
    def f64(self): return struct.unpack("<d", self.take(8))[0]

    def fstr(self) -> str:
        n = self.i32()
        if n == 0:
            return ""
        if n < 0:
            return self.take(-n * 2)[:-2].decode("utf-16-le")
        return self.take(n)[:-1].decode("utf-8", "replace")

    def guid(self) -> str:
        return self.take(16).hex()


def read_header(r: Reader) -> None:
    """Skips the GVAS header (save game version, engine version, custom versions, class)."""
    assert r.take(4) == b"GVAS"
    r.i32()  # save game version
    r.i32()  # package version UE4
    r.i32()  # package version UE5
    r.take(2 * 3 + 4)  # engine major/minor/patch, changelist
    r.fstr()  # branch
    r.i32()  # custom version format
    for _ in range(r.i32()):
        r.guid()
        r.i32()
    r.fstr()  # save game class


def read_props(r: Reader) -> dict:
    """Tagged properties until "None"."""
    out = {}
    while True:
        name = r.fstr()
        if name == "None":
            return out
        ptype = r.fstr()
        size = r.i64()
        out[name] = read_value(r, ptype, size)


def read_value(r: Reader, ptype: str, size: int):
    if ptype == "StructProperty":
        sname = r.fstr()
        r.guid()
        r.u8()
        if sname in ("Guid",):
            return r.guid()
        if sname in ("Vector",):
            return [r.f64(), r.f64(), r.f64()]
        if sname in ("DateTime",):
            return r.i64()
        return read_props(r)
    if ptype == "EnumProperty":
        r.fstr()  # enum type
        r.u8()
        return r.fstr()
    if ptype == "ByteProperty":
        enum = r.fstr()
        r.u8()
        return r.fstr() if enum != "None" else r.u8()
    if ptype == "BoolProperty":
        v = r.u8()
        r.u8()
        return bool(v)
    if ptype in ("ArrayProperty", "SetProperty"):
        inner = r.fstr()
        r.u8()
        return {"_type": ptype, "_inner": inner, "_raw": r.take(size).hex()}
    if ptype == "MapProperty":
        key, value = r.fstr(), r.fstr()
        r.u8()
        return {"_type": ptype, "_key": key, "_value": value, "_raw": r.take(size).hex()}
    r.u8()  # has property guid
    if ptype == "IntProperty":
        return r.i32()
    if ptype == "UInt32Property":
        return r.u32()
    if ptype == "Int64Property":
        return r.i64()
    if ptype == "FloatProperty":
        return r.f32()
    if ptype == "DoubleProperty":
        return r.f64()
    if ptype in ("StrProperty", "NameProperty"):
        return r.fstr()
    # unknown: keep the raw bytes so reading can go on
    return {"_type": ptype, "_raw": r.take(size).hex()}


def read_save(path: Path) -> dict:
    r = Reader(decompress(path.read_bytes()))
    read_header(r)
    return read_props(r)


if __name__ == "__main__":
    dll = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OODLE
    r = Reader(decompress(Path(sys.argv[1]).read_bytes(), dll))
    read_header(r)
    print(json.dumps(read_props(r), ensure_ascii=False, indent=1))
