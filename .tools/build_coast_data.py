"""Recover Call of the Dead map metadata and the original six sky faces."""
import hashlib
import io
import json
import math
import re
import struct
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'export/web/assets/coast'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = ROOT / 'export_coast/world/maps/zombie_coast.d3dbsp'


def position(value):
    x, y, z = map(float, value.split())
    return [x, z, -y]


world = json.loads(Path(str(SOURCE) + '.gfxworld.json').read_text())
entities = [dict(re.findall(r'"([^"\n]+)"\s*"([^"\n]*)"', block))
            for block in re.findall(r'\{([^{}]*)\}', Path(str(SOURCE) + '.ents').read_text())]
for i, entity in enumerate(entities):
    entity['id'] = i
    if 'origin' in entity:
        entity['position'] = position(entity['origin'])
    entity['yaw'] = math.radians(float(entity.get('angles', '0 0 0').split()[1]))
    if entity.get('model', '').startswith('*'):
        brush = world['brushModels'][int(entity['model'][1:])]
        lo, hi, origin = brush['mins'], brush['maxs'], entity.get('position', [0, 0, 0])
        entity['bounds'] = [[lo[0]+origin[0], lo[2]+origin[1], -hi[1]+origin[2]],
                            [hi[0]+origin[0], hi[2]+origin[1], -lo[1]+origin[2]]]

spawn = next(e for e in entities if e.get('targetname') == 'initial_spawn_points')
door_targets = {e['target'] for e in entities if e.get('targetname') == 'zombie_door'}
debris_targets = {e['target'] for e in entities if e.get('targetname') == 'zombie_debris'}
# Preserve door leaves in their source-defined open pose. Purchased debris is
# absent in this exploration state; there is no points or purchase system.
doors = [e['id'] for e in entities if e.get('targetname') in door_targets
         and e.get('classname') in ['script_model', 'script_brushmodel']]
removed = [e['id'] for e in entities if e.get('targetname') in debris_targets
           and e.get('classname') in ['script_model', 'script_brushmodel']]

landmarks = {'spawn': {'position': spawn['position'], 'yaw': spawn['yaw']}}
for key, zone in [('lighthouse', 'lighthouse1_zone'), ('lighthouseTop', 'catwalk_zone'),
                  ('shipBow', 'shipfront_far_zone'), ('shipBridge', 'shipback_level3_zone'),
                  ('lagoon', 'rear_lagoon_zone'), ('residence', 'residence1_zone')]:
    volume = next(e for e in entities if e.get('targetname') == zone)
    node = min((e for e in entities if e.get('classname') == 'node_pathnode'),
               key=lambda e: sum((a-b)**2 for a, b in zip(e['position'], volume['position'])))
    landmarks[key] = {'position': node['position'], 'yaw': node['yaw'], 'sourceEntity': node['id']}

# DDS cubemaps contain six complete face chains in +X,-X,+Y,-Y,+Z,-Z order.
# OAT's DXT1 sky has one mip. Decode each face separately rather than repeat
# the first-face preview on the map's sky polygons.
sky_path = ROOT / 'export_coast/zombie_coast/images/skybox_zombie_coast_ft.dds'
raw = sky_path.read_bytes()
height, width = struct.unpack_from('<2I', raw, 12)
mips = struct.unpack_from('<I', raw, 28)[0] or 1
assert raw[:4] == b'DDS ' and raw[84:88] == b'DXT1', 'Unexpected coast sky format'
assert struct.unpack_from('<I', raw, 112)[0] & 0xFE00 == 0xFE00, 'Incomplete sky cubemap'
face_bytes = sum(max(1, (max(1, width >> mip)+3)//4) *
                 max(1, (max(1, height >> mip)+3)//4) * 8 for mip in range(mips))
assert len(raw) == 128 + face_bytes * 6
header = bytearray(raw[:128])
struct.pack_into('<I', header, 112, 0)  # each decoded file is a 2D face
(OUT / 'sky').mkdir(exist_ok=True)
for face in range(6):
    payload = raw[128+face*face_bytes:128+(face+1)*face_bytes]
    Image.open(io.BytesIO(header + payload)).convert('RGB').save(OUT / f'sky/{face}.png')

water_source = json.loads((ROOT / 'export_coast/zombie_coast/materials/wc/zom_ocean_water_dynamic.json').read_text())
water_constants = {entry['name']: entry['literal'] for entry in water_source['constants']}
(OUT / 'textures').mkdir(exist_ok=True)
# Native DXT5 normal maps store X in alpha and Y in green. Recover Z before
# uploading as a browser tangent-space normal map.
waves = Image.open(ROOT / 'export_coast/zombie_coast/images/ocean_waves_bump.dds').convert('RGBA')
normal = Image.new('RGB', waves.size)
pixels = waves.tobytes()
normal.putdata([(a, g, round((math.sqrt(max(0, 1-(a/127.5-1)**2-(g/127.5-1)**2))+1)*127.5))
                for g, a in zip(pixels[1::4], pixels[3::4])])
normal.save(OUT / 'textures/ocean_waves_bump.png')
data = {'map': 'zombie_coast', 'title': 'Call of the Dead', 'stage': 'map-only',
        'spawn': spawn['id'], 'entities': entities, 'openDoors': doors, 'removedDebris': removed,
        'landmarks': landmarks, 'sky': [f'sky/{i}.png' for i in range(6)],
        'water': {'color': water_constants['waterColorN'][:3], 'scroll': water_constants['waterNormalScrollSpeed'][:2],
                  'uvScale': water_constants['waterNormalPositionScale'][2:]}}
(OUT / 'map-data.json').write_text(json.dumps(data, separators=(',', ':')))
sources = []
for relative in ['zone/Common/zombie_coast.ff', 'zone/Common/zombie_coast_patch.ff', 'zone/English/en_zombie_coast.ff']:
    path = ROOT / relative
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    sources.append({'path': relative, 'bytes': path.stat().st_size, 'sha256': digest})
(OUT / 'provenance.json').write_text(json.dumps({'map': data['map'], 'stage': data['stage'],
    'sources': sources, 'staticPlacements': len(world['staticModels']), 'entities': len(entities),
    'pipeline': 'Kino T5 GfxWorld exporter, compose_scene_t5.py, serialized BVH, PlayerController',
    'limits': ['Browser lighting; native lightmaps and layered shaders are not reconstructed.',
               'Render-mesh collision; native scripted transport and gameplay are not implemented.',
               'Purchase doors open and purchase debris removed for exploration.']}, indent=2))
print(f'Coast: {len(entities)} entities, {len(doors)} open door parts, {len(removed)} removed debris parts, six native sky faces')
