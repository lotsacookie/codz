"""Recover Moon's entity, traversal and environment data from local OAT dumps."""
import hashlib
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'export/web/assets/moon'
OUT.mkdir(parents=True, exist_ok=True)
WORLD = ROOT / 'export_moon/world/maps/zombie_moon.d3dbsp.gfxworld.json'
ENTS = ROOT / 'export_moon/world/maps/zombie_moon.d3dbsp.ents'

def position(value):
    x, y, z = map(float, value.split())
    return [x, z, -y]

world = json.loads(WORLD.read_text())
entities = [dict(re.findall(r'"([^"\n]+)"\s*"([^"\n]*)"', b)) for b in re.findall(r'\{([^{}]*)\}', ENTS.read_text())]
for i, e in enumerate(entities):
    e['id'] = i
    if 'origin' in e:
        e['position'] = position(e['origin'])
    e['yaw'] = math.radians(float(e.get('angles', '0 0 0').split()[1]))
    if e.get('model', '').startswith('*'):
        b = world['brushModels'][int(e['model'][1:])]
        lo, hi, o = b['mins'], b['maxs'], e.get('position', [0, 0, 0])
        e['bounds'] = [[lo[0]+o[0], lo[2]+o[1], -hi[1]+o[2]], [hi[0]+o[0], hi[2]+o[1], -lo[1]+o[2]]]
    if 'script_vector' in e:
        e['move'] = position(e['script_vector'])

def find(name):
    return next(e for e in entities if e.get('targetname') == name)

# A purchase trigger points either directly to door parts, or to airlock
# touch triggers which in turn point to the two physical door leaves.
doors = []
for name in sorted({e['target'] for e in entities if e.get('targetname') in ['zombie_door', 'zombie_airlock_buy']}):
    triggers = [e for e in entities if e.get('target') == name and e.get('targetname') in ['zombie_door', 'zombie_airlock_buy']]
    targets, todo = {name}, [name]
    while todo:
        key = todo.pop()
        for e in entities:
            if e.get('targetname') == key and e.get('target') and e['target'] not in targets:
                targets.add(e['target'])
                todo.append(e['target'])
    parts = [e['id'] for e in entities if e.get('targetname') in targets and e.get('classname') in ['script_model', 'script_brushmodel']]
    if not parts:
        raise RuntimeError(f'Unresolved Moon door {name}')
    doors.append({'name': name, 'flag': triggers[0].get('script_flag'), 'cost': int(triggers[0]['zombie_cost']), 'triggers': [e['id'] for e in triggers], 'parts': parts})

landmarks = {
    'area51': {'label': "No Man’s Land", 'entity': next(e for e in entities if e.get('targetname') == 'initial_spawn_points' and e.get('script_int') == '1')['id']},
    'receiving': {'label': 'Receiving Bay', 'entity': find('nml_to_bridge_teleporter_player1_position')['id']},
    'power': {'label': 'Power / MPD', 'entity': find('nml_to_cata_teleporter_player1_position')['id']},
    'biodome': {'label': 'Biodome', 'entity': find('nml_to_forest_teleporter_player1_position')['id']},
}
script_path = ROOT / 'export_moon/zombie_moon_patch/maps/zombie_moon.gsc'
script = script_path.read_text()
data = {
    'map': 'zombie_moon', 'stage': 'solo-quest', 'entities': entities, 'doors': doors,
    'landmarks': landmarks,
    'returnSpawn': next(e['id'] for e in entities if e.get('script_noteworthy') == 'packp_respawn_point' and e.get('script_int') == '1'),
    'zoneLinks': re.findall(r'add_adjacent_zone\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"', script),
    'rules': {'lowGravity': 136, 'normalGravity': 800, 'suffocationSeconds': 15, 'teleportSeconds': 2.5},
    'source': {'entities': str(ENTS.relative_to(ROOT)), 'world': str(WORLD.relative_to(ROOT)), 'gravity': 'export_moon/zombie_moon_patch/maps/zombie_moon_gravity.gsc', 'teleporter': 'export_moon/zombie_moon_patch/maps/zombie_moon_teleporter.gsc'},
}
(OUT / 'map-data.json').write_text(json.dumps(data, separators=(',', ':')))
sources = []
for relative in ['zone/Common/zombie_moon.ff', 'zone/Common/zombie_moon_patch.ff', 'zone/English/en_zombie_moon.ff']:
    p = ROOT / relative
    sources.append({'path': relative, 'bytes': p.stat().st_size, 'sha256': hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()})
(OUT / 'provenance.json').write_text(json.dumps({'map': 'zombie_moon', 'sources': sources, 'entities': len(entities), 'staticPlacements': len(world['staticModels']), 'doorGroups': len(doors), 'stage': data['stage']}, indent=2))
print(f'Moon: {len(entities)} entities, {len(doors)} door groups, {len(landmarks)} destinations')
