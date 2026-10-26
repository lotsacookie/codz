import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const python = process.env.ZONE_ASSETS_PYTHON || 'python3';
const tools = resolve('.tools');
const hasPython = spawnSync(python, ['--version']).status === 0;
const run = code => JSON.parse(execFileSync(python, ['-c', code, tools], { encoding: 'utf8' }));

const prelude = `
import sys, json, struct
sys.path.insert(0, sys.argv[1])
import t5_zone
from t5_zone import *
`;

test('multi-line DSL statements are joined and || conditions are kept', { skip: !hasPython }, () => {
  const out = run(prelude + `
import os
d = t5_zone.parse_dsl_folder(os.path.join(t5_zone.OAT, 'dsl'))
print(json.dumps({'blend': d['XSurfaceVertexInfo'].counts['vertsBlend'],
  'cond': d['MaterialShaderArgument'].cond_expr.get('u::literalConst', ''),
  'never': 'u::literalConst' in d['MaterialShaderArgument'].cond_never}))
`);
  assert.match(out.blend, /vertCount\[3\]/);
  assert.match(out.cond, /\|\|/);
  assert.equal(out.never, false);
});

test('pointer arrays decode every slot, not only the first', { skip: !hasPython }, () => {
  const out = run(prelude + `
import os
hp = t5_zone.HeaderParser(open(os.path.join(t5_zone.OAT, 'T5_Assets.h'), errors='ignore').read())
m = next(x for x in hp.structs['MaterialTechniqueSet'].members if x.name == 'techniques')
z = T5Zone.__new__(T5Zone)
vals = z._decode_member(m, struct.pack('<130I', *range(130)))
print(json.dumps({'n': len(vals), 'last': vals[-1]}))
`);
  assert.equal(out.n, 130);
  assert.equal(out.last, 129);
});

test('indexed first path segment resolves (vertCount[0])', { skip: !hasPython }, () => {
  const out = run(prelude + `
z = T5Zone.__new__(T5Zone)
z.enums = {}
v = z._lookup_path('vertCount[1]', [('XSurfaceVertexInfo', {'vertCount': [5, 7, 9, 11]})])
print(json.dumps({'v': v}))
`);
  assert.equal(out.v, 7);
});

test('Type::member directives from another struct file still apply', { skip: !hasPython }, () => {
  const out = run(prelude + `
import os
z = T5Zone.__new__(T5Zone)
z.dsls = t5_zone.parse_dsl_folder(os.path.join(t5_zone.OAT, 'dsl'))
hp = t5_zone.HeaderParser(open(os.path.join(t5_zone.OAT, 'T5_Assets.h'), errors='ignore').read())
sd = hp.structs['XModelCollSurf_s']
info = z._member_info(z.dsls.get('XModelCollSurf_s'), sd, 'collTris', [])
print(json.dumps({'count': info['count']}))
`);
  assert.equal(out.count, 'numCollTris');
});

test('char** string arrays read the pointer table, then the strings', { skip: !hasPython }, () => {
  const out = run(prelude + `
import os
d = t5_zone.parse_dsl_folder(os.path.join(t5_zone.OAT, 'dsl'))
wv = d['WeaponVariantDef']
print(json.dumps({'reorder': list(wv.reorder), 'xanims': wv.counts.get('szXAnims')}))
`);
  // the alt weapon name string is stored before the szXAnims table; hideTags still follows it
  assert.deepEqual(out.reorder, ['szInternalName', 'weapDef', 'szDisplayName', 'szAltWeaponName', 'szXAnims', '...']);
  assert.equal(out.xanims, 'NUM_WEAP_ANIMS');
});

test('WeaponDef keeps plain struct order (accuracy graphs, killIcon, indicatorIcon are not moved to the end)', { skip: !hasPython }, () => {
  const out = run(prelude + `
import os
d = t5_zone.parse_dsl_folder(os.path.join(t5_zone.OAT, 'dsl'))
print(json.dumps({'reorder': list(d['WeaponDef'].reorder)}))
`);
  // m1911_zm in common_zombie.ff stores the accuracy graph right after hudIcon, before locationDamageMultipliers
  assert.deepEqual(out.reorder, []);
});

test('decal effects read markArray only, not the shared union array', { skip: !hasPython }, () => {
  const out = run(prelude + `
import os
z = T5Zone.__new__(T5Zone)
z.enums = t5_zone.HeaderParser(open(os.path.join(t5_zone.OAT, 'T5_Assets.h'), errors='ignore').read()).enums
d = t5_zone.parse_dsl_folder(os.path.join(t5_zone.OAT, 'dsl'))
cond = d['FxElemDefVisuals'].cond_expr['array']
decal = z.enums['FX_ELEM_TYPE_DECAL']
def ev(elem_type, count):
    ctx = [('FxElemDef', {'elemType': elem_type, 'visualCount': count})]
    return z.eval_cond(cond, ctx)
print(json.dumps({'decal': ev(decal, 3), 'sprite': ev(0, 3), 'single': ev(0, 1)}))
`);
  assert.equal(out.decal, false);
  assert.equal(out.sprite, true);
  assert.equal(out.single, false);
});

test('inline struct arrays decode every element, so PhysConstraints.data[16] keeps all 16 entries', { skip: !hasPython }, () => {
  const out = run(prelude + `
import os
z = T5Zone.__new__(T5Zone)
hp = HeaderParser(open(os.path.join(t5_zone.OAT, 'T5_Assets.h'), errors='ignore').read())
z.structs = hp.structs; z.enums = hp.enums; z.hdr = hp
sd = hp.structs['PhysConstraints']
m = next(x for x in sd.members if x.name == 'data')
el = hp.structs['PhysConstraint'].size
raw = bytearray(el * 16)
struct.pack_into('<I', raw, el * 2 + 0x14, 0xFFFFFFFF)  # entry 2 target_bone1 = FOLLOWING
vals = z._decode_member(m, bytes(raw))
print(json.dumps({'n': len(vals), 'e2': vals[2]['target_bone1'], 'e0': vals[0]['target_bone1'], 'first': vals['target_bone1']}))
`);
  assert.equal(out.n, 16);
  assert.equal(out.e2, 0xFFFFFFFF);
  assert.equal(out.e0, 0);
  assert.equal(out.first, 0);
});

test('resync finds a struct far past 15 skipped entries and 200KB of padding', { skip: !hasPython }, () => {
  const out = run(prelude + `
import os
z = T5Zone.__new__(T5Zone)
hp = t5_zone.HeaderParser(open(os.path.join(t5_zone.OAT, 'T5_Assets.h'), errors='ignore').read())
z.structs = hp.structs
z.enums = hp.enums
z.dsls = t5_zone.parse_dsl_folder(os.path.join(t5_zone.OAT, 'dsl'))
pick = None
for ti, tn in enumerate(ASSET_TYPES):
    sd = z.structs.get(tn) if tn else None
    dsl = z.struct_dsl(tn) if sd else None
    if sd and sd.members and sd.members[0].ptr and dsl and sd.members[0].name in dsl.strings:
        pick = (ti, tn, sd)
        break
ti, tn, sd = pick
data = bytearray(700000)
at = 450000
data[at:at + 4] = struct.pack('<I', PTR_FOLLOWING)
data[at + sd.size:at + sd.size + 13] = b'resync_target\\x00'
z.data = bytes(data)
z.pos = 0
entries = [(-1, 0)] * 20 + [(ti, PTR_FOLLOWING)]
found = z._find_resync_target(entries, 0)
again = z._find_resync_target(entries, 0, at + sd.size + 64)
print(json.dumps({'found': list(found), 'tn': tn, 'again': again}))
`);
  assert.equal(out.found[0], 20);
  assert.equal(out.found[1], 450000);
  assert.equal(out.found[2], out.tn);
  assert.equal(out.again, null);
});

test('walker jumps over drifted data to the next plausible GameWorldSp and leaves a correct start alone', { skip: !hasPython }, () => {
  const out = run(prelude + `
import os, array, random
z = T5Zone.__new__(T5Zone)
hp = t5_zone.HeaderParser(open(os.path.join(t5_zone.OAT, 'T5_Assets.h'), errors='ignore').read())
z.structs = hp.structs
z.enums = hp.enums
z.block_sizes = (0x20048c, 0x33df30, 0, 0, 0x5ae4b94, 0, 0x6e72d8)
z.failed_spans = []
z.soft_errors = []
real = bytes.fromhex('7d2fd681' + '20060000' + 'ffffffff' * 2 + '00000000' + 'ffffffff' * 2 + 'bcaf0400' + 'ffffffff' + 'b1020000' + 'ffffffff')
random.seed(3)
data = bytearray()
v = 1000
while len(data) < 600000:
    v = max(0, min(65000, v + random.randint(-3, 4)))
    data += struct.pack('<H', v)
data[300003:300003 + len(real)] = real
z.data = bytes(data)
z.pos = 0
z._guard_asset_start(539, 'GameWorldSp')
jumped = z.pos
spans = len(z.failed_spans)
z._guard_asset_start(539, 'GameWorldSp')
print(json.dumps({'jumped': jumped, 'spans': spans, 'stable': z.pos == jumped, 'spansAfter': len(z.failed_spans)}))
`);
  assert.equal(out.jumped, 300003);
  assert.equal(out.spans, 1);
  assert.equal(out.stable, true);
  assert.equal(out.spansAfter, 1);
});

test('unresolved VIRTUAL name pointers are matched to zone-start strings with a calibrated offset', { skip: !hasPython }, () => {
  const out = run(prelude + `
z = T5Zone.__new__(T5Zone)
z.mem = [dict() for _ in range(7)]
z.string_pos = {}
z.string_delta = None
names = [b'c_ger_richtofen_body', b'c_ger_richtofen_head', b'c_rus_nikolai_body', b'c_usa_dempsey_body', b'p_prop_one', b'p_prop_two']
pos = 1000
starts = []
for n in names:
    z.string_pos[pos] = n
    starts.append(pos)
    pos += len(n) + 1 + 4
delta = 68
assets = []
for i, at in enumerate(starts[:4]):
    assets.append((5, 'XModel', None, {'name': PendingRef(BLOCK_VIRTUAL, at - delta), 'numBones': 10 + i}))
assets.append((5, 'XModel', None, {'name': PendingRef(BLOCK_VIRTUAL, 77777777), 'numBones': 1}))
for g in range(5000, 5000 + 1500):
    assets.append((5, 'XModel', None, {'name': PendingRef(BLOCK_VIRTUAL, g * 7919), 'numBones': 1}))
z.assets = assets
z._settle_pending()
print(json.dumps({'names': [a[2] for a in z.assets], 'delta': z.string_delta}))
`);
  assert.equal(out.delta, 68);
  assert.deepEqual(out.names.slice(0, 4), ['c_ger_richtofen_body', 'c_ger_richtofen_head', 'c_rus_nikolai_body', 'c_usa_dempsey_body']);
  assert.equal(out.names[4], null);
});
