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
