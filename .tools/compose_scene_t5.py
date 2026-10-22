#!/usr/bin/env python3
"""Compose the Kino der Toten world shell + static model instances into glTF.

This is the T5 counterpart to compose_scene.py.  The structure follows the T6
composer, but the world vertex format differs between the games and is no
longer assumed: GfxWorldDumperT5 writes a ``vertexLayout`` block describing the
stride and the offset/format of every attribute, and this script reads it.

    T6: 36-byte vertex, float16 texcoords at +20
    T5: 44-byte vertex, float32 texcoords at +20

Coordinate convention matches the T6 pipeline: the game is z-up, glTF is y-up,
so ``(x, y, z) -> (x, z, -y)``.
"""
import argparse, json, math, os, struct, sys, re
from urllib.parse import quote
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--config', help='Optional map-specific paths and composition options (JSON).')
args = parser.parse_args()
config = json.load(open(args.config)) if args.config else {}
OUT = os.path.join(ROOT, config.get('output', 'export/web/assets'))
MAP = config.get('map', 'zombie_theater')
NAME = config.get('name', 'kino')
BASE = os.path.join(ROOT, config.get('world', f'export/maps/{MAP}.d3dbsp.gfxworld'))
ENTITY_PATH = os.path.join(ROOT, config.get('entities', 'export_fmtprobe/maps/zombie_theater.d3dbsp.ents'))
OBJ_DIRS = [os.path.join(ROOT, p) for p in config.get('objDirs', ['export/model_export', 'export_localized_obj/model_export'])]
ASSET_DIRS = [os.path.join(ROOT, p) for p in config.get('assetDirs', [f'export_game/{z}' for z in ['common', 'common_zombie', 'zombie_theater', 'en_common_zombie', 'en_zombie_theater', 'common_zombie_patch', 'zombie_theater_patch']])]
os.makedirs(f'{OUT}/textures', exist_ok=True)
def obj_path(name):
    for directory in OBJ_DIRS:
        path = f'{directory}/{name}_lod0.obj'
        if os.path.isfile(path): return path
    return None

# ---------- binary buffer helpers ----------
class Buf:
    def __init__(self):
        self.data = bytearray()
    def f32(self, arr):
        self.data += struct.pack(f"<{len(arr)}f", *arr)
        return len(arr) * 4
    def u32(self, arr):
        self.data += struct.pack(f"<{len(arr)}I", *arr)
        return len(arr) * 4

buf = Buf()
accessors, bufferViews = [], []
materials, textures, images = [], [], []
samplers = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
tex_cache, meshes = {}, []
material_defs = {}
for asset_dir in ASSET_DIRS:
    mat_root = f'{asset_dir}/materials'
    if not os.path.isdir(mat_root): continue
    for directory, _, files in os.walk(mat_root):
        for filename in files:
            if filename.endswith('.json'):
                path = os.path.join(directory, filename)
                key = os.path.relpath(path, mat_root).replace('\\', '/')[:-5]
                material_defs[key] = json.load(open(path))

def add_accessor_f32(flat, comps, minmax=True):
    off = len(buf.data)
    n = buf.f32(flat)
    c = {"VEC3": 3, "VEC2": 2}[comps]
    acc = {"bufferView": len(bufferViews), "componentType": 5126, "count": len(flat) // c, "type": comps}
    if minmax:
        acc["min"] = [min(flat[i::c]) for i in range(c)]
        acc["max"] = [max(flat[i::c]) for i in range(c)]
    bufferViews.append({"buffer": 0, "byteOffset": off, "byteLength": n})
    accessors.append(acc)
    return len(accessors) - 1

def add_accessor_u32(flat):
    off = len(buf.data)
    n = buf.u32(flat)
    bufferViews.append({"buffer": 0, "byteOffset": off, "byteLength": n})
    accessors.append({"bufferView": len(bufferViews) - 1, "componentType": 5125, "count": len(flat), "type": "SCALAR"})
    return len(accessors) - 1

def add_texture(png_name):
    if png_name in tex_cache:
        return tex_cache[png_name]
    images.append({"uri": "textures/" + quote(png_name)})
    textures.append({"sampler": 0, "source": len(images) - 1})
    tex_cache[png_name] = len(textures) - 1
    return tex_cache[png_name]

def add_material(mat_name, tex_png):
    source_name = mat_name.lstrip(',')
    if source_name.startswith('*'):
        base_match = re.search(r'\(([^:)]+)', source_name)
        if base_match: source_name = base_match.group(1)
    if not source_name.startswith(('wc/', 'mc/', '*')) and ':' in source_name:
        source_name = source_name.split(':', 1)[1]
    definition = material_defs.get(source_name, {})
    # The first color-semantic slot in multilayer T5 shaders is often a burn
    # mask. Select the actual base albedo instead of OAT's first-color fallback.
    slots = definition.get('textures', [])
    albedo = next((t['image'] for t in slots if t.get('name') == 'colorMap'), None)
    if not albedo:
        albedo = next((t['image'] for t in slots if t.get('name') == 'Diffuse_Map'), None)
    if not albedo:
        albedo = next((t['image'] for t in slots if t.get('semantic') == 'colorMap' and t.get('name') not in ['Roughness_Map', 'Specular_Map']), None)
    if albedo:
        if not os.path.exists(f'{OUT}/textures/{albedo}.png'):
            candidates = [f'{p}/images/{albedo}.dds' for p in ASSET_DIRS if os.path.isfile(f'{p}/images/{albedo}.dds')]
            if candidates:
                Image.open(candidates[-1]).convert('RGBA').save(f'{OUT}/textures/{albedo}.png')
        if os.path.exists(f'{OUT}/textures/{albedo}.png'): tex_png = albedo + '.png'
    if tex_png and not os.path.exists(f'{OUT}/textures/{tex_png}'):
        candidates = [f'{p}/images/{tex_png[:-4]}.dds' for p in ASSET_DIRS if os.path.isfile(f'{p}/images/{tex_png[:-4]}.dds')]
        if candidates: Image.open(candidates[-1]).convert('RGBA').save(f'{OUT}/textures/{tex_png}')
    # Compound GfxWorld names describe decal layers; the browser material uses
    # their common base. Share those identical materials before grouping faces.
    key = (source_name, tex_png)
    for i, m in enumerate(materials):
        if m.get("_key") == key:
            if mat_name not in m['extras']['sourceMaterialNames']: m['extras']['sourceMaterialNames'].append(mat_name)
            return i
    mat = {
        "_key": key, "name": mat_name[:60],
        "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.0, "roughnessFactor": 0.9},
        "doubleSided": True,
        "extras": {"sourceMaterialNames": [mat_name]},
    }
    if tex_png and os.path.exists(f"{OUT}/textures/{tex_png}"):
        mat["pbrMetallicRoughness"]["baseColorTexture"] = {"index": add_texture(tex_png)}
    materials.append(mat)
    if any(s.get('alphaTest', 'disabled') != 'disabled' for s in definition.get('stateBits', [])):
        mat['alphaMode'] = 'MASK'
        mat['alphaCutoff'] = 0.45
    if 'global_black' in mat_name:
        mat['pbrMetallicRoughness'] = {'baseColorFactor': [.006, .006, .006, 1], 'metallicFactor': 0, 'roughnessFactor': 1}
    return len(materials) - 1

def add_mesh(name, prims):
    """prims: list of (positions, uvs, normals, indices, mat_idx)"""
    P = []
    for pos, uv, nrm, idx, mi in prims:
        vertex_count = len(pos) // 3
        assert len(pos) % 3 == 0, f"{name}: malformed position data"
        assert len(uv) == vertex_count * 2, f"{name}: UV count does not match positions"
        assert len(nrm) == vertex_count * 3, f"{name}: normal count does not match positions"
        assert not idx or max(idx) < vertex_count, f"{name}: index exceeds vertex count"
        P.append({
            "attributes": {
                "POSITION": add_accessor_f32(pos, "VEC3"),
                "TEXCOORD_0": add_accessor_f32(uv, "VEC2"),
                "NORMAL": add_accessor_f32(nrm, "VEC3"),
            },
            "indices": add_accessor_u32(idx),
            "material": mi,
            "mode": 4,
        })
    meshes.append({"name": name[:60], "primitives": P})
    return len(meshes) - 1

# ---------- vertex layout ----------
# Formats the dumper is allowed to declare for a 2-component texcoord.
_UV_STRUCT = {"float32x2": "<2f", "float16x2": "<2e"}

def uv_reader(layout):
    """Return (offset, struct_fmt) for the texcoord attribute."""
    tc = layout["texCoord"]
    fmt = _UV_STRUCT.get(tc["format"])
    if fmt is None:
        raise SystemExit(f"unsupported texcoord format {tc['format']!r}; extend _UV_STRUCT")
    return tc["offset"], fmt

# ---------- world shell ----------
if not os.path.exists(f"{BASE}.json"):
    raise SystemExit(
        f"missing {BASE}.json\n"
        "Run the patched Unlinker first (see .tools/oat_patch/apply.sh)."
    )

print("loading world shell...")
d = json.load(open(f"{BASE}.json"))
raw0 = open(f"{BASE}.vd0", "rb").read()
idx = struct.unpack(f"<{d['indexCount']}H", open(f"{BASE}.idx", "rb").read())

layout = d["vertexLayout"]
stride = layout["stride"]
pos_off = layout["position"]["offset"]
uv_off, uv_fmt = uv_reader(layout)
print(f"vertex stride {stride}, uv {layout['texCoord']['format']} at +{uv_off}")

S, M = d["surfaces"], d["materials"]
vcache = {}
world_by_mat = {}
owners = {}
for bm_i, bm in enumerate(d['brushModels']):
    for si in range(bm['startSurfIndex'], bm['startSurfIndex'] + bm['surfaceCount']):
        owners[si] = bm_i

for si, s in enumerate(S):
    mname = M[s["m"]]["name"]
    if config.get('skipDistant', True) and 'distant' in mname.lower():
        continue
    owner = owners.get(si, 0)
    if any(term in mname.lower() for term in ['shadowcaster', 'hdrportal', 'caulk', 'portal_nodraw', 'clip_player']):
        if owner != 0: continue
        owner = -1
    tex = M[s["m"]]["colorMap"]
    mi = add_material(mname, (tex + ".png") if tex else None)
    faces = world_by_mat.setdefault((owner, mi), [])
    for t in range(0, s["tc"] * 3, 3):
        tri = idx[s["bi"] + t : s["bi"] + t + 3]
        pts = []
        for i in tri:
            off = s["o0"] + i * stride
            e = vcache.get(off)
            if e is None:
                x, y, z = struct.unpack_from("<3f", raw0, off + pos_off)
                u, v = struct.unpack_from(uv_fmt, raw0, off + uv_off)
                e = ((x, z, -y), (u, v))   # game z-up -> glTF y-up
                vcache[off] = e
            pts.append(e)
        faces.append(pts)

def build_prim(faces):
    """Flat-shaded primitive: normals are derived per triangle."""
    pos, uv, nrm, ind = [], [], [], []
    for pts in faces:
        # T5 GfxWorld stores clockwise front faces; glTF and Recast expect
        # counterclockwise faces. The axis rotation preserves handedness.
        pts = list(reversed(pts))
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = (p[0] for p in pts)
        ux, uy, uz = bx - ax, by - ay, bz - az
        vx, vy, vz = cx - ax, cy - ay, cz - az
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        l = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
        nx, ny, nz = nx / l, ny / l, nz / l
        base = len(pos) // 3
        for (p, t) in pts:
            pos += [p[0], p[1], p[2]]
            uv += [t[0], t[1]]
            nrm += [nx, ny, nz]
        ind += [base, base + 1, base + 2]
    return pos, uv, nrm, ind

brush_prims = {}
for (owner, mi), faces in world_by_mat.items():
    brush_prims.setdefault(owner, []).append((*build_prim(faces), mi))
brush_meshes = {owner: add_mesh('world_shell' if owner == 0 else f'brush_{owner}', prims) for owner, prims in brush_prims.items()}
world_mesh = brush_meshes[0]
print(f"world: {len(brush_prims)} brush models, {sum(len(f) for f in world_by_mat.values())} tris")

# ---------- static models ----------
print("loading models...")
model_meshes = {}

def parse_obj(path):
    V, VT, VN = [], [], []
    groups, cur = {}, None
    for line in open(path, errors="ignore"):
        if line.startswith("v "):
            V.append(tuple(float(x) for x in line.split()[1:4]))
        elif line.startswith("vt "):
            VT.append(tuple(float(x) for x in line.split()[1:3]))
        elif line.startswith("vn "):
            VN.append(tuple(float(x) for x in line.split()[1:4]))
        elif line.startswith("usemtl "):
            cur = line.split(None, 1)[1].strip()
            groups.setdefault(cur, [])
        elif line.startswith("f "):
            vs = []
            for tok in line.split()[1:]:
                seg = tok.split("/")
                vi = int(seg[0]); vi = vi - 1 if vi > 0 else len(V) + vi
                ti = int(seg[1]) - 1 if len(seg) > 1 and seg[1] else 0
                ni = int(seg[2]) - 1 if len(seg) > 2 and seg[2] else 0
                vs.append((vi, ti, ni))
            for k in range(1, len(vs) - 1):
                groups[cur].append((vs[0], vs[k], vs[k + 1]))
    return V, VT, VN, groups

def model_to_mesh(name):
    path = obj_path(name)
    V, VT, VN, groups = parse_obj(path)
    mtl_map, cur = {}, None
    mtl_path = f"{os.path.dirname(path)}/{name}.mtl"
    if os.path.exists(mtl_path):
        for line in open(mtl_path, errors="ignore"):
            if line.startswith("newmtl "):
                cur = line.split(None, 1)[1].strip()
            elif line.startswith("map_Kd ") and cur:
                base = os.path.basename(line.split(None, 1)[1].strip())
                if base.lower().endswith(".dds"):
                    mtl_map[cur] = base[:-4] + ".png"
    prims = []
    for mtl, faces in groups.items():
        if not faces:
            continue
        mi = add_material(f"{name}:{mtl}", mtl_map.get(mtl))
        pos, uv, nrm, ind = [], [], [], []
        for (a, b, c) in faces:
            base = len(pos) // 3
            for (vi, ti, ni) in (a, b, c):
                x, y, z = V[vi]
                pos += [x, y, z]
                if VT: u, v = VT[ti]; uv += [u, 1.0 - v]
                else: uv += [0, 0]
                if VN and ni < len(VN): nx, ny, nz = VN[ni]; nrm += [nx, ny, nz]
                else: nrm += [0, 1, 0]
            ind += [base, base + 1, base + 2]
        prims.append((pos, uv, nrm, ind, mi))
    return add_mesh(name, prims) if prims else None

def model_key(name):
    """OAT prefixes assets that are only *referenced* by this zone with a comma.
    Their geometry lives in another fastfile (perk bottles, the teddy bear and
    the lobby tear-in doors come from common_zombie.ff), but once dumped the
    files are named without the prefix."""
    return name[1:] if name.startswith(",") else name

nodes = [{"mesh": world_mesh, "name": "world_shell"}]
if -1 in brush_meshes:
    nodes.append({'mesh': brush_meshes[-1], 'name': 'collision_helpers', 'extras': {'collisionOnly': True}})
entity_path = ENTITY_PATH
entity_blocks = re.findall(r'\{([^{}]*)\}', open(entity_path).read())
for ei, block in enumerate(entity_blocks):
    ent = dict(re.findall(r'"([^"\n]+)"\s*"([^"\n]*)"', block))
    if ent.get('classname') != 'script_brushmodel' or not ent.get('model', '').startswith('*'):
        continue
    bi = int(ent['model'][1:])
    if bi not in brush_meshes:
        continue
    x,y,z = map(float, ent.get('origin', '0 0 0').split())
    nodes.append({'mesh': brush_meshes[bi], 'name': f'entity_{ei}', 'translation': [x,z,-y],
        'extras': {'entityId': ei, 'targetname': ent.get('targetname', ''), 'dynamicBrush': True}})
missing = set()
for inst in d["staticModels"]:
    name = model_key(inst["model"])
    if name not in model_meshes:
        if not obj_path(name):
            missing.add(name); model_meshes[name] = None
        else:
            model_meshes[name] = model_to_mesh(name)
    mi = model_meshes[name]
    if mi is None:
        continue
    scale = inst["scale"]
    # game z-up -> glTF y-up: R(x,y,z)=(x,z,-y); conjugate placement T = R*M*R^-1
    # => linear columns [R*A0, R*A2, -R*A1], translation R*O
    def rot(v): return [v[0], v[2], -v[1]]
    cols = [rot(inst["axis0"]), rot(inst["axis2"]), [-c for c in rot(inst["axis1"])], rot(inst["origin"])]
    mat = []
    for k in range(3):
        mat += [c * scale for c in cols[k]] + [0.0]
    mat += cols[3] + [1.0]
    nodes.append({"mesh": mi, "matrix": mat, "name": f"i_{name}"[:60]})

script_models = 0
if config.get('includeScriptModels', False):
    for ei, block in enumerate(entity_blocks):
        ent = dict(re.findall(r'"([^"\n]+)"\s*"([^"\n]*)"', block))
        if ent.get('classname') != 'script_model' or 'origin' not in ent: continue
        name = model_key(ent.get('model', ''))
        if name not in model_meshes:
            model_meshes[name] = model_to_mesh(name) if obj_path(name) else None
        mi = model_meshes[name]
        if mi is None:
            missing.add(name)
            continue
        x, y, z = map(float, ent['origin'].split())
        # Conjugate the game-space yaw/pitch/roll rotation into the y-up basis.
        pitch, yaw, roll = [math.radians(float(a)) for a in ent.get('angles', '0 0 0').split()]
        cy, sy, cp, sp, cr, sr = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch), math.cos(roll), math.sin(roll)
        axes = [[cy*cp, sy*cp, -sp], [cy*sp*sr-sy*cr, sy*sp*sr+cy*cr, cp*sr], [cy*sp*cr+sy*sr, sy*sp*cr-cy*sr, cp*cr]]
        cols = [rot(axes[0]), rot(axes[2]), [-c for c in rot(axes[1])]]
        scale = float(ent.get('modelscale', 1))
        matrix = [v for col in cols for v in ([c*scale for c in col]+[0])] + [x, z, -y, 1]
        nodes.append({'mesh': mi, 'name': f'entity_{ei}', 'matrix': matrix,
            'extras': {'entityId': ei, 'targetname': ent.get('targetname', ''), 'scriptModel': True}})
        script_models += 1
print(f"instances: {len(d['staticModels'])}, script models: {script_models}, unique models: {len(model_meshes)}, missing obj: {len(missing)}")
if missing:
    print("  missing (first 15):", ", ".join(sorted(missing)[:15]))

# ---------- write gltf ----------
gltf = {
    "asset": {"version": "2.0", "generator": "t5-compose", "extras": {"map": MAP}},
    "scene": 0,
    "scenes": [{"nodes": list(range(len(nodes)))}],
    "nodes": nodes,
    "meshes": meshes,
    "materials": [{k: v for k, v in m.items() if k != "_key"} for m in materials],
    "textures": textures,
    "images": images,
    "samplers": samplers,
    "accessors": accessors,
    "bufferViews": bufferViews,
    "buffers": [{"uri": NAME + ".bin", "byteLength": len(buf.data)}],
}
os.makedirs(OUT, exist_ok=True)
with open(f"{OUT}/{NAME}.gltf", "w") as f:
    json.dump(gltf, f, separators=(",", ":"))
with open(f"{OUT}/{NAME}.bin", "wb") as f:
    f.write(buf.data)
with open(f'{OUT}/composition.json', 'w') as f:
    json.dump({'map': MAP, 'staticInstances': len(d['staticModels']), 'scriptModels': script_models, 'missingModels': sorted(missing), 'materials': len(materials), 'textures': len(textures)}, f, indent=2)
print(f"written: {NAME}.gltf ({os.path.getsize(f'{OUT}/{NAME}.gltf')//1024} KB), {NAME}.bin ({len(buf.data)//1024//1024} MB)")
print(f"materials: {len(materials)}, textures used: {len(textures)}, meshes: {len(meshes)}")
