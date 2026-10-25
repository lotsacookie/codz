#!/usr/bin/env python3
import argparse
import base64
import contextlib
import hashlib
import io
import json
import math
import os
import re
import sys
import zlib
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from t5_zone import BLOCK_NAMES, PendingRef, RawArray, Ref, ScriptStringRef, T5Zone

KIND_FOR_TYPE = {"XAnimParts": "animations", "XModel": "models", "WeaponVariantDef": "weapons"}
WEAPON_BUNDLE_KINDS = ("animations", "models")
WEAPON_DEF_TYPES = ("WeaponVariantDef", "WeaponDef")
VIEWMODEL_PATTERN = re.compile(
    r"viewmodel|viewhands|view_hands|viewarms|view_arms|(^|_)(weapon|wpn|hand|hands|arms)(_|$)|^v_|^t5_weapon",
    re.IGNORECASE,
)
CHARACTER_PATTERN = re.compile(
    r"^(c|char|body|head|hat|player|pb|viewbody)_|richtofen|dempsey|nikolai|takeo|rooftop|hazmat|astronaut",
    re.IGNORECASE,
)
FRAME_COUNTS = ("dataByteCount", "dataShortCount", "dataIntCount", "randomDataByteCount", "randomDataIntCount")
MAX_DEPTH = 64
SAMPLES_PER_KIND = 3
WARNING_LINES = 25
MAX_STRING = 160
UNSAFE_CHARS = re.compile(r'[<>:"|?*\x00-\x1f]')


def safe_relative(name):
    parts = [part for part in re.split(r"[\\/]+", str(name)) if part and part != "."]
    if not parts or ".." in parts:
        return None
    return "/".join(UNSAFE_CHARS.sub("_", part) for part in parts)


def jsonable(value, depth=0, active=None, stubs=None):
    active = set() if active is None else active
    if depth > MAX_DEPTH:
        return "<depth>"
    if stubs and depth > 0:
        inner = value.obj if isinstance(value, Ref) else value
        hit = stubs.get(id(inner)) if isinstance(inner, (dict, list)) else None
        if hit is not None:
            return {"assetRef": hit[1], "assetType": hit[0]}
    if isinstance(value, Ref):
        return jsonable(value.obj, depth + 1, active, stubs)
    if isinstance(value, PendingRef):
        return {"pending": [value.block, value.offset]}
    if isinstance(value, RawArray):
        return {"type": value.type_name, "count": value.count, "data": jsonable(value.data, depth + 1, active, stubs)}
    if isinstance(value, ScriptStringRef):
        return {"count": value.count, "data": jsonable(value.data, depth + 1, active, stubs)}
    if isinstance(value, (bytes, bytearray)):
        return {"base64": base64.b64encode(bytes(value)).decode("ascii")}
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (dict, list, tuple)):
        marker = id(value)
        if marker in active:
            return "<cycle>"
        active.add(marker)
        try:
            if isinstance(value, dict):
                return {str(key): jsonable(item, depth + 1, active, stubs) for key, item in value.items()}
            return [jsonable(item, depth + 1, active, stubs) for item in value]
        finally:
            active.discard(marker)
    return repr(value)


def keyframe_stats(obj):
    if not isinstance(obj, dict):
        return None
    counts = {key: obj.get(key) for key in FRAME_COUNTS}
    declared = sum(v for v in counts.values() if isinstance(v, int))
    filled = 0
    for key in ("dataByte", "dataShort", "dataInt", "randomDataByte", "randomDataShort", "randomDataInt"):
        item = obj.get(key)
        if isinstance(item, RawArray):
            item = item.data
        if isinstance(item, (bytes, bytearray, list, tuple)):
            filled += len(item)
    return {
        "numframes": obj.get("numframes"),
        "streamable": bool(obj.get("bStreamable")),
        "declared": declared,
        "filled": filled,
        "hollow": declared > 0 and filled == 0,
    }


def is_reference(name):
    return name.startswith(",")


def describe(value, limit=60):
    if isinstance(value, Ref):
        return "ref:" + describe(value.obj, limit)
    if isinstance(value, PendingRef):
        return f"pending({value.block},{value.offset})"
    if isinstance(value, RawArray):
        return f"rawarray({value.type_name},{value.count},{describe(value.data, limit)})"
    if isinstance(value, ScriptStringRef):
        return f"scriptstring({value.count})"
    if isinstance(value, (bytes, bytearray)):
        return "bytes:" + repr(bytes(value[:limit]))
    if isinstance(value, dict):
        return f"dict[{len(value)}]"
    if isinstance(value, (list, tuple)):
        return f"list[{len(value)}]"
    if value is None:
        return "None"
    return f"{type(value).__name__}:{repr(value)[:limit]}"


def name_field(obj):
    value = obj.obj if isinstance(obj, Ref) else obj
    if value is None:
        return "null-asset"
    if not isinstance(value, dict):
        return "non-dict:" + type(value).__name__
    if "name" not in value:
        return "no-name-key"
    return describe(value["name"])


def shallow(obj):
    value = obj.obj if isinstance(obj, Ref) else obj
    if not isinstance(value, dict):
        return describe(value)
    return {str(key): describe(item) for key, item in list(value.items())[:48]}


def build_stubs(assets, resolve_name=None):
    stubs = {}
    walked = {kind: set() for kind in WEAPON_BUNDLE_KINDS}
    for _type_index, type_name, name, obj in assets:
        if type_name in WEAPON_DEF_TYPES:
            continue
        inner = obj.obj if isinstance(obj, Ref) else obj
        if not isinstance(inner, (dict, list)):
            continue
        label = name or (resolve_name(obj) if resolve_name is not None else None)
        if not label:
            continue
        stubs[id(inner)] = (type_name, label)
        kind = KIND_FOR_TYPE.get(type_name)
        if kind in walked and not is_reference(label):
            walked[kind].add(label)
    return stubs, walked


def collect_links(value, stubs, depth=0, seen=None, found=None):
    found = {"strings": set(), "stubs": []} if found is None else found
    seen = set() if seen is None else seen
    if depth > MAX_DEPTH:
        return found
    if isinstance(value, Ref):
        value = value.obj
    if value is None or isinstance(value, (bool, int, float, PendingRef)):
        return found
    if depth > 0 and isinstance(value, (dict, list)) and id(value) in stubs:
        found["stubs"].append(stubs[id(value)])
        return found
    if isinstance(value, (RawArray, ScriptStringRef)):
        return collect_links(value.data, stubs, depth + 1, seen, found)
    if isinstance(value, (bytes, bytearray)):
        text = bytes(value).split(b"\x00", 1)[0].decode("utf-8", "replace")
        if 0 < len(text) <= MAX_STRING and text.isprintable():
            found["strings"].add(text)
        return found
    if isinstance(value, str):
        if 0 < len(value) <= MAX_STRING:
            found["strings"].add(value)
        return found
    if isinstance(value, (dict, list, tuple)):
        marker = id(value)
        if marker in seen:
            return found
        seen.add(marker)
        for item in (value.values() if isinstance(value, dict) else value):
            collect_links(item, stubs, depth + 1, seen, found)
    return found


def weapon_link(obj, stubs, walked):
    inner = obj.obj if isinstance(obj, Ref) else obj
    found = collect_links(obj, stubs)
    anim_names = set()
    if isinstance(inner, dict) and "szXAnims" in inner:
        anim_names = collect_links(inner["szXAnims"], stubs)["strings"]
    anim_stubs = {label for type_name, label in found["stubs"] if type_name == "XAnimParts"}
    model_stubs = {label for type_name, label in found["stubs"] if type_name == "XModel"}
    anim_present = {name for name in anim_names | found["strings"] if name in walked["animations"]} | {name for name in anim_stubs if not is_reference(name)}
    model_present = {name for name in found["strings"] if name in walked["models"]} | {name for name in model_stubs if not is_reference(name)}
    return {
        "animations": sorted(anim_present),
        "missingAnimations": sorted(name for name in anim_names if name not in anim_present),
        "externalAnimations": sorted(name.lstrip(",") for name in anim_stubs if is_reference(name)),
        "models": sorted(model_present),
        "externalModels": sorted(name.lstrip(",") for name in model_stubs if is_reference(name)),
    }


def export_assets(assets, out, kinds, only=None, overwrite=False, zone_name="", resolve_name=None):
    wanted = set(kinds)
    bundle = "weapons" in wanted
    tracked = list(kinds) + [kind for kind in WEAPON_BUNDLE_KINDS if bundle and kind not in wanted]
    rows = []
    names = {kind: set() for kind in tracked}
    references = {kind: set() for kind in tracked}
    unnamed = Counter()
    samples = {kind: [] for kind in tracked}
    stubs = {}
    links = {}
    linked = {kind: set() for kind in WEAPON_BUNDLE_KINDS}
    if bundle:
        stubs, walked = build_stubs(assets, resolve_name)
        for _type_index, type_name, name, obj in assets:
            if type_name != "WeaponVariantDef":
                continue
            if not name and resolve_name is not None:
                name = resolve_name(obj)
            if not name or is_reference(name) or (only is not None and not only.search(name)):
                continue
            link = weapon_link(obj, stubs, walked)
            links[name] = link
            linked["animations"].update(link["animations"])
            linked["models"].update(link["models"])
    for _type_index, type_name, name, obj in assets:
        kind = KIND_FOR_TYPE.get(type_name)
        if kind is None or kind not in tracked:
            continue
        implicit = kind not in wanted
        if not name and resolve_name is not None:
            name = resolve_name(obj)
        if implicit and not name:
            continue
        if not name:
            field = name_field(obj)
            unnamed[(kind, field)] += 1
            rows.append({"archive": zone_name, "entry": None, "kind": kind, "status": "unnamed", "nameField": field})
            if len(samples[kind]) < SAMPLES_PER_KIND:
                samples[kind].append({"type": type_name, "nameField": field, "fields": shallow(obj)})
            continue
        if implicit and not is_reference(name) and name not in linked[kind]:
            wanted_name = VIEWMODEL_PATTERN.search(name) or CHARACTER_PATTERN.search(name)
            if not wanted_name or (only is not None and not only.search(name)):
                continue
        elif not implicit and only is not None and not only.search(name):
            continue
        if is_reference(name):
            references[kind].add(name.lstrip(","))
            rows.append({"archive": zone_name, "entry": name, "kind": kind, "status": "reference"})
            continue
        relative = safe_relative(f"{kind}/{name}.json")
        if relative is None:
            rows.append({"archive": zone_name, "entry": name, "kind": kind, "status": "rejected-path"})
            continue
        names[kind].add(name)
        target = os.path.join(out, *relative.split("/"))
        if not overwrite and os.path.exists(target):
            rows.append({"archive": zone_name, "entry": name, "kind": kind, "file": relative, "status": "exists"})
            continue
        record = {"type": type_name, "name": name, "zone": zone_name}
        if kind == "weapons":
            record["links"] = links.get(name)
            record["asset"] = jsonable(obj, stubs=stubs)
        else:
            record["asset"] = jsonable(obj)
            if kind == "animations":
                record["keyframes"] = keyframe_stats(obj)
        payload = json.dumps(record, separators=(",", ":"), allow_nan=False).encode("utf-8")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as handle:
            handle.write(payload)
        rows.append(
            {
                "archive": zone_name,
                "entry": name,
                "kind": kind,
                "sha256": hashlib.sha256(payload).hexdigest(),
                "file": relative,
                "status": "ok",
            }
        )
        stats = record.get("keyframes")
        if stats and (stats["hollow"] or stats["streamable"]):
            rows[-1]["keyframes"] = "streamed" if stats["streamable"] else "hollow"
    index = {kind: {"names": sorted(names[kind]), "references": sorted(references[kind])} for kind in tracked}
    if bundle:
        index["weapons"]["links"] = links
    summary = {
        "unnamed": [[kind, field, count] for (kind, field), count in unnamed.most_common(12)],
        "samples": samples,
    }
    return rows, index, summary


FAILURE_LINE = re.compile(r"asset#\d+ \((\w+)\) failed \((.*)\); (?:resyncing|no resync target)")
NUMBERS = re.compile(r"0x[0-9a-fA-F]+|-?\d+")


def summarize_failures(lines, limit=8):
    failures = Counter()
    for line in lines:
        match = FAILURE_LINE.search(line)
        if match:
            failures[(match.group(1), NUMBERS.sub("N", match.group(2))[:140])] += 1
    return [[kind, message, count] for (kind, message), count in failures.most_common(limit)]


def capture_walk(zone_path):
    buffer = io.StringIO()
    zone = None
    status = "ok"
    error = None
    with contextlib.redirect_stderr(buffer):
        try:
            zone = T5Zone(zone_path)
            zone.walk()
        except Exception as exc:
            status = "walk-error"
            error = f"{type(exc).__name__}: {exc}"
    lines = [line for line in buffer.getvalue().splitlines() if line.strip()]
    return zone, status, error, lines


def _hex_rows(data, start, before=16, length=64):
    low = max(0, start - before)
    chunk = data[low:start + length]
    rows = []
    for i in range(0, len(chunk), 16):
        part = chunk[i:i + 16]
        text = "".join(chr(c) if 32 <= c < 127 else "." for c in part)
        rows.append(f"    {low + i:#010x}  {part.hex(' '):<47}  {text}")
    return rows


def _plausible_anim(obj):
    """XAnimParts header values a real animation can have; garbage headers (walker out of step) usually break one of these."""
    try:
        framerate = float(obj["framerate"])
        return 0 < framerate < 1000 and obj["numframes"] < 5000 and obj["dataByteCount"] < 60000 and obj["dataShortCount"] < 60000 and obj["dataIntCount"] < 60000 and obj["randomDataShortCount"] < 1000000 and obj["indexCount"] < 1000000
    except (KeyError, TypeError, ValueError):
        return False


def build_asset_trace(zone):
    """One raw line per walked asset (type, stream range, name; XAnimParts header values) plus the first implausible animation."""
    spans = getattr(zone, "asset_spans", [])
    rows, first_bad = [], None
    for span in spans:
        asset = zone.assets[span["index"]] if span["index"] < len(zone.assets) else None
        name = asset[2] if asset and isinstance(asset[2], str) else "-"
        obj = asset[3] if asset else None
        obj = getattr(obj, "obj", obj)
        line = f"#{span['index']} {span['type']} {span['start']:#x}..{span['end']:#x} len={span['end'] - span['start']} name={name}"
        if span["type"] == "XAnimParts" and isinstance(obj, dict):
            ok = _plausible_anim(obj)
            line += f" nf={obj.get('numframes')} fps={obj.get('framerate')} db={obj.get('dataByteCount')} ds={obj.get('dataShortCount')} di={obj.get('dataIntCount')} rs={obj.get('randomDataShortCount')} ix={obj.get('indexCount')}" + ("" if ok else " IMPLAUSIBLE")
            if not ok and first_bad is None:
                first_bad = span
        rows.append(line)
    head = [f"# asset trace: {len(rows)} walked assets"]
    head.append(f"first implausible XAnimParts: #{first_bad['index']} at {first_bad['start']:#x}" if first_bad else "first implausible XAnimParts: none")
    return "\n".join(head + rows) + "\n"


def build_error_report(zone_name, zone, status, error, lines):
    """Raw text listing of every error the walk hit and where it began, so a failure can be traced to the asset before it."""
    out = [f"# error report: {zone_name}", f"status: {status}"]
    if error:
        out.append(f"walk error: {error}")
    if zone is None:
        out.append("zone could not be opened; nothing was walked")
        out += ["", "## raw walker output"] + list(lines)
        return "\n".join(out) + "\n"
    data = zone.data
    spans = {span["index"]: span for span in getattr(zone, "asset_spans", [])}
    names = {i: asset for i, asset in enumerate(zone.assets)}
    size, pos = len(data), zone.pos
    total = len(zone.failed_spans) + len(zone.soft_errors) + len(zone.poison_events) + (1 if pos < size or status != "ok" else 0)
    out.append(f"stream: walked {pos:#x} of {size:#x} bytes ({round(100 * pos / size, 2) if size else 0}%), {max(0, size - pos)} unwalked")
    out.append(f"errors: {total} ({len(zone.failed_spans)} failed assets, {len(zone.soft_errors)} soft errors, {len(zone.poison_events)} poisoned pointers)")
    number = 0
    for span in zone.failed_spans:
        number += 1
        index = span["index"]
        out += ["", f"[{number}] FAILED ASSET #{index} {span['type']}", f"  error: {span['error']}",
                f"  stream: start={span['start']:#x} end={span['end']:#x} bytes={span['end'] - span['start']}" + (f" resyncedTo=#{span['resyncedTo']}" if "resyncedTo" in span else " no resync (walk stopped here)")]
        before = spans.get(index - 1)
        if before is None:
            before = next((spans[i] for i in range(index - 1, -1, -1) if i in spans), None)
        if before:
            asset = names.get(before["index"])
            label = asset[2] if asset and asset[2] else "unnamed"
            out.append(f"  previous walked asset: #{before['index']} {before['type']} {label} stream={before['start']:#x}..{before['end']:#x}")
            if before["end"] != span["start"]:
                out.append(f"  note: previous asset ended at {before['end']:#x} but this one started at {span['start']:#x}")
        out.append("  bytes around the start (16 before):")
        out += _hex_rows(data, span["start"])
    for error_item in zone.soft_errors:
        number += 1
        out += ["", f"[{number}] SOFT ERROR", f"  {error_item!r}"]
    for position, label in zone.poison_events:
        number += 1
        out += ["", f"[{number}] POISONED POINTER {label}", f"  stream={position:#x}"]
        out += _hex_rows(data, position)
    if pos < size or status != "ok":
        number += 1
        last = max(spans.values(), key=lambda span: span["end"], default=None)
        out += ["", f"[{number}] WALK STOPPED at {pos:#x}", f"  {max(0, size - pos)} bytes after this were not turned into assets"]
        entries = getattr(zone, "asset_total", None)
        if entries is not None and last and last["index"] + 1 >= entries:
            out.append(f"  the zone's asset list ended here ({entries} entries, all walked); the bytes after it are not covered by the list")
        if last:
            out.append(f"  last walked asset: #{last['index']} {last['type']} stream={last['start']:#x}..{last['end']:#x}")
        out.append("  bytes at the stop (16 before):")
        out += _hex_rows(data, pos)
    out += ["", "## raw walker output"] + list(lines)
    return "\n".join(out) + "\n"


def run(zone_path, zone_name, out, kinds, only, overwrite):
    zone, status, error, lines = capture_walk(zone_path)
    assets = zone.assets if zone is not None else []
    rows, index, summary = export_assets(assets, out, kinds, only, overwrite, zone_name, zone._asset_name if zone is not None else None)
    if status != "ok":
        rows.append({"archive": zone_name, "kind": "zone", "status": status, "error": error})
    resyncs = sum(1 for line in lines if "resync" in line)
    types = Counter(type_name for _index, type_name, _name, _obj in assets)
    return {
        "zone": zone_name,
        "status": status,
        "error": error,
        "assets": len(assets),
        "coverage": {
            "streamPos": zone.pos if zone is not None else 0,
            "streamSize": len(zone.data) if zone is not None else 0,
        },
        "types": dict(types.most_common(40)),
        "resyncs": resyncs,
        "failures": summarize_failures(lines),
        "named": dict(Counter(row["kind"] for row in rows if row.get("entry") and row["status"] in ("ok", "exists"))),
        "warnings": lines[:WARNING_LINES] + (["..."] + lines[-WARNING_LINES:] if len(lines) > 2 * WARNING_LINES else lines[WARNING_LINES:]),
        "rows": rows,
        "index": index,
        "summary": summary,
    }


CHUNK_BYTES = 40 * 1024 * 1024
EXPORT_HANDLED_TYPES = set(KIND_FOR_TYPE)


def rawfile_bytes(obj):
    """Decoded contents of a RawFile asset (zlib payloads are inflated, plain ones kept)."""
    inner = obj.obj if isinstance(obj, Ref) else obj
    if not isinstance(inner, dict):
        return None
    buffer = inner.get("buffer")
    buffer = buffer.obj if isinstance(buffer, Ref) else buffer
    data = buffer.data if isinstance(buffer, RawArray) else buffer
    data = data.obj if isinstance(data, Ref) else data
    if not isinstance(data, (bytes, bytearray)):
        return None
    data = bytes(data)
    for skip in (8, 0):
        if len(data) > skip + 2 and data[skip] == 0x78:
            try:
                return zlib.decompressobj().decompress(data[skip:])
            except zlib.error:
                continue
    return data.rstrip(b"\x00")


def unique_target(out, relative, used, index):
    candidate = relative
    if candidate in used:
        stem, ext = os.path.splitext(relative)
        candidate = f"{stem}~{index}{ext}"
    used.add(candidate)
    return candidate


def write_file(out, relative, payload, overwrite):
    target = os.path.join(out, *relative.split("/"))
    if not overwrite and os.path.exists(target):
        return "exists"
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "wb") as handle:
        handle.write(payload)
    return "ok"


MAX_ASSET_JSON = 40000000


def export_everything(assets, out, zone_name, only=None, overwrite=True, resolve_name=None):
    """Writes every walked asset that export_assets does not already cover (materials, techsets, fx, snd, rawfiles, menus, tables, ...)."""
    stubs, _walked = build_stubs(assets, resolve_name)
    rows, used, listing = [], set(), []
    for index, (_type_index, type_name, name, obj) in enumerate(assets):
        if type_name == "SKIPPED" or obj is None or type_name in EXPORT_HANDLED_TYPES:
            continue
        if not name and resolve_name is not None:
            name = resolve_name(obj)
        if only is not None and name and not only.search(name):
            continue
        if type_name == "RawFile" and name:
            payload = rawfile_bytes(obj)
            relative = safe_relative(f"rawfiles/{name}")
            if payload is not None and relative:
                relative = unique_target(out, relative, used, index)
                status = write_file(out, relative, payload, overwrite)
                rows.append({"archive": zone_name, "entry": name, "kind": "rawfiles", "file": relative, "sha256": hashlib.sha256(payload).hexdigest(), "status": status})
                listing.append({"index": index, "type": type_name, "name": name, "file": relative})
                continue
        relative = safe_relative(f"assets/{type_name}/{name}.json") if name else f"assets/{type_name}/_unnamed/{index}.json"
        if relative is None:
            relative = f"assets/{type_name}/_unnamed/{index}.json"
        relative = unique_target(out, relative, used, index)
        record = {"type": type_name, "name": name, "zone": zone_name, "index": index, "asset": jsonable(obj, stubs=stubs)}
        payload = json.dumps(record, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(payload) > MAX_ASSET_JSON:
            record = {"type": type_name, "name": name, "zone": zone_name, "index": index, "oversized": len(payload)}
            payload = json.dumps(record, separators=(",", ":"), allow_nan=False).encode("utf-8")
        status = write_file(out, relative, payload, overwrite)
        rows.append({"archive": zone_name, "entry": name, "kind": type_name, "file": relative, "sha256": hashlib.sha256(payload).hexdigest(), "status": status})
        listing.append({"index": index, "type": type_name, "name": name, "file": relative})
    return rows, listing


def dump_unwalked(zone, out, overwrite=True):
    """Raw bytes the walker could not turn into assets: failed asset spans and the stream tail after the walk stopped."""
    files = []
    data = zone.data
    for span in zone.failed_spans:
        start, end = span["start"], min(span["end"], len(data))
        if end <= start:
            continue
        relative = f"_failed/asset_{span['index']}_{span['type']}.bin"
        write_file(out, relative, data[start:end], overwrite)
        files.append({**span, "file": relative})
    tail_start = zone.pos
    tail = []
    if tail_start < len(data):
        part = 0
        for at in range(tail_start, len(data), CHUNK_BYTES):
            relative = f"_unwalked/tail_{tail_start:08x}_part{part}.bin"
            write_file(out, relative, data[at:at + CHUNK_BYTES], overwrite)
            tail.append(relative)
            part += 1
    return files, tail


def run_zone(zone_path, zone_name, out, only, overwrite):
    """One folder per zone: weapons/animations/models (+links), every other asset, rawfiles, failed spans, unwalked tail and _zone.json."""
    zone, status, error, lines = capture_walk(zone_path)
    assets = zone.assets if zone is not None else []
    resolve_name = zone._asset_name if zone is not None else None
    os.makedirs(out, exist_ok=True)
    rows, index, summary = export_assets(assets, out, ["animations", "models", "weapons"], only, overwrite, zone_name, resolve_name)
    extra_rows, listing = export_everything(assets, out, zone_name, only, overwrite, resolve_name)
    rows += extra_rows
    failed, tail = dump_unwalked(zone, out, overwrite) if zone is not None else ([], [])
    write_file(out, "_errors.txt", build_error_report(zone_name, zone, status, error, lines).encode("utf-8"), True)
    if zone is not None:
        write_file(out, "_asset_trace.txt", build_asset_trace(zone).encode("utf-8"), True)
    if status != "ok":
        rows.append({"archive": zone_name, "kind": "zone", "status": status, "error": error})
    types = Counter(type_name for _i, type_name, _n, _o in assets)
    size = len(zone.data) if zone is not None else 0
    pos = zone.pos if zone is not None else 0
    blocks = [{"name": BLOCK_NAMES[i], "size": zone.block_sizes[i], "cursor": zone.cursors[i]} for i in range(len(BLOCK_NAMES))] if zone is not None else []
    manifest = {
        "zone": zone_name,
        "status": status,
        "error": error,
        "blocks": blocks,
        "memberTrace": zone.member_trace if zone is not None else [],
        "complete": status == "ok" and not failed and pos >= size,
        "coverage": {"streamPos": pos, "streamSize": size, "percent": round(100 * pos / size, 2) if size else 0},
        "types": dict(types.most_common()),
        "resyncs": sum(1 for line in lines if "resync" in line),
        "failures": summarize_failures(lines, 40),
        "softErrors": zone.soft_errors[:200] if zone is not None else [],
        "failedSpans": failed,
        "unwalkedTail": tail,
        "errorReport": "_errors.txt",
        "assetTrace": "_asset_trace.txt",
        "assets": listing,
        "named": index,
    }
    write_file(out, "_zone.json", json.dumps(manifest, indent=1).encode("utf-8"), True)
    resyncs = manifest["resyncs"]
    return {
        "zone": zone_name,
        "status": status,
        "error": error,
        "assets": len(assets),
        "coverage": {"streamPos": pos, "streamSize": size},
        "blocks": blocks,
        "types": dict(types.most_common(40)),
        "resyncs": resyncs,
        "failures": summarize_failures(lines),
        "named": dict(Counter(row["kind"] for row in rows if row.get("entry") and row["status"] in ("ok", "exists"))),
        "warnings": lines[:WARNING_LINES],
        "rows": rows,
        "index": index,
        "summary": summary,
        "softErrors": len(zone.soft_errors) if zone is not None else 0,
        "failedSpans": len(failed),
        "unwalkedBytes": max(0, size - pos),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zone", required=True)
    parser.add_argument("--zone-name", default=None)
    parser.add_argument("--out", required=True)
    parser.add_argument("--kinds", default="animations,models,weapons")
    parser.add_argument("--only", default=None)
    parser.add_argument("--report", required=True)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--per-zone", action="store_true", help="dump everything this zone holds into --out (one folder per zone)")
    args = parser.parse_args()
    kinds = [kind for kind in (item.strip() for item in args.kinds.split(",")) if kind in KIND_FOR_TYPE.values()]
    only = re.compile(args.only, re.IGNORECASE) if args.only else None
    if args.per_zone:
        result = run_zone(args.zone, args.zone_name or args.zone, args.out, only, args.overwrite)
    else:
        result = run(args.zone, args.zone_name or args.zone, args.out, kinds, only, args.overwrite)
    os.makedirs(os.path.dirname(os.path.abspath(args.report)), exist_ok=True)
    with open(args.report, "w", encoding="utf-8") as handle:
        json.dump(result, handle, separators=(",", ":"))
    print(f"{result['zone']}: {result['status']}, {result['assets']} assets walked, {result['resyncs']} resyncs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
