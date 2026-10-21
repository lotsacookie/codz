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
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from t5_zone import PendingRef, RawArray, Ref, ScriptStringRef, T5Zone

KIND_FOR_TYPE = {"XAnimParts": "animations", "XModel": "models"}
MAX_DEPTH = 64
SAMPLES_PER_KIND = 3
WARNING_LINES = 25
UNSAFE_CHARS = re.compile(r'[<>:"|?*\x00-\x1f]')


def safe_relative(name):
    parts = [part for part in re.split(r"[\\/]+", str(name)) if part and part != "."]
    if not parts or ".." in parts:
        return None
    return "/".join(UNSAFE_CHARS.sub("_", part) for part in parts)


def jsonable(value, depth=0, active=None):
    active = set() if active is None else active
    if depth > MAX_DEPTH:
        return "<depth>"
    if isinstance(value, Ref):
        return jsonable(value.obj, depth + 1, active)
    if isinstance(value, PendingRef):
        return {"pending": [value.block, value.offset]}
    if isinstance(value, RawArray):
        return {"type": value.type_name, "count": value.count, "data": jsonable(value.data, depth + 1, active)}
    if isinstance(value, ScriptStringRef):
        return {"count": value.count, "data": jsonable(value.data, depth + 1, active)}
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
                return {str(key): jsonable(item, depth + 1, active) for key, item in value.items()}
            return [jsonable(item, depth + 1, active) for item in value]
        finally:
            active.discard(marker)
    return repr(value)


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


def export_assets(assets, out, kinds, only=None, overwrite=False, zone_name="", resolve_name=None):
    rows = []
    names = {kind: set() for kind in kinds}
    references = {kind: set() for kind in kinds}
    unnamed = Counter()
    samples = {kind: [] for kind in kinds}
    for _type_index, type_name, name, obj in assets:
        kind = KIND_FOR_TYPE.get(type_name)
        if kind is None or kind not in kinds:
            continue
        if not name and resolve_name is not None:
            name = resolve_name(obj)
        if not name:
            field = name_field(obj)
            unnamed[(kind, field)] += 1
            rows.append({"archive": zone_name, "entry": None, "kind": kind, "status": "unnamed", "nameField": field})
            if len(samples[kind]) < SAMPLES_PER_KIND:
                samples[kind].append({"type": type_name, "nameField": field, "fields": shallow(obj)})
            continue
        if only is not None and not only.search(name):
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
        payload = json.dumps(
            {"type": type_name, "name": name, "zone": zone_name, "asset": jsonable(obj)},
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
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
    index = {kind: {"names": sorted(names[kind]), "references": sorted(references[kind])} for kind in kinds}
    summary = {
        "unnamed": [[kind, field, count] for (kind, field), count in unnamed.most_common(12)],
        "samples": samples,
    }
    return rows, index, summary


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
        "types": dict(types.most_common(40)),
        "resyncs": resyncs,
        "warnings": lines[:WARNING_LINES] + (["..."] + lines[-WARNING_LINES:] if len(lines) > 2 * WARNING_LINES else lines[WARNING_LINES:]),
        "rows": rows,
        "index": index,
        "summary": summary,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zone", required=True)
    parser.add_argument("--zone-name", default=None)
    parser.add_argument("--out", required=True)
    parser.add_argument("--kinds", default="animations,models")
    parser.add_argument("--only", default=None)
    parser.add_argument("--report", required=True)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    kinds = [kind for kind in (item.strip() for item in args.kinds.split(",")) if kind in KIND_FOR_TYPE.values()]
    only = re.compile(args.only, re.IGNORECASE) if args.only else None
    result = run(args.zone, args.zone_name or args.zone, args.out, kinds, only, args.overwrite)
    os.makedirs(os.path.dirname(os.path.abspath(args.report)), exist_ok=True)
    with open(args.report, "w", encoding="utf-8") as handle:
        json.dump(result, handle, separators=(",", ":"))
    print(f"{result['zone']}: {result['status']}, {result['assets']} assets walked, {result['resyncs']} resyncs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
