#!/usr/bin/env python3
"""Generic T5 (Black Ops 1) fastfile zone reader.

Implements the zone loading semantics of OpenAssetTools (GPL-3) for T5 zones
in pure Python: the IWffu100 container, the 7-block memory model with
FOLLOWING/INSERT/OFFSET zone pointers, and a DSL-driven struct walker for the
asset trees. Struct layouts are parsed directly from oat/T5_Assets.h and the
serialization hints from the oat/dsl/*.txt ZoneCode files.

Usage:
    python3 t5_zone.py <zone.ff>            # walk + validate + summary
    python3 t5_zone.py <zone.ff> --json out # walk + dump assets to JSON sidecars
"""
import argparse
import json
import os
import re
import struct
import sys
import zlib
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
OAT = os.path.join(HERE, "oat")

BLOCK_SHIFT = 29
OFFSET_MASK = (1 << BLOCK_SHIFT) - 1
PTR_FOLLOWING = 0xFFFFFFFF
PTR_INSERT = 0xFFFFFFFE

BLOCK_NAMES = ["TEMP", "RUNTIME", "LARGE_RUNTIME", "PHYSICAL_RUNTIME", "VIRTUAL", "LARGE", "PHYSICAL"]
BLOCK_TEMP, BLOCK_RUNTIME, BLOCK_VIRTUAL = 0, 1, 4

BASE_TYPES = {
    "char": (1, 1), "unsigned char": (1, 1), "signed char": (1, 1), "uint8_t": (1, 1), "int8_t": (1, 1),
    "short": (2, 2), "unsigned short": (2, 2), "int16_t": (2, 2), "uint16_t": (2, 2),
    "int": (4, 4), "unsigned int": (4, 4), "unsigned": (4, 4), "int32_t": (4, 4), "uint32_t": (4, 4),
    "float": (4, 4), "bool": (1, 1), "long": (4, 4), "unsigned long": (4, 4),
    "int64_t": (8, 8), "uint64_t": (8, 8), "double": (8, 8),
    "void": (1, 1),
}
SCRATCH_TYPES = {  # typedef'd leaf types: name -> (size, align)
    "vec2_t": (8, 4), "vec3_t": (12, 4), "vec4_t": (16, 4),
    "GfxColor": (4, 4), "PackedUnitVec": (4, 4), "PackedTexCoords": (4, 4),
    "raw_uint128": (16, 16), "Scr_string": (2, 2), "ScriptString": (2, 2),
    "scr_string_t": (2, 2), "cplane_s": None,  # resolved as struct
}


class Member:
    __slots__ = ("name", "type_name", "ptr", "array", "offset", "size", "flex", "elem_mult")

    def __init__(self, name, type_name, ptr, array, offset, size, flex=False, elem_mult=1):
        self.elem_mult = elem_mult
        self.name = name
        self.type_name = type_name
        self.ptr = ptr  # pointer depth: 0 = value, 1 = T*, 2 = T**
        self.array = array
        self.offset = offset
        self.size = size
        self.flex = flex  # char x[1] flexible array


class StructDef:
    def __init__(self, name, size, align, members, is_union=False):
        self.name = name
        self.size = size
        self.align = align
        self.members = members
        self.is_union = is_union
        self.flex_member = None  # Member with char x[1]


def _strip_comments(text):
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"//[^\n]*", "", text)
    return text


ATTR_RE = re.compile(r"(?:type_align32|gcc_align32|type_align|tdef_align32)\(\s*(\d+)\s*\)")


class HeaderParser:
    def __init__(self, text):
        self.text = _strip_comments(text)
        self.structs = {}
        self.typedefs = {}   # alias -> (real type name, align override, array size|None)
        self.enums = {}
        self.enum_sizes = {}
        self._parse_enums()
        self._parse_typedefs()
        self._parse_structs()

    def _parse_enums(self):
        def parse_val(v):
            v = v.strip()
            try:
                return int(v, 0)
            except ValueError:
                if v in self.enums and isinstance(self.enums[v], int):
                    return self.enums[v]
                return None
        for m in re.finditer(r"\benum\s+(\w+)\s*(?::\s*([\w ]+?))?\s*\{(.*?)\};", self.text, re.S):
            name, under, body = m.group(1), m.group(2), m.group(3)
            if under:
                t = under.strip()
                self.enum_sizes[name] = BASE_TYPES.get(self.typedef_free(t), (4, 4))[0]
            val = 0
            for item in body.split(","):
                item = item.strip()
                if not item:
                    continue
                if "=" in item:
                    k, v = item.split("=", 1)
                    parsed = parse_val(v)
                    if parsed is None:
                        self.enums[k.strip()] = v
                        continue
                    self.enums[k.strip()] = parsed
                    val = parsed + 1
                else:
                    self.enums[item] = val
                    val += 1
            self.enums[name] = name
        for k, v in list(self.enums.items()):
            if isinstance(v, str) and v in self.enums and isinstance(self.enums[v], int):
                self.enums[k] = self.enums[v]

    def typedef_free(self, t):
        while t in self.typedefs:
            t = self.typedefs[t][0]
        return t

    def _eval_const_expr(self, expr):
        def lookup(m):
            v = self.enums.get(m.group(0))
            if not isinstance(v, int):
                raise ValueError(m.group(0))
            return str(v)
        e = re.sub(r"\b[A-Za-z_]\w*\b", lookup, expr)
        return int(eval(e))

    def _parse_typedefs(self):
        for m in re.finditer(r"typedef\s+(?:\w+\(\s*\d+\s*\)\s+)?([\w ]+?)\s+(\w+)\s*(?:\[(\d+)\])?\s*;", self.text):
            base, alias = m.group(1).strip(), m.group(2)
            am = ATTR_RE.search(m.group(0))
            arr = int(m.group(3)) if m.group(3) else None
            self.typedefs[alias] = (base, int(am.group(1)) if am else None, arr)

    def _parse_structs(self):
        struct_re = re.compile(r"\b(?:struct|union)\s+((?:\w+\(\s*\d+\s*\)\s+)*)"
                               r"(\w+)\s*\{")
        for m in struct_re.finditer(self.text):
            name = m.group(2)
            start = m.end()
            depth, pos = 1, start
            while depth:
                c = self.text[pos]
                if c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                pos += 1
            body = self.text[start:pos - 1]
            after = self.text[pos:pos + 80]
            is_union = m.group(0).lstrip().startswith("union")
            align_override = None
            am = ATTR_RE.search(m.group(1) or "")
            if am:
                align_override = int(am.group(1))
            if ";" in after.split("\n")[0] or after.lstrip().startswith(";"):
                sd = self._parse_body(name, body, align_override, is_union)
                self.structs[name] = sd

    def resolve(self, type_name):
        """Resolve typedefs to underlying type name (array size via array_of)."""
        seen = set()
        t = type_name
        while t in self.typedefs and t not in seen:
            seen.add(t)
            t = self.typedefs[t][0]
        return t

    def array_of(self, type_name):
        """Total fixed array size for array typedefs (e.g. ByteVec[3])."""
        t, mult = type_name, 1
        seen = set()
        while t in self.typedefs and t not in seen:
            seen.add(t)
            base, _, arr = self.typedefs[t]
            if arr:
                mult *= arr
            t = base
        return mult if mult > 1 else None

    def type_size_align(self, type_name):
        if type_name in self.structs:
            sd = self.structs[type_name]
            return sd.size, sd.align
        if type_name in BASE_TYPES:
            return BASE_TYPES[type_name]
        if type_name in self.typedefs:
            bs, ba = self.type_size_align(self.resolve(type_name))
            ov = self.typedefs[type_name][1]
            arr = self.array_of(type_name)
            if arr:
                return bs * arr, (ov or ba)
            return bs, (ov or ba)
        if type_name in self.enum_sizes:
            s = self.enum_sizes[type_name]
            return s, s
        if type_name in self.enums and type_name not in self.structs:
            return 4, 4
        if type_name in SCRATCH_TYPES and SCRATCH_TYPES[type_name]:
            return SCRATCH_TYPES[type_name]
        return 4, 4  # unknown scalar fallback

    def _parse_body(self, name, body, align_override, is_union=False):
        decls = self._split_decls(body)
        members = []
        offset = 0
        max_align = 1
        bitfield_pending = None  # (base, bits_used)

        def flush_bitfield():
            nonlocal offset, max_align, bitfield_pending
            if bitfield_pending is None:
                return
            base, bits = bitfield_pending
            bitfield_pending = None
            bsz, _ = self.type_size_align(base)
            n_units = max(1, (bits + bsz * 8 - 1) // (bsz * 8))
            total = n_units * bsz
            off = (offset + bsz - 1) & ~(bsz - 1) if not is_union else 0
            members.append(Member("__bits__", base, 0, None, off, total))
            if is_union:
                offset = max(offset, total)
            else:
                offset = off + total
            max_align = max(max_align, bsz)

        for decl in decls:
            decl = decl.strip()
            if not decl:
                continue
            if ":" in decl and re.match(r"^(?:\w+\(\s*\d+\s*\)\s+)*[\w ]+?\s+\w+\s*:", decl):
                bm = re.match(r"^(?:\w+\(\s*\d+\s*\)\s+)*([\w ]+?)\s+\w+\s*:\s*(\d+)", decl)
                base, bits = bm.group(1).strip(), int(bm.group(2))
                if bitfield_pending is not None and bitfield_pending[0] != base:
                    flush_bitfield()
                prev = bitfield_pending[1] if bitfield_pending else 0
                bitfield_pending = (base, prev + bits)
                continue
            flush_bitfield()
            # nested struct/union definition
            nm = re.match(r"(struct|union)\s+((?:\w+\(\s*\d+\s*\)\s+)*)(\w+)\s*\{(.*)$", decl, re.S)
            if nm:
                inner_name = nm.group(3)
                inner_align = None
                am = ATTR_RE.search(nm.group(2) or "")
                if am:
                    inner_align = int(am.group(1))
                sd = self._parse_body(inner_name, nm.group(4), inner_align, nm.group(1) == "union")
                self.structs[inner_name] = sd
                members.append(Member(inner_name, inner_name, 0, None, offset, sd.size))
                offset += sd.size
                max_align = max(max_align, sd.align)
                continue
            # normal declaration: [const] Type[*|**] name[array];
            dm = re.match(r"(?:const\s+)?(?:volatile\s+)?(?:(?:type_align32|gcc_align32|type_align|tdef_align32)\(\s*\d+\s*\)\s+)*(.+?)\s+(\w+)((?:\[[\w+\-* ]+\])*)\s*$", decl, re.S)
            if not dm:
                continue
            type_part, mname = dm.group(1).strip(), dm.group(2)
            array = None
            if dm.group(3):
                dims = re.findall(r"\[([\w+\-* ]+)\]", dm.group(3) or "")
                total = 1
                ok = True
                for av in dims:
                    av = av.strip()
                    if re.match(r"^\d+$", av):
                        v = int(av)
                    elif av in self.enums and isinstance(self.enums[av], int):
                        v = self.enums[av]
                    else:
                        try:
                            v = self._eval_const_expr(av)
                        except Exception:
                            ok = False
                            break
                    total *= v
                array = total if ok else None
            depth = type_part.count("*")
            is_ptr = depth > 0
            base = self.resolve(type_part.replace("*", "").strip())
            base = re.sub(r"^(?:const|volatile)\s+", "", base)
            flex = False
            if array == 1 and not is_ptr and base in ("char", "unsigned char", "uint8_t"):
                flex = True
            tarr = self.array_of(mname) if False else self.array_of(type_part.replace("*", "").strip())
            if is_ptr:
                esz, eal = 4, 4
                total = 4 * (array or 1)
            else:
                esz, eal = self.type_size_align(base)
                if esz is None:
                    esz, eal = 4, 4
                total = esz * (array or 1) * (tarr or 1)
            if is_union:
                off = 0
            else:
                off = (offset + eal - 1) & ~(eal - 1)
            mem = Member(mname, base, depth if is_ptr else 0, array, off, total, flex,
                         (tarr or 1) if is_ptr else 1)
            members.append(mem)
            if is_union:
                offset = max(offset, total)
            else:
                offset = off + total
            max_align = max(max_align, eal)
        flush_bitfield()
        align = align_override or max_align
        size = (offset + align - 1) & ~(align - 1)
        sd = StructDef(name, size, align, members, is_union)
        sd.flex_member = next((m for m in members if m.flex), None)
        return sd

    @staticmethod
    def _split_decls(body):
        decls, cur, depth = [], [], 0
        for c in body:
            if c in "{[":
                depth += 1
            elif c in "}]":
                depth -= 1
            if c == ";" and depth == 0:
                decls.append("".join(cur))
                cur = []
            else:
                cur.append(c)
        tail = "".join(cur).strip()
        if tail:
            decls.append(tail)
        return decls


# ---------------------------------------------------------------------------
# DSL
# ---------------------------------------------------------------------------

class StructDsl:
    def __init__(self, name):
        self.name = name
        self.block = None
        self.strings = set()
        self.scriptstrings = set()
        self.counts = {}       # member name/path -> expr
        self.reusable = set()
        self.blocks = {}       # member name/path -> block index
        self.allocalign = {}
        self.cond_never = set()
        self.cond_expr = {}
        self.arraysize = {}
        self.reorder = []
        self.has_use = False


def parse_dsl_folder(dsl_dir):
    dsls = {}
    for fn in sorted(os.listdir(dsl_dir)):
        if not fn.endswith(".txt"):
            continue
        cur = None
        in_reorder = False
        pending = None
        for raw in open(os.path.join(dsl_dir, fn), errors="ignore"):
            line = raw.strip()
            if not line or line.startswith("//"):
                continue
            if pending is not None:
                # continuation of a statement that spans lines
                line = pending + " " + line
                pending = None
            if not in_reorder and line.startswith("set ") and not line.endswith(";"):
                pending = line
                continue
            if in_reorder:
                if line.endswith(";"):
                    tok = line[:-1].strip()
                    if tok:
                        cur.reorder.append(tok)
                    in_reorder = False
                    continue
                cur.reorder.append(line)
                continue
            m = re.match(r"use\s+(\w+)\s*;", line)
            if m:
                cur = dsls.setdefault(m.group(1), StructDsl(m.group(1)))
                cur.has_use = True
                continue
            if cur is None:
                continue
            m = re.match(r"set\s+block\s+(\w+)\s*;$", line)
            if m:
                cur.block = m.group(1)
                continue
            m = re.match(r"set\s+block\s+(\S+)\s+(XFILE_BLOCK_\w+)\s*;", line)
            if m:
                cur.blocks[m.group(1)] = BLOCK_NAMES.index(m.group(2).replace("XFILE_BLOCK_", ""))
                continue
            m = re.match(r"set\s+string\s+(\S+)\s*;", line)
            if m:
                cur.strings.add(m.group(1))
                continue
            m = re.match(r"set\s+scriptstring\s+(\S+)\s*;", line)
            if m:
                cur.scriptstrings.add(m.group(1))
                continue
            m = re.match(r"set\s+count\s+(\S+)\s+(.+?)\s*;", line)
            if m:
                cur.counts[m.group(1)] = m.group(2)
                continue
            m = re.match(r"set\s+reusable\s+(\S+)\s*;", line)
            if m:
                cur.reusable.add(m.group(1))
                continue
            m = re.match(r"set\s+allocalign\s+(\S+)\s+(\d+)\s*;", line)
            if m:
                cur.allocalign[m.group(1)] = int(m.group(2))
                continue
            m = re.match(r"set\s+arraysize\s+(\S+)\s+(.+?)\s*;", line)
            if m:
                cur.arraysize[m.group(1)] = m.group(2)
                continue
            m = re.match(r"set\s+condition\s+(\S+)\s+never\s*;", line)
            if m:
                cur.cond_never.add(m.group(1))
                continue
            m = re.match(r"set\s+condition\s+(\S+)\s+(.+?)\s*;", line)
            if m:
                expr = m.group(2)
                if all(re.match(r"^[\w:\[\]]+\s*(==|!=|<=|>=|<|>)\s*\w+$", t.strip())
                       or re.match(r"^!?[A-Za-z_][\w:\[\]]*$", t.strip())
                       for t in re.split(r"\|\||&&", expr)):
                    cur.cond_expr[m.group(1)] = expr
                else:
                    cur.cond_never.add(m.group(1))
                continue
            m = re.match(r"reorder\s+(\w+)\s*:?\s*$", line)
            if m:
                target = dsls.setdefault(m.group(1), StructDsl(m.group(1)))
                cur = target
                in_reorder = True
                continue
            m = re.match(r"reorder\s*:?\s*$", line)
            if m:
                in_reorder = True
                continue
        # end file
    return dsls


ASSET_TYPES = [
    "XModelPieces", "PhysPreset", "PhysConstraints", "DestructibleDef", "XAnimParts",
    "XModel", "Material", "MaterialTechniqueSet", "GfxImage", "SndBank", "SndPatch",
    "clipMap_t", None, "ComWorld", "GameWorldSp", "GameWorldMp", "MapEnts", "GfxWorld",
    "GfxLightDef", "UiMap", "Font_s", "MenuList", "menuDef_t", "LocalizeEntry",
    "WeaponVariantDef", "WeaponDef", "WeaponVariantDef", "SndDriverGlobals", "FxEffectDef",
    "FxImpactTable", "AiType", "MpType", "MpBody", "MpHead", "Character", "XModelAlias",
    "RawFile", "StringTable", "PackIndex", "XGlobals", "ddlRoot_t", "Glasses", "EmblemSet",
]
ASSET_STRUCTS = {
    "PhysPreset", "PhysConstraints", "DestructibleDef", "XAnimParts", "XModel", "Material",
    "MaterialTechniqueSet", "GfxImage", "SndBank", "SndPatch", "clipMap_t", "ComWorld",
    "GameWorldSp", "GameWorldMp", "MapEnts", "GfxWorld", "GfxLightDef", "Font_s", "MenuList",
    "menuDef_t", "LocalizeEntry", "WeaponVariantDef", "SndDriverGlobals", "FxEffectDef",
    "FxImpactTable", "RawFile", "StringTable", "PackIndex", "XGlobals", "ddlRoot_t",
    "Glasses", "EmblemSet", "XModelPieces",
}


# ---------------------------------------------------------------------------
# Walker
# ---------------------------------------------------------------------------

class ZoneError(Exception):
    pass


class Ref:
    """A landed object (array or struct instance) at (block, offset)."""
    __slots__ = ("block", "offset", "obj", "kind")

    def __init__(self, block, offset, obj, kind="data"):
        self.block = block
        self.offset = offset
        self.obj = obj
        self.kind = kind  # 'data' | 'insert'


class PendingRef:
    """A zone offset that could not be resolved yet (forward reference)."""
    __slots__ = ("block", "offset")

    def __init__(self, block, offset):
        self.block = block
        self.offset = offset


class StructArray(list):
    """Decoded embedded array of structs (e.g. PhysConstraints.data[16]).
    String keys fall through to element 0 so older path lookups still work."""

    def __getitem__(self, k):
        if isinstance(k, str):
            return list.__getitem__(self, 0)[k]
        return list.__getitem__(self, k)


class T5Zone:
    def __init__(self, path):
        raw = open(path, "rb").read()
        if raw[:8] not in (b"IWffu100", b"IWffr100"):
            raise ZoneError("not a T5 fastfile")
        self.version, = struct.unpack_from("<I", raw, 8)
        if raw[:8] == b"IWffr100":
            self.data = raw[12:]  # reference-pack zones are stored uncompressed
        else:
            d = zlib.decompressobj()
            self.data = d.decompress(raw[12:])
        self.pos = 8
        self.block_sizes = struct.unpack_from("<7I", self.data, self.pos)
        self.pos += 28
        self.cursors = [0] * 7
        self.mem = [dict() for _ in range(7)]
        self.block_stack = []
        self.temp_stack = []
        self.script_strings = []
        self.assets = []           # (type_idx, type_name, name_or_None, obj)
        hp = HeaderParser(open(os.path.join(OAT, "T5_Assets.h"), errors="ignore").read())
        self.structs = hp.structs
        self.enums = hp.enums
        self.hdr = hp
        self.dsls = parse_dsl_folder(os.path.join(OAT, "dsl"))
        self.ctx_trace = ["<zone>"]
        self.deferred = True
        self.resync = True
        self.skipped = 0
        self.insert_slots = []
        self.poison = False
        self.poison_events = []
        self.soft_errors = []   # recoverable problems (the asset is kept, its bad pointer becomes None)
        self.asset_spans = []   # {index, type, start, end}: where each walked asset sat in the stream
        self.failed_spans = []  # raw stream spans of assets that failed: {index, type, error, start, end}

    # ----- stream -----
    def read_stream(self, n):
        d = self.data[self.pos:self.pos + n]
        if len(d) < n:
            raise ZoneError(f"stream exhausted at {self.pos:#x} need {n} (trace={self.ctx_trace[-6:]})")
        self.pos += n
        return d

    def read(self, n, block=None, align=None):
        b = block if block is not None else (self.block_stack[-1] if self.block_stack else None)
        pass  # padding disabled: stream advances only by real data
        if b is not None and BLOCK_NAMES[b].endswith("RUNTIME"):
            self.cursors[b] += n
            return b"\x00" * n
        d = self.read_stream(n)
        if b is not None:
            self.cursors[b] += n
        return d

    def alloc(self, block, align, obj):
        if align > 1:
            self.cursors[block] = (self.cursors[block] + align - 1) & ~(align - 1)
        off = self.cursors[block]
        self.mem[block][off] = obj
        return Ref(block, off, obj)

    def read_cstr(self):
        end = self.data.index(b"\x00", self.pos)
        s = self.data[self.pos:end]
        self.pos = end + 1
        if self.block_stack:
            self.cursors[self.block_stack[-1]] += len(s) + 1
        return s

    # ----- blocks -----
    def push_block(self, b):
        self.block_stack.append(b)
        if b == BLOCK_TEMP:
            self.temp_stack.append(self.cursors[b])

    def pop_block(self):
        b = self.block_stack.pop()
        if b == BLOCK_TEMP:
            self.cursors[b] = self.temp_stack.pop()

    # ----- pointers -----
    @staticmethod
    def classify(v):
        if v == 0:
            return "null", None
        if v == PTR_FOLLOWING:
            return "following", None
        if v == PTR_INSERT:
            return "insert", None
        v -= 1
        block = v >> BLOCK_SHIFT
        if block >= len(BLOCK_NAMES):
            return "null", None
        return "offset", (block, v & OFFSET_MASK)

    def resolve(self, block, offset):
        if not (0 <= block < 7):
            # a pointer into a block that does not exist: keep the asset (partial) instead of losing it
            if len(self.soft_errors) < 2000:
                self.soft_errors.append(f"OFFSET with invalid block {block} (trace={self.ctx_trace[-6:]})")
            return None
        obj = self.mem[block].get(offset)
        if obj is None:
            if self.deferred:
                return PendingRef(block, offset)
            raise ZoneError(f"unresolved OFFSET {BLOCK_NAMES[block]}+{offset:#x} (trace={self.ctx_trace[-6:]})")
        return obj

    # ----- expression evaluation -----
    def eval_expr(self, expr, ctx):
        """ctx: list of (struct_name, vals) innermost last. Supports a::b[N], ints, enums."""
        def lookup(m):
            path = m.group(0)
            if not re.match(r"[A-Za-z_]", path):
                return path
            return str(self._lookup_path(path, ctx))
        e = re.sub(r"\w+(?:::\w+)*(?:\[\d+\])?", lookup, expr)
        e = e.replace("/", "//")
        try:
            return int(eval(e))
        except Exception as ex:
            raise ZoneError(f"expr eval failed: {expr!r} -> {e!r}: {ex} (trace={self.ctx_trace[-6:]})")

    def _lookup_path(self, path, ctx):
        parts = re.split(r"::", path)
        if len(parts) == 1 and "::" not in path:
            # single identifier: enum constant?
            v = self.enums.get(parts[0])
            if isinstance(v, int):
                return v
        # find first segment innermost-out
        val = None
        if len(parts) > 1:
            # `Type::member` where Type is an enclosing struct (FxElemDef::elemType)
            for sname, vals in reversed(ctx):
                if sname == parts[0] and parts[1].split("[")[0] in vals:
                    parts = parts[1:]
                    break
        m0 = re.match(r"(\w+)\[(\d+)\]$", parts[0])
        first, first_idx = (m0.group(1), int(m0.group(2))) if m0 else (parts[0], None)
        for sname, vals in reversed(ctx):
            if first in vals:
                val = vals[first]
                break
        if val is None:
            raise ZoneError(f"lookup failed for {parts[0]} in {path}")
        if first_idx is not None:
            val = val[first_idx]
        for p in parts[1:]:
            m = re.match(r"(\w+)\[(\d+)\]", p)
            if m:
                val = val[m.group(1)][int(m.group(2))]
            else:
                val = val[p]
        if isinstance(val, (bytes, bytearray)):
            val = int.from_bytes(val[:4], "little")
        return val

    def eval_cond(self, expr, ctx):
        if "||" in expr:
            return any(self.eval_cond(t.strip(), ctx) for t in expr.split("||"))
        if "&&" in expr:
            return all(self.eval_cond(t.strip(), ctx) for t in expr.split("&&"))
        bare = re.match(r"^(!?)([A-Za-z_][\w:\[\]]*)$", expr)
        if bare:
            val = self._lookup_path(bare.group(2), ctx)
            if isinstance(val, (bytes, bytearray)):
                val = int.from_bytes(val, "little")
            return (not val) if bare.group(1) else bool(val)
        m = re.match(r"^([\w:\[\]]+)\s*(==|!=|<=|>=|<|>)\s*(\w+)$", expr)
        if not m:
            raise ZoneError(f"bad condition {expr!r}")
        left = self._lookup_path(m.group(1), ctx)
        if isinstance(left, bytes):
            left = int.from_bytes(left, "little")
        right = self.enums.get(m.group(3))
        if right is None:
            right = int(m.group(3), 0)
        op = m.group(2)
        return {"==": left == right, "!=": left != right, "<": left < right,
                ">": left > right, "<=": left <= right, ">=": left >= right}[op]

    # ----- struct loading -----
    def struct_dsl(self, tname):
        return self.dsls.get(tname)

    def load_struct(self, tname, ctx, alloc_in_block=None, treat=True, flex_counts=None):
        """Load one instance: inline fields (into alloc block) + treated members.
        Returns dict of values. `alloc_in_block`: block for the struct storage
        (already allocated by caller). `flex_counts`: arraysize overrides."""
        sd = self.structs.get(tname)
        if sd is None:
            raise ZoneError(f"unknown struct {tname}")
        dsl = self.struct_dsl(tname)
        flex = None
        if dsl and sd.flex_member and sd.flex_member.name in dsl.arraysize:
            flex = sd.flex_member
        if flex is not None:
            # two-phase read: prefix up to the flexible member, then count bytes
            prefix = flex.offset
            raw = self.read(prefix, block=alloc_in_block, align=sd.align)
            vals = self.decode(sd, raw, ctx, tname)
            try:
                n = self.eval_expr(dsl.arraysize[flex.name], ctx + [(tname, vals)])
            except ZoneError:
                n = 1
            data = self.read(n, block=alloc_in_block)
            vals[flex.name] = data
        else:
            raw = self.read(sd.size, block=alloc_in_block, align=sd.align)
            vals = self.decode(sd, raw, ctx, tname)
        if not treat:
            return vals
        newctx = ctx + [(tname, vals)]
        pushed = False
        if tname in ASSET_STRUCTS:
            self.push_block(BLOCK_VIRTUAL)
            pushed = True
        elif dsl and dsl.block is not None:
            self.push_block(BLOCK_NAMES.index(dsl.block))
            pushed = True
        try:
            self.treat_members(sd, dsl, vals, newctx)
        finally:
            if pushed:
                self.pop_block()
        return vals

    def treat_members(self, sd, dsl, vals, ctx, scopes=None):
        """Treat pointer members. `dsl` = this struct's own use-section (if
        any); `scopes` = ancestor [(dsl, member-prefix)] chain innermost last."""
        scopes = scopes or []
        order = self._treated_member_names(sd, dsl)
        skip_default = False
        if sd.is_union:
            for uname in order:
                uinfo = self._member_info(dsl, sd, uname, scopes)
                if uinfo["cond"] is None or uinfo["cond_never"]:
                    continue
                try:
                    if self.eval_cond(uinfo["cond"], self._owner_ctx(ctx, uinfo["cond_owner"])):
                        skip_default = True
                        break
                except ZoneError:
                    continue
        for name in order:
            if skip_default:
                dinfo = self._member_info(dsl, sd, name, scopes)
                if dinfo["cond"] is None and not dinfo["cond_never"]:
                    continue
            self.ctx_trace.append(f"{sd.name}.{name}")
            try:
                if os.environ.get("T5_TRACE"):
                    m = next((x for x in sd.members if x.name == name), None)
                    pv = vals.get(name) if m else None
                    print(f"{'  ' * min(len(self.ctx_trace), 8)}TREAT {sd.name}.{name}"
                          f" ptr={m.ptr if m else '?'} val={pv if not isinstance(pv, int) or pv < 0x1000 else hex(pv)}"
                          f" pos={self.pos:#x}", file=sys.stderr)
                self._treat(sd, dsl, name, vals, ctx, scopes)
            finally:
                self.ctx_trace.pop()

    INLINE_ARRAY_CAPACITY = 4
    PARTIAL_STRUCT_TAIL = {
        "XAnimPartTrans": (lambda v: v.get("size") == 0, 20),
        "XAnimDeltaPartQuat": (lambda v: v.get("size") == 0, 4),
    }

    @staticmethod
    def _owner_ctx(ctx, owner):
        if owner is not None:
            for i in range(len(ctx) - 1, -1, -1):
                if ctx[i][0] == owner:
                    return ctx[:i + 1]
        return ctx

    def _eval_count(self, expr, ctx, info=None):
        try:
            return self.eval_expr(expr, ctx)
        except ZoneError:
            owner = info.get("count_owner") if info else None
            if owner is None:
                raise
            for i in range(len(ctx) - 1, -1, -1):
                if ctx[i][0] == owner:
                    return self.eval_expr(expr, ctx[:i + 1])
            raise

    def _treat_inline_indices(self, sd, dsl, m, info, vals, ctx, scopes):
        if m.name == "_2":
            sibling = self._member_info(dsl, sd, "_1", scopes)
            if sibling["cond"] is not None and self.eval_cond(sibling["cond"], self._owner_ctx(ctx, sibling["cond_owner"])):
                return
        owner = info["arraysize_owner"]
        scope_ctx = ctx
        for i in range(len(ctx) - 1, -1, -1):
            if ctx[i][0] == owner:
                scope_ctx = ctx[:i + 1]
                break
        count = self.eval_expr(info["arraysize"], scope_ctx)
        esz = max(1, m.size // (m.array or 1))
        extra = count * esz - self.INLINE_ARRAY_CAPACITY
        if extra == 0:
            return
        if extra < 0:
            self.pos += extra
            ctop = self.block_stack[-1] if self.block_stack else None
            if ctop is not None and not BLOCK_NAMES[ctop].endswith("RUNTIME"):
                self.cursors[ctop] += extra
            return
        top = self.block_stack[-1] if self.block_stack else BLOCK_TEMP
        tail = self.read(extra, block=top)
        head = vals.get(m.name)
        vals[m.name] = (bytes(head) + tail) if isinstance(head, (bytes, bytearray)) else tail

    def _member_info(self, dsl, sd, name, scopes):
        """Resolve DSL flags for member `name`. Keys match by path suffix:
        a DSL entry "u::water" applies to any member whose full path ends with
        "u::water". Own section first, then ancestors (innermost first)."""
        info = {"count": None, "reusable": False, "block": None, "align": None,
                "string": False, "scriptstring": False, "cond_never": False, "cond": None,
                "arraysize": None, "arraysize_owner": None, "count_owner": None, "cond_owner": None}

        def apply_from(d, keys):
            if d is None:
                return
            for key in keys:
                if key is None:
                    continue
                if key in d.counts:
                    info["count"] = d.counts[key]
                    info["count_owner"] = d.name
                if key in d.reusable:
                    info["reusable"] = True
                if key in d.blocks:
                    info["block"] = d.blocks[key]
                if key in d.allocalign:
                    info["align"] = d.allocalign[key]
                if key in d.strings:
                    info["string"] = True
                if key in d.scriptstrings:
                    info["scriptstring"] = True
                if key in d.cond_never:
                    info["cond_never"] = True
                if key in d.cond_expr:
                    info["cond"] = d.cond_expr[key]
                    info["cond_owner"] = d.name
                if key in d.arraysize:
                    info["arraysize"] = d.arraysize[key]
                    info["arraysize_owner"] = d.name

        # candidate keys: for each scope, suffixes of (scope prefix :: name)
        candidates = []
        for d, prefix in reversed(scopes):
            p = f"{prefix}::{name}" if prefix else name
            parts = p.split("::")
            candidates += ["::".join(parts[i:]) for i in range(len(parts))]
        candidates.append(name)
        candidates.append(f"{sd.name}::{name}")
        if dsl:
            apply_from(dsl, candidates)
        for d, prefix in scopes:
            apply_from(d, candidates)
        # directives written as `Type::member` in another struct's file (for example
        # XModel.txt's `set count XModelCollSurf_s::collTris numCollTris;`) still apply
        # when that Type is loaded from somewhere else; without this collTris fell back
        # to a single element and every weapon model lost its collision triangles.
        qualified = f"{sd.name}::{name}"
        for d in self.dsls.values():
            if d is not dsl and all(d is not sc for sc, _ in scopes):
                apply_from(d, [qualified])
        return info

    def _treated_member_names(self, sd, dsl):
        if dsl and dsl.reorder:
            listed = [n for n in dsl.reorder if n != "..."]
            rest = [m.name for m in sd.members if m.name not in listed]
            if "..." in dsl.reorder:
                out = []
                ri = 0
                for n in dsl.reorder:
                    if n == "...":
                        while ri < len(rest):
                            out.append(rest[ri])
                            ri += 1
                    else:
                        out.append(n)
                out += rest[ri:]
                return out
            return listed + rest
        return [m.name for m in sd.members]

    def _treat(self, sd, dsl, name, vals, ctx, scopes=None):
        scopes = scopes or []
        m = next((x for x in sd.members if x.name == name), None)
        if m is None:
            raise ZoneError(f"member {name} not in {sd.name}")
        info = self._member_info(dsl, sd, name, scopes)
        if info["cond_never"]:
            return
        if info["cond"] is not None and not self.eval_cond(info["cond"], self._owner_ctx(ctx, info["cond_owner"])):
            return
        if not m.ptr and info["arraysize"] is not None and sd.is_union and m.array == 1:
            self._treat_inline_indices(sd, dsl, m, info, vals, ctx, scopes)
            return
        if not m.ptr:
            # embedded struct: treat its own pointer members
            if m.type_name in self.structs and isinstance(vals.get(name), (dict, StructArray)):
                esd = self.structs[m.type_name]
                edsl = self.struct_dsl(m.type_name)
                if dsl is not None and dsl.has_use:
                    child_scopes = scopes + [(dsl, name)]
                else:
                    child_scopes = [(d, f"{p}::{name}" if p else name) for d, p in scopes]
                els = vals[name] if isinstance(vals[name], StructArray) else [vals[name]]
                for i, el in enumerate(els):
                    self.ctx_trace.append(f"{m.type_name}[{i}]")
                    try:
                        self.treat_members(esd, edsl, el, ctx + [(m.type_name, el)],
                                           scopes=child_scopes)
                    finally:
                        self.ctx_trace.pop()
            return
        pv = vals.get(name)
        if info["string"]:
            if isinstance(pv, (list, tuple)):
                out = []
                for pv2 in pv:
                    if not isinstance(pv2, int):
                        out.append(pv2)
                        continue
                    k2, t2 = self.classify(pv2)
                    if k2 == "following":
                        out.append(self.read_cstr())
                    elif k2 == "offset":
                        try:
                            out.append(self.resolve(*t2))
                        except (ZoneError, struct.error, ValueError, KeyError):
                            out.append(PendingRef(*t2) if self.deferred else None)
                    else:
                        out.append(None)
                vals[name] = out
                return
            if not isinstance(pv, int):
                return
            kind, tgt = self.classify(pv)
            if kind == "following" and m.ptr >= 2:
                # char** (szXAnims, bounceSound, ...): an array of `count` string
                # pointers follows, then the strings of every FOLLOWING entry. Reading a
                # single C string here ate the first slots as text and shifted the weapon.
                count = self._eval_count(info["count"], ctx, info) if info["count"] else 1
                top = self.block_stack[-1] if self.block_stack else BLOCK_TEMP
                block = info["block"] if info["block"] is not None else top
                raw = self.read(4 * count, block=block, align=4)
                out = []
                for (pv2,) in struct.iter_unpack("<I", raw):
                    k2, t2 = self.classify(pv2)
                    if k2 == "following":
                        out.append(self.read_cstr())
                    elif k2 == "offset":
                        try:
                            out.append(self.resolve(*t2))
                        except (ZoneError, struct.error, ValueError, KeyError):
                            out.append(PendingRef(*t2) if self.deferred else None)
                    else:
                        out.append(None)
                vals[name] = out
                return
            if kind == "null":
                vals[name] = None
            elif kind == "following":
                vals[name] = self.read_cstr()
            elif kind == "offset":
                vals[name] = self.resolve(*tgt)
            else:
                vals[name] = f"<{kind}>"
            return
        if isinstance(pv, (list, tuple)) and m.type_name not in self.structs and m.type_name not in ASSET_STRUCTS:
            vals[name] = self._treat_leaf_ptr_array(sd, dsl, m, name, pv, ctx, scopes, info)
            return
        if isinstance(pv, (list, tuple)):
            # embedded array of pointers (T* x[N]): values inline in struct
            count = self._eval_count(info["count"], ctx, info) if info["count"] else len(pv)
            top = self.block_stack[-1] if self.block_stack else BLOCK_TEMP
            block = info["block"] if info["block"] is not None else top
            align = info["align"] or 4
            out = []
            for pv2 in pv[:count]:
                if not isinstance(pv2, int):
                    out.append(pv2)
                    continue
                k2, t2 = self.classify(pv2)
                if k2 == "null":
                    out.append(None)
                elif k2 == "offset":
                    out.append(self.resolve(*t2))
                elif k2 in ("following", "insert"):
                    out.append(self._load_ptr_target(m.type_name, ctx, block, align, k2))
                else:
                    raise ZoneError(f"bad ptr {k2} in array {sd.name}.{name}")
            vals[name] = out
            return
        if not isinstance(pv, int):
            vals[name] = None
            return
        kind, tgt = self.classify(pv)
        if kind == "null":
            vals[name] = None
            return
        if kind == "offset":
            try:
                vals[name] = self.resolve(*tgt)
            except (ZoneError, struct.error, ValueError, KeyError):
                if not self.deferred:
                    raise
                vals[name] = PendingRef(*tgt)
            return
        if kind not in ("following", "insert"):
            raise ZoneError(f"bad ptr kind {kind} for {sd.name}.{name}")
        count = self._eval_count(info["count"], ctx, info) if info["count"] else 1
        top = self.block_stack[-1] if self.block_stack else BLOCK_TEMP
        block = info["block"] if info["block"] is not None else top
        align = info["align"] or 4
        if info["scriptstring"]:
            ref = self.alloc(block, 2, ScriptStringRef(count))
            ref.obj.data = self.read(2 * count, block=block, align=2)
            vals[name] = ref
            return
        if m.ptr >= 2:
            # pointer array (T**): count ptr values follow, each resolved separately.
            # Cursor alignment may drift from the writer's; validate the decoded
            # pointers and retry with explicit pad variants when they look wrong.
            raw = self.read(4 * count, block=block, align=4)
            ptrs = struct.unpack_from(f"<{count}I", raw) if count else ()
            out = []
            for pv2 in ptrs:
                k2, t2 = self.classify(pv2)
                if k2 == "null":
                    out.append(None)
                elif k2 == "offset":
                    try:
                        out.append(self.resolve(*t2))
                    except (ZoneError, struct.error, ValueError, KeyError):
                        if self.deferred:
                            out.append(PendingRef(*t2))
                        else:
                            raise
                elif k2 in ("following", "insert"):
                    if self.poison:
                        out.append(None)
                        continue
                    try:
                        out.append(self._load_ptr_target(m.type_name, ctx, block, align, k2))
                    except (ZoneError, struct.error, ValueError, KeyError):
                        self.poison = True
                        self.poison_events.append((self.pos, f"{sd.name}.{name}[]->{m.type_name}"))
                        out.append(None)
                else:
                    out.append(None)
            arr_ref = self.alloc(block, 4, out)
            vals[name] = arr_ref
            return
        tname = m.type_name
        tsd = self.structs.get(tname)
        if tname in ASSET_STRUCTS:
            # asset reference: FOLLOWING loads the full asset inline
            if self.poison:
                vals[name] = None
                return
            try:
                vals[name] = self._load_ptr_target(tname, ctx, block, align, kind)
            except (ZoneError, struct.error, ValueError, KeyError):
                self.poison = True
                self.poison_events.append((self.pos, f"{sd.name}.{name}->{tname}"))
                vals[name] = None
                return
        elif kind == "insert":
            # temp-block targets loaded via INSERT: a 4-byte pointer slot is
            # allocated in the VIRTUAL block and later OFFSET refs alias it
            ref = self._load_ptr_target(tname, ctx, block, align, kind)
            slot = self.alloc(BLOCK_VIRTUAL, 4, ref)
            self.insert_slots.append((slot, ref))
            vals[name] = ref
        elif tsd is not None:
            align = info["align"] or tsd.align
            if count < 0 or count > 0x1000000:
                raise ZoneError(f"implausible array count {count} (trace={self.ctx_trace[-6:]})")
            arr = [None] * count
            ref = self.alloc(block, align, arr)
            inline_raw = self.read(tsd.size * count, block=block, align=align)
            self.decode_array(tsd, inline_raw, arr, ctx, tname)
            partial = self.PARTIAL_STRUCT_TAIL.get(tname)
            if partial and count == 1 and isinstance(arr[0], dict) and partial[0](arr[0]):
                self.pos -= partial[1]
                if not BLOCK_NAMES[block].endswith("RUNTIME"):
                    self.cursors[block] -= partial[1]
            tdsl = self.struct_dsl(tname)
            for i, el in enumerate(arr):
                self.ctx_trace.append(f"{tname}[{i}]")
                try:
                    pushed = False
                    if tdsl and tdsl.block is not None:
                        self.push_block(BLOCK_NAMES.index(tdsl.block))
                        pushed = True
                    try:
                        self.treat_members(tsd, tdsl, el, ctx + [(tname, el)], scopes=[])
                    finally:
                        if pushed:
                            self.pop_block()
                finally:
                    self.ctx_trace.pop()
            vals[name] = ref
        else:
            esz, eal = self.hdr.type_size_align(tname)
            esz *= m.elem_mult
            use_align = info["align"] or eal
            ref = self.alloc(block, use_align, RawArray(tname, count))
            ref.obj.data = self.read(esz * count, block=block, align=use_align)
            vals[name] = ref

    def _leaf_array_dims(self, dsl, scopes, name, total):
        pat = re.compile(re.escape(name) + r"((?:\[\d+\])+)$")
        dims = None
        for d in [dsl] + [s for s, _ in scopes]:
            if d is None:
                continue
            for key in d.counts:
                mm = pat.match(key)
                if not mm:
                    continue
                idx = [int(x) for x in re.findall(r"\[(\d+)\]", mm.group(1))]
                if dims is None:
                    dims = [0] * len(idx)
                if len(idx) != len(dims):
                    continue
                dims = [max(a, b + 1) for a, b in zip(dims, idx)]
        if dims is None:
            return [total]
        prod = 1
        for x in dims:
            prod *= x
        return dims if prod == total else [total]

    def _treat_leaf_ptr_array(self, sd, dsl, m, name, pv, ctx, scopes, info):
        dims = self._leaf_array_dims(dsl, scopes, name, len(pv))
        top = self.block_stack[-1] if self.block_stack else BLOCK_TEMP
        block = info["block"] if info["block"] is not None else top
        out = []
        for k, pv2 in enumerate(pv):
            if not isinstance(pv2, int):
                out.append(pv2)
                continue
            k2, t2 = self.classify(pv2)
            if k2 == "null":
                out.append(None)
                continue
            if k2 == "offset":
                try:
                    out.append(self.resolve(*t2))
                except (ZoneError, struct.error, ValueError, KeyError):
                    if not self.deferred:
                        raise
                    out.append(PendingRef(*t2))
                continue
            if k2 not in ("following", "insert"):
                out.append(None)
                continue
            rem = k
            idxs = []
            for dsz in reversed(dims):
                idxs.append(rem % dsz)
                rem //= dsz
            idxs.reverse()
            ikey = name + "".join(f"[{i}]" for i in idxs)
            iinfo = self._member_info(dsl, sd, ikey, scopes)
            expr = iinfo["count"] or info["count"]
            count = self._eval_count(expr, ctx, iinfo if iinfo["count"] else info) if expr else 1
            if count < 0 or count > 0x4000000:
                raise ZoneError(f"implausible array count {count} for {sd.name}.{ikey} (trace={self.ctx_trace[-6:]})")
            esz, eal = self.hdr.type_size_align(m.type_name)
            esz *= m.elem_mult
            use_align = info["align"] or eal
            ref = self.alloc(block, use_align, RawArray(m.type_name, count))
            ref.obj.data = self.read(esz * count, block=block, align=use_align)
            out.append(ref)
        return out

    def _struct_start_looks_right(self, tname, base):
        """Cheap plausibility check for a struct inline read at `base`."""
        sd = self.structs.get(tname)
        if sd is None:
            return True
        d = self.data
        if base + sd.size > len(d):
            return False
        # first string member FOLLOWING -> printable string right after struct
        dsl = self.struct_dsl(tname)
        n_checked = 0
        for m in sd.members:
            if not m.ptr:
                continue
            v, = struct.unpack_from("<I", d, base + m.offset)
            if v not in (0, PTR_FOLLOWING, PTR_INSERT) and (v - 1) >> 29 >= 7:
                return False
            n_checked += 1
            if n_checked > 6:
                break
        if dsl and sd.members and sd.members[0].ptr and sd.members[0].name in dsl.strings:
            v, = struct.unpack_from("<I", d, base)
            if v == PTR_FOLLOWING:
                s = d[base + sd.size: base + sd.size + 32]
                end = s.find(b"\x00")
                s = s[:end if end >= 0 else 32]
                if s:
                    pr = sum(1 for c in s if 32 <= c < 127)
                    if pr < len(s) * 0.7:
                        return False
        return True

    def _load_ptr_target(self, tname, ctx, block, align, kind, at_pos=None):
        """Load a single (count=1) struct target for FOLLOWING/INSERT ptr."""
        if at_pos is not None:
            self.pos = at_pos
        sd = self.structs.get(tname)
        dsl = self.struct_dsl(tname)
        pushed = False
        if tname in ASSET_STRUCTS:
            self.push_block(BLOCK_TEMP if (dsl and dsl.block == "XFILE_BLOCK_TEMP") else block)
            pushed = True
        elif dsl and dsl.block is not None:
            if BLOCK_NAMES.index(dsl.block) == BLOCK_TEMP:
                self.push_block(BLOCK_TEMP)
                pushed = True
        try:
            # alloc then Load_T(true)
            use_block = self.block_stack[-1] if self.block_stack else block
            ref = self.alloc(use_block, align, None)
            vals = self.load_struct(tname, ctx, alloc_in_block=use_block, treat=True)
            ref.obj = vals
            return ref
        finally:
            if pushed:
                self.pop_block()

    # ----- raw decoding -----
    SCALAR_FMT = {
        "char": "<b", "unsigned char": "<B", "uint8_t": "<B", "int8_t": "<b", "bool": "<B",
        "short": "<h", "unsigned short": "<H", "int16_t": "<h", "uint16_t": "<H",
        "int": "<i", "unsigned int": "<I", "unsigned": "<I", "int32_t": "<i", "uint32_t": "<I",
        "float": "<f", "int64_t": "<q", "uint64_t": "<Q", "double": "<d",
        "long": "<i", "unsigned long": "<I", "void": "<B",
    }

    def _scalar_size(self, base):
        if base in self.SCALAR_FMT:
            return struct.calcsize(self.SCALAR_FMT[base])
        return None

    def decode(self, sd, raw, ctx, tname):
        vals = {}
        for m in sd.members:
            if m.name == "__bits__":
                continue
            if sd.is_union and m.offset != 0:
                continue  # union members overlap; decode each separately on demand
            chunk = raw[m.offset:m.offset + m.size]
            vals[m.name] = self._decode_member(m, chunk)
        return vals

    def _decode_member(self, m, chunk):
        if m.ptr:
            if m.array and len(chunk) >= 8:
                # T* x[N]: every slot is its own pointer (techniques[130], ...);
                # reading only the first left the rest of the stream unconsumed
                return list(struct.unpack_from(f"<{len(chunk) // 4}I", chunk, 0))
            (v,) = struct.unpack_from("<I", chunk, 0) if len(chunk) >= 4 else (0,)
            return v
        if m.type_name in self.structs:
            sub = self.structs[m.type_name]
            if m.array and sub.size and len(chunk) >= 2 * sub.size:
                # every element of an inline struct array is its own struct;
                # decoding only the first left the others' string/pointer
                # members untreated and shifted the rest of the zone stream
                return StructArray(self.decode(sub, chunk[i * sub.size:(i + 1) * sub.size], None, m.type_name)
                                   for i in range(len(chunk) // sub.size))
            return self.decode(sub, chunk, None, m.type_name)
        fmt = self.SCALAR_FMT.get(self.hdr.resolve(m.type_name) if self.hdr.resolve(m.type_name) in self.SCALAR_FMT else m.type_name)
        if fmt is None and m.type_name in self.enums:
            fmt = "<i"
        if fmt is None:
            # typedef'd leaf (vec3_t etc.) or unknown -> bytes
            return chunk
        sz = struct.calcsize(fmt)
        n = len(chunk) // sz
        vals = struct.unpack_from(f"<{n}{fmt[1:]}", chunk, 0)
        if m.type_name in ("char", "unsigned char", "uint8_t", "int8_t") and not m.array:
            return chunk  # keep single chars as bytes for string-ish fields
        if n == 1 and not m.array:
            return vals[0]
        if m.type_name in ("char", "unsigned char", "uint8_t", "int8_t"):
            return chunk  # char arrays stay bytes
        return list(vals)

    def decode_array(self, sd, raws, arr, ctx, tname):
        for i in range(len(arr)):
            arr[i] = self.decode(sd, raws[i * sd.size:(i + 1) * sd.size], ctx, tname)

    # ----- top-level walk -----
    def walk(self, verbose=False):
        count, strings_ptr = struct.unpack_from("<iI", self.data, self.pos)
        self.pos += 8
        self.cursors[BLOCK_VIRTUAL] += 8
        asset_count, assets_ptr = struct.unpack_from("<iI", self.data, self.pos)
        self.pos += 8
        self.cursors[BLOCK_VIRTUAL] += 8

        self.push_block(BLOCK_VIRTUAL)
        if strings_ptr:
            ptrs = struct.unpack_from(f"<{count}I", self.data, self.pos)
            self.pos += 4 * count
            self.cursors[BLOCK_VIRTUAL] += 4 * count
            for p in ptrs:
                kind, tgt = self.classify(p)
                if kind == "following":
                    self.script_strings.append(self.read_cstr())
                elif kind == "offset":
                    self.script_strings.append(self.resolve(*tgt))
                else:
                    self.script_strings.append(None)

        entries = []
        if assets_ptr:
            raw = self.read_stream(8 * asset_count)
            self.cursors[BLOCK_VIRTUAL] += 8 * asset_count
            for i in range(asset_count):
                t, p = struct.unpack_from("<iI", raw, i * 8)
                entries.append((t, p))

        self.asset_total = len(entries)
        skipped = 0
        idx = 0
        while idx < len(entries):
            t, p = entries[idx]
            tname = ASSET_TYPES[t] if 0 <= t < len(ASSET_TYPES) else f"type{t}"
            self.poison = False
            start_pos = self.pos
            self.ctx_trace.append(f"asset#{idx}:{tname}")
            try:
                kind, tgt = self.classify(p)
                if kind == "offset":
                    obj = self.resolve(*tgt)
                    name = self._asset_name(obj)
                    self.assets.append((t, tname, name, obj))
                elif kind == "null":
                    self.assets.append((t, tname, None, None))
                else:
                    ref = self._load_ptr_target(tname, [], BLOCK_TEMP, 4, kind)
                    name = self._asset_name(ref.obj if isinstance(ref, Ref) else ref)
                    self.assets.append((t, tname, name, ref))
                self.asset_spans.append({"index": idx, "type": tname, "start": start_pos, "end": self.pos})
            except (ZoneError, struct.error, ValueError, KeyError) as ex:
                if not self.resync:
                    raise
                target = self._find_resync_target(entries, idx + 1)
                if target is None:
                    print(f"  asset#{idx} ({tname}) failed ({ex}); no resync target",
                          file=sys.stderr)
                    self.failed_spans.append({"index": idx, "type": tname, "error": str(ex), "start": start_pos, "end": len(self.data)})
                    raise
                print(f"  asset#{idx} ({tname}) failed ({ex}); resyncing",
                      file=sys.stderr, flush=True)
                t2idx = idx
                placed = False
                for _attempt in range(6):
                    target = self._find_resync_target(entries, t2idx + 1)
                    if target is None:
                        break
                    t2idx, anchor_pos, tname2 = target
                    pos_before = anchor_pos
                    try:
                        t, p = entries[t2idx]
                        kind, tgt = self.classify(p)
                        if kind not in ("following", "insert"):
                            continue
                        ref = self._load_ptr_target(tname2, [], BLOCK_TEMP, 4, kind, at_pos=anchor_pos)
                        if self.pos <= pos_before:
                            continue
                        name = self._asset_name(ref.obj if isinstance(ref, Ref) else ref)
                        placed = True
                        break
                    except (ZoneError, struct.error, ValueError, KeyError):
                        continue
                if not placed:
                    print(f"  resync gave up after asset#{idx}", file=sys.stderr, flush=True)
                    self.failed_spans.append({"index": idx, "type": tname, "error": str(ex), "start": start_pos, "end": len(self.data)})
                    raise
                skipped += t2idx - idx
                self.failed_spans.append({"index": idx, "type": tname, "error": str(ex), "start": start_pos, "end": pos_before, "resyncedTo": t2idx})
                print(f"  resync -> asset#{t2idx} ({tname2}) @ {pos_before:#x}",
                      file=sys.stderr, flush=True)
                while len(self.assets) < t2idx:
                    self.assets.append((-1, "SKIPPED", None, None))
                self.assets.append((t, tname2, name, ref))
                self.asset_spans.append({"index": t2idx, "type": tname2, "start": pos_before, "end": self.pos})
                idx = t2idx
            finally:
                self.ctx_trace.pop()
            if verbose and idx % 25 == 0:
                print(f"  asset {idx}/{len(entries)} stream={self.pos:#x} skipped={skipped}", file=sys.stderr, flush=True)
            if verbose and idx < 200:
                a = self.assets[-1]
                print(f"  [{idx}] {a[1]} {a[2]!r} stream={self.pos:#x}", file=sys.stderr)
            idx += 1
        self.skipped = skipped
        self.pop_block()
        self._settle_pending()
        return self

    def _find_resync_target(self, entries, start_idx):
        """Find the next asset whose struct can be located and validated in
        the stream after the current position. Returns (idx, pos, tname)."""
        d = self.data
        for j in range(start_idx, min(start_idx + 15, len(entries))):
            t2, p2 = entries[j]
            tname2 = ASSET_TYPES[t2] if 0 <= t2 < len(ASSET_TYPES) else None
            if not tname2:
                continue
            k2, _ = self.classify(p2)
            if k2 not in ("following", "insert"):
                continue
            sd = self.structs.get(tname2)
            if sd is None or not sd.members:
                continue
            dsl = self.struct_dsl(tname2)
            # probe stream positions ahead for a struct that decodes sanely:
            # all pointer members classify as valid zone pointers, and any
            # first-member FOLLOWING string is printable
            for probe in range(max(self.pos, 0), min(max(self.pos, 0) + 200000, len(d) - sd.size), 4):
                if probe + sd.size > len(d):
                    break
                ok = True
                n = 0
                for m in sd.members:
                    if not m.ptr:
                        continue
                    v, = struct.unpack_from("<I", d, probe + m.offset)
                    if v not in (0, PTR_FOLLOWING, PTR_INSERT) and (v - 1) >> 29 >= 7:
                        ok = False
                        break
                    n += 1
                    if n >= 8:
                        break
                if not ok:
                    continue
                # reject all-zero regions (common padding): require some
                # non-zero pointer or count field
                if not any(d[probe + m.offset:probe + m.offset + 4] != b"\x00\x00\x00\x00"
                           for m in sd.members if m.ptr):
                    continue
                if dsl and sd.members[0].ptr and sd.members[0].name in dsl.strings:
                    v, = struct.unpack_from("<I", d, probe)
                    if v == PTR_FOLLOWING:
                        s = d[probe + sd.size: probe + sd.size + 48]
                        end = s.find(b"\x00")
                        s = s[:end if end >= 0 else 48]
                        if not s:
                            continue
                        pr = sum(1 for c in s if 32 <= c < 127 or c == 0x2c)
                        if pr < len(s) * 0.7:
                            continue
                return j, probe, tname2
        return None

    def _settle_pending(self):
        """Resolve forward-reference PendingRefs in place now that all landings exist.

        In-place so object identity survives (weapon bundles link models and
        animations by identity), then re-derive names that were unresolvable
        while their string pointers were still forward references.
        """
        seen = set()
        stack = [o for (_t, _tn, _n, o) in self.assets if o is not None]
        stack += [n for (_t, _tn, n, _o) in self.assets if isinstance(n, PendingRef)]

        def landed(p):
            if not (0 <= p.block < 7):
                return p
            got = self.mem[p.block].get(p.offset)
            return p if got is None else got

        while stack:
            obj = stack.pop()
            if isinstance(obj, Ref):
                obj = obj.obj
            elif isinstance(obj, (RawArray, ScriptStringRef)):
                obj = obj.data
            if not isinstance(obj, (dict, list)) or id(obj) in seen:
                continue
            seen.add(id(obj))
            items = obj.items() if isinstance(obj, dict) else enumerate(obj)
            for key, value in list(items):
                if isinstance(value, PendingRef):
                    value = landed(value)
                    obj[key] = value
                if isinstance(value, (Ref, RawArray, ScriptStringRef, dict, list)):
                    stack.append(value)

        fixed = []
        for (t, tn, n, o) in self.assets:
            if isinstance(n, PendingRef):
                got = landed(n)
                n = got.obj if isinstance(got, Ref) else got
                if isinstance(n, (bytes, bytearray)):
                    n = bytes(n).split(b"\x00", 1)[0].decode("utf-8", "replace")
                elif not isinstance(n, str):
                    n = None
            if not n and o is not None:
                n = self._asset_name(o)
            fixed.append((t, tn, n, o))
        self.assets = fixed

    def _asset_name(self, obj):
        def as_str(v):
            if isinstance(v, Ref):
                v = v.obj
            if isinstance(v, PendingRef):
                got = self.mem[v.block].get(v.offset)
                v = got.obj if isinstance(got, Ref) else got
            if isinstance(v, (bytes, bytearray)):
                return v.decode("utf-8", "replace")
            if isinstance(v, str):
                return v
            return None
        try:
            v = obj.obj if isinstance(obj, Ref) else obj
            if isinstance(v, dict):
                for key in ("name", "szInternalName"):
                    s = as_str(v.get(key))
                    if s:
                        return s
                info = v.get("info")
                if isinstance(info, dict):
                    s = as_str(info.get("name"))
                    if s:
                        return s
        except Exception:
            pass
        return None


class ScriptStringRef:
    __slots__ = ("count", "data")

    def __init__(self, count):
        self.count = count
        self.data = None


class RawArray:
    __slots__ = ("type_name", "count", "data")

    def __init__(self, type_name, count):
        self.type_name = type_name
        self.count = count
        self.data = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zone")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    z = T5Zone(args.zone)
    z.walk(verbose=args.verbose)
    print(f"version={z.version:#x} decompressed={len(z.data):#x} consumed={z.pos:#x} "
          f"({'OK' if z.pos == len(z.data) else 'MISMATCH ' + str(len(z.data) - z.pos)})")
    print(f"script strings: {len(z.script_strings)}  assets: {len(z.assets)}")
    c = Counter(a[1] for a in z.assets)
    for k, v in c.most_common():
        print(f"  {k}: {v}")
    for i, n in enumerate(BLOCK_NAMES):
        print(f"  block {n}: size={z.block_sizes[i]:#x} cursor={z.cursors[i]:#x}")


if __name__ == "__main__":
    main()
