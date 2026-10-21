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
    (4, 'XAnimParts', None, {'name': module.PendingRef(4, 99)}),
    (5, 'XAnimParts', '../escape', {'name': '../escape'}),
    (6, 'XModel', 'weapon_ak47', {'name': 'weapon_ak47'}),
    (7, 'XModel', ',viewhands_usmc', {'name': ',viewhands_usmc', 'numBones': 0}),
    (8, 'XModel', None, None),
]
assets[0][3]['data'].data = b'\\x01\\x02\\x03'
first, index, summary = module.export_assets(assets, out, ['animations', 'models'], None, False, 'zone/test.ff')
again, _, _ = module.export_assets(assets, out, ['animations', 'models'], None, False, 'zone/test.ff')
filtered, filtered_index, _ = module.export_assets(assets, out, ['models'], re.compile('ak47', re.I), True, 'zone/test.ff')
print(json.dumps({'first': first, 'again': again, 'index': index, 'summary': summary, 'filtered': filtered, 'filtered_index': filtered_index}))
`);

  const byEntry = rows => Object.fromEntries(rows.map(row => [row.entry ?? `(unnamed ${row.kind})`, row.status]));
  assert.deepEqual(byEntry(result.first), {
    viewmodel_m1911_fire: 'ok',
    viewmodel_usa_dempsey_arms: 'ok',
    '(unnamed animations)': 'unnamed',
    '../escape': 'rejected-path',
    weapon_ak47: 'ok',
    ',viewhands_usmc': 'reference',
    '(unnamed models)': 'unnamed'
  });
  assert.equal(byEntry(result.again).viewmodel_m1911_fire, 'exists');
  assert.equal(byEntry(result.again).weapon_ak47, 'exists');
  assert.deepEqual(result.index.animations, { names: ['viewmodel_m1911_fire'], references: [] });
  assert.deepEqual(result.index.models, { names: ['viewmodel_usa_dempsey_arms', 'weapon_ak47'], references: ['viewhands_usmc'] });
  assert.deepEqual(result.summary.unnamed.sort(), [['animations', 'pending(4,99)', 1], ['models', 'null-asset', 1]]);
  assert.equal(result.summary.samples.animations[0].nameField, 'pending(4,99)');
  assert.deepEqual(result.filtered.map(row => row.entry), ['weapon_ak47', null]);
  assert.deepEqual(result.filtered_index.models, { names: ['weapon_ak47'], references: [] });

  const anim = JSON.parse(await readFile(join(out, 'animations/viewmodel_m1911_fire.json'), 'utf8'));
  assert.equal(anim.type, 'XAnimParts');
  assert.equal(anim.zone, 'zone/test.ff');
  assert.equal(anim.asset.numframes, 12);
  assert.equal(anim.asset.ratio, null);
  assert.deepEqual(anim.asset.data, { type: 'unsigned char', count: 3, data: { base64: 'AQID' } });

  const model = JSON.parse(await readFile(join(out, 'models/viewmodel_usa_dempsey_arms.json'), 'utf8'));
  assert.deepEqual(model.asset, { name: 'viewmodel_usa_dempsey_arms', bones: [1, 2, 3] });
  assert.equal(existsSync(join(out, 'escape.json')), false);
  assert.equal(existsSync(join(out, 'models/viewhands_usmc.json')), false);
  assert.equal(existsSync(join(out, 'models/,viewhands_usmc.json')), false);
});

test('an asset whose name only resolves after the walk is named at export time', { skip: !hasPython }, async () => {
  const out = await mkdtemp(join(tmpdir(), 'zone-assets-out-'));
  const result = runPython(`${loader}
out = ${JSON.stringify(out)}
assets = [
    (1, 'XAnimParts', None, {'name': None, 'late': 'late_named_anim'}),
    (2, 'XAnimParts', None, {'name': None}),
]
resolve = lambda obj: obj.get('late') if isinstance(obj, dict) else None
rows, index, summary = module.export_assets(assets, out, ['animations'], None, False, 'zone/test.ff', resolve)
print(json.dumps({'rows': rows, 'index': index, 'summary': summary}))
`);
  assert.deepEqual(result.rows.map(row => [row.entry, row.status]), [['late_named_anim', 'ok'], [null, 'unnamed']]);
  assert.deepEqual(result.index.animations.names, ['late_named_anim']);
  assert.deepEqual(result.summary.unnamed, [['animations', 'None', 1]]);
  assert.equal(existsSync(join(out, 'animations/late_named_anim.json')), true);
});

test('walker failure lines are grouped by asset type and error', { skip: !hasPython }, () => {
  const result = runPython(`${loader}
lines = [
    '  asset#10 (XAnimParts) failed (unresolved OFFSET VIRTUAL+0x3f (trace=[1])); resyncing',
    '  asset#11 (XAnimParts) failed (unresolved OFFSET VIRTUAL+0x40 (trace=[2])); resyncing',
    '  asset#12 (XModel) failed (bad count 77); no resync target',
    '  resync -> asset#13 (XAnimParts) @ 0x1234',
    '  resync gave up after asset#12',
]
print(json.dumps(module.summarize_failures(lines)))
`);
  assert.deepEqual(result, [
    ['XAnimParts', 'unresolved OFFSET VIRTUAL+N (trace=[N])', 2],
    ['XModel', 'bad count N', 1]
  ]);
});

test('weapons are written with links and pull in their animations, viewmodels and hand models', { skip: !hasPython }, async () => {
  const out = await mkdtemp(join(tmpdir(), 'zone-assets-out-'));
  const result = runPython(`${loader}
out = ${JSON.stringify(out)}
gun = {'name': 'm1911_gun'}
hands = {'name': 'viewmodel_hands_usmc'}
assets = [
    (1, 'XModel', 'm1911_gun', gun),
    (2, 'XModel', 'viewmodel_hands_usmc', hands),
    (3, 'XModel', 'zombie_body', {'name': 'zombie_body'}),
    (4, 'XAnimParts', 'viewmodel_m1911_fire', {'name': 'viewmodel_m1911_fire'}),
    (5, 'XAnimParts', 'viewmodel_unrelated_name', {'name': 'viewmodel_unrelated_name'}),
    (6, 'XAnimParts', 'zombie_walk', {'name': 'zombie_walk'}),
    (7, 'XAnimParts', 'm1911_reload', {'name': 'm1911_reload'}),
    (8, 'XModel', ',world_m1911', {'name': ',world_m1911'}),
    (9, 'WeaponVariantDef', 'm1911_zm', {
        'szInternalName': 'm1911_zm',
        'szXAnims': [b'viewmodel_m1911_fire\\x00', b'm1911_reload\\x00', b'm1911_missing\\x00'],
        'weapDef': module.Ref(4, 0, {'gunXModel': [module.Ref(1, 0, gun)], 'handXModel': module.Ref(2, 0, hands), 'worldModel': module.Ref(3, 0, {'name': ',world_m1911'})}),
    }),
    (10, 'WeaponVariantDef', ',remote_weapon', {'szInternalName': ',remote_weapon'}),
]
weapon = assets[8][3]
weapon['weapDef'].obj['worldModel'] = module.Ref(3, 0, assets[7][3])
rows, index, summary = module.export_assets(assets, out, ['weapons'], None, False, 'zone/test.ff')
only_rows, only_index, _ = module.export_assets(assets, out, ['weapons'], re.compile('nomatch', re.I), True, 'zone/test.ff')
print(json.dumps({'rows': rows, 'index': index, 'only_index': only_index}))
`);

  const status = Object.fromEntries(result.rows.map(row => [`${row.kind}:${row.entry}`, row.status]));
  assert.equal(status['weapons:m1911_zm'], 'ok');
  assert.equal(status['weapons:,remote_weapon'], 'reference');
  assert.equal(status['animations:viewmodel_m1911_fire'], 'ok');
  assert.equal(status['animations:m1911_reload'], 'ok');
  assert.equal(status['animations:viewmodel_unrelated_name'], 'ok');
  assert.equal(status['animations:zombie_walk'], undefined);
  assert.equal(status['models:m1911_gun'], 'ok');
  assert.equal(status['models:viewmodel_hands_usmc'], 'ok');
  assert.equal(status['models:zombie_body'], undefined);
  assert.deepEqual(result.index.weapons.names, ['m1911_zm']);
  assert.deepEqual(result.index.weapons.references, ['remote_weapon']);
  assert.deepEqual(result.index.weapons.links.m1911_zm, {
    animations: ['m1911_reload', 'viewmodel_m1911_fire'],
    missingAnimations: ['m1911_missing'],
    externalAnimations: [],
    models: ['m1911_gun', 'viewmodel_hands_usmc'],
    externalModels: ['world_m1911']
  });
  assert.deepEqual(result.only_index.weapons.names, []);

  const weapon = JSON.parse(await readFile(join(out, 'weapons/m1911_zm.json'), 'utf8'));
  assert.equal(weapon.type, 'WeaponVariantDef');
  assert.deepEqual(weapon.asset.weapDef.gunXModel, [{ assetRef: 'm1911_gun', assetType: 'XModel' }]);
  assert.deepEqual(weapon.asset.weapDef.handXModel, { assetRef: 'viewmodel_hands_usmc', assetType: 'XModel' });
  assert.equal(existsSync(join(out, 'animations/zombie_walk.json')), false);
  assert.equal(existsSync(join(out, 'models/viewmodel_hands_usmc.json')), true);
});
