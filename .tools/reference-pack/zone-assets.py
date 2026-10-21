#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from t5_zone import PendingRef, RawArray, Ref, ScriptStringRef, T5Zone

KIND_FOR_TYPE = {"XAnimParts": "animations", "XModel": "models"}
MAX_DEPTH = 64
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


def export_assets(assets, out, kinds, only=None, overwrite=False, zone_name=""):
    rows = []
    index = {kind: [] for kind in kinds}
    for _type_index, type_name, name, obj in assets:
        kind = KIND_FOR_TYPE.get(type_name)
        if kind is None or kind not in kinds:
            continue
        if not name:
            rows.append({"archive": zone_name, "entry": None, "kind": kind, "status": "unnamed"})
            continue
        if only is not None and not only.search(name):
            continue
        index[kind].append(name)
        relative = safe_relative(f"{kind}/{name}.json")
        if relative is None:
            rows.append({"archive": zone_name, "entry": name, "kind": kind, "status": "rejected-path"})
            continue
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
    return rows, {kind: sorted(set(names)) for kind, names in index.items()}


def run(zone_path, zone_name, out, kinds, only, overwrite):
    status = "ok"
    error = None
    zone = None
    try:
        zone = T5Zone(zone_path)
        zone.walk()
    except Exception as exc:
        status = "walk-error"
        error = f"{type(exc).__name__}: {exc}"
    assets = zone.assets if zone is not None else []
    rows, index = export_assets(assets, out, kinds, only, overwrite, zone_name)
    if status != "ok":
        rows.append({"archive": zone_name, "kind": "zone", "status": status, "error": error})
    return {"zone": zone_name, "status": status, "error": error, "assets": len(assets), "rows": rows, "index": index}


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
    print(f"{result['zone']}: {result['status']}, {result['assets']} assets walked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
