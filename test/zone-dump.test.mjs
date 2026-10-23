import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zoneFolder } from '../.tools/reference-pack/extract.mjs';

test('each zone gets its own folder, parent folder only prefixed on a name clash', () => {
  const taken = new Set();
  assert.equal(zoneFolder('zone/Common/common_zombie_patch.ff', taken), 'common_zombie_patch');
  assert.equal(zoneFolder('zone/Common/patch.ff', taken), 'patch');
  assert.equal(zoneFolder('zone/english/patch.ff', taken), 'english_patch');
  assert.equal(zoneFolder('zone\\Common\\code_pre_gfx_mp.ff', taken), 'code_pre_gfx_mp');
});

test('export_everything writes rawfiles (inflated) and every other asset type, unnamed ones by index', () => {
  const out = mkdtempSync(join(tmpdir(), 'zone-dump-'));
  const script = `
import importlib.util, sys, zlib, json
spec = importlib.util.spec_from_file_location('za', '.tools/reference-pack/zone-assets.py')
za = importlib.util.module_from_spec(spec); spec.loader.exec_module(za)
text = b'main()\\n{\\n}\\n'
packed = b'\\0\\0\\0\\0' + len(text).to_bytes(4, 'little') + zlib.compress(text)
raw = {'name': b'maps/x.gsc', 'len': len(packed), 'buffer': za.RawArray('char', len(packed))}
raw['buffer'].data = packed
assets = [
  (0, 'RawFile', 'maps/x.gsc', raw),
  (1, 'Material', 'mtl_a', {'name': 'mtl_a', 'w': 1}),
  (2, 'Material', None, {'w': 2}),
  (3, 'SKIPPED', None, None),
  (4, 'XModel', 'handled_elsewhere', {'name': 'handled_elsewhere'}),
]
rows, listing = za.export_everything(assets, sys.argv[1], 'common_zombie_patch')
print(json.dumps([r['file'] for r in rows]))
`;
  try {
    const files = JSON.parse(execFileSync('python3', ['-c', script, out], { encoding: 'utf8' }));
    assert.deepEqual(files, ['rawfiles/maps/x.gsc', 'assets/Material/mtl_a.json', 'assets/Material/_unnamed/2.json']);
    assert.equal(readFileSync(join(out, 'rawfiles/maps/x.gsc'), 'utf8'), 'main()\n{\n}\n');
    assert.equal(JSON.parse(readFileSync(join(out, 'assets/Material/_unnamed/2.json'), 'utf8')).index, 2);
    assert.equal(existsSync(join(out, 'assets/XModel')), false);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
