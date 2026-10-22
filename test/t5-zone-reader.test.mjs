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
  // szXAnims is stored before hideTags in this zone version: plain struct order
  assert.deepEqual(out.reorder, []);
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
