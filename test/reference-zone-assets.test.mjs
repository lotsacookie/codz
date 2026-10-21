import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { classifyEntry, extractZoneAssets, zoneAssetKinds } from '../.tools/reference-pack/extract.mjs';

const python = process.env.ZONE_ASSETS_PYTHON || 'python3';
const script = resolve('.tools/reference-pack/zone-assets.py');
const hasPython = spawnSync(python, ['--version']).status === 0;

const runPython = code => JSON.parse(execFileSync(python, ['-I', '-c', code, script], { encoding: 'utf8' }));

const loader = `
import importlib.util, json, sys, tempfile, os, re
spec = importlib.util.spec_from_file_location('zone_assets', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
`;

test('xanim and xmodel archive entries classify into their own kinds', () => {
  assert.equal(classifyEntry('xanim/viewmodel_m1911_fire'), 'animations');
  assert.equal(classifyEntry('weapons/viewmodel_m1911_fire.xanim'), 'animations');
  assert.equal(classifyEntry('xmodel/viewmodel_usa_dempsey_arms'), 'models');
  assert.equal(classifyEntry('xmodelsurfs/viewmodel_usa_dempsey_arms'), 'models');
  assert.equal(classifyEntry('models/zombie.glb'), 'models');
  assert.equal(classifyEntry('images/fx_smoke.iwi'), 'images');
  assert.equal(classifyEntry('maps/x.gsc'), 'raw');
});

test('zone asset kinds are picked out of the requested set', () => {
  assert.deepEqual(zoneAssetKinds(new Set(['images', 'models', 'animations'])), ['animations', 'models']);
  assert.deepEqual(zoneAssetKinds(new Set(['images', 'fx'])), []);
});

test('a failing or missing walker is reported, not thrown', async () => {
  const out = await mkdtemp(join(tmpdir(), 'zone-assets-out-'));
  const report = [];
  const result = await extractZoneAssets(join(out, 'none.ff'), 'zone/none.ff', {
    out,
    kinds: new Set(['animations', 'models']),
    only: null,
    report,
    overwrite: false,
    python: 'zone-assets-no-such-python'
  });
  assert.equal(result.status, 'failed');
  assert.equal(report.length, 1);
  assert.match(report[0].status, /^zone-assets failed/);
});

test('a file that is not a zone yields a walk-error row and no assets', { skip: !hasPython }, async () => {
  const out = await mkdtemp(join(tmpdir(), 'zone-assets-out-'));
  const bogus = join(out, 'bogus.ff');
  await writeFile(bogus, Buffer.from('not a fastfile at all'));
  const report = [];
  const result = await extractZoneAssets(bogus, 'zone/bogus.ff', { out, kinds: new Set(['animations']), only: null, report, overwrite: false, python });
  assert.equal(result.status, 'walk-error');
  assert.equal(result.assets, 0);
  assert.equal(report.at(-1).kind, 'zone');
  assert.equal(report.at(-1).status, 'walk-error');
});

test('walked XAnimParts and XModel assets are written as JSON and never overwritten', { skip: !hasPython }, async () => {
  const out = await mkdtemp(join(tmpdir(), 'zone-assets-out-'));
  const result = runPython(`${loader}
out = ${JSON.stringify(out)}
assets = [
    (1, 'XAnimParts', 'viewmodel_m1911_fire', {'name': 'viewmodel_m1911_fire', 'numframes': 12, 'data': module.RawArray('unsigned char', 3), 'ratio': float('inf')}),
    (2, 'XModel', 'viewmodel_usa_dempsey_arms', module.Ref(4, 8, {'name': 'viewmodel_usa_dempsey_arms', 'bones': [1, 2, 3]})),
    (3, 'Material', 'mtl_ignored', {'name': 'mtl_ignored'}),
    (4, 'XAnimParts', None, {'name': None}),
    (5, 'XAnimParts', '../escape', {'name': '../escape'}),
    (6, 'XModel', 'weapon_ak47', {'name': 'weapon_ak47'}),
]
assets[0][3]['data'].data = b'\\x01\\x02\\x03'
first, index = module.export_assets(assets, out, ['animations', 'models'], None, False, 'zone/test.ff')
again, _ = module.export_assets(assets, out, ['animations', 'models'], None, False, 'zone/test.ff')
filtered, filtered_index = module.export_assets(assets, out, ['models'], re.compile('ak47', re.I), True, 'zone/test.ff')
print(json.dumps({'first': first, 'again': again, 'index': index, 'filtered': filtered, 'filtered_index': filtered_index}))
`);

  const status = rows => Object.fromEntries(rows.map(row => [row.entry ?? '(unnamed)', row.status]));
  assert.deepEqual(status(result.first), {
    viewmodel_m1911_fire: 'ok',
    viewmodel_usa_dempsey_arms: 'ok',
    '(unnamed)': 'unnamed',
    '../escape': 'rejected-path',
    weapon_ak47: 'ok'
  });
  assert.equal(status(result.again).viewmodel_m1911_fire, 'exists');
  assert.equal(status(result.again).weapon_ak47, 'exists');
  assert.deepEqual(result.index.animations, ['../escape', 'viewmodel_m1911_fire']);
  assert.deepEqual(result.index.models, ['viewmodel_usa_dempsey_arms', 'weapon_ak47']);
  assert.deepEqual(result.filtered.map(row => row.entry), ['weapon_ak47']);
  assert.deepEqual(result.filtered_index.models, ['weapon_ak47']);

  const anim = JSON.parse(await readFile(join(out, 'animations/viewmodel_m1911_fire.json'), 'utf8'));
  assert.equal(anim.type, 'XAnimParts');
  assert.equal(anim.zone, 'zone/test.ff');
  assert.equal(anim.asset.numframes, 12);
  assert.equal(anim.asset.ratio, null);
  assert.deepEqual(anim.asset.data, { type: 'unsigned char', count: 3, data: { base64: 'AQID' } });

  const model = JSON.parse(await readFile(join(out, 'models/viewmodel_usa_dempsey_arms.json'), 'utf8'));
  assert.deepEqual(model.asset, { name: 'viewmodel_usa_dempsey_arms', bones: [1, 2, 3] });
  assert.equal(existsSync(join(out, 'escape.json')), false);
});
