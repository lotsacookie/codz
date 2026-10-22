import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHELLS, ENABLED, shellKindFor } from '../export/web/shell-kinds.js';

test('pistols and shotguns eject shells', () => {
  assert.deepEqual([...ENABLED], ['pistol', 'shotgun']);
  assert.equal(shellKindFor({ kind: 'pistol' }), 'pistol');
  assert.equal(shellKindFor({ kind: 'shotgun' }), 'shotgun');
  assert.equal(shellKindFor({ kind: 'smg' }), null);
  assert.equal(shellKindFor(null), null);
});

test('baked reference shell meshes are valid', () => {
  const models = JSON.parse(readFileSync(new URL('../export/web/assets/data/shell-models.json', import.meta.url), 'utf8'));
  for (const spec of Object.values(SHELLS)) {
    const m = models[spec.model];
    assert.equal(m.pos.length % 3, 0);
    assert.equal(m.uv.length / 2, m.pos.length / 3);
    assert.ok(m.idx.every(i => i < m.pos.length / 3));
  }
});

test('shell and wood chip textures ship in the deployed textures directories', async () => {
  const { existsSync } = await import('node:fs');
  const files = [...Object.values(SHELLS).map(s => s.texture), '~-gfx_wood_splinter_col.png'];
  for (const dir of ['textures', 'textures-mobile']) {
    for (const file of files) assert.ok(existsSync(new URL(`../export/web/${dir}/${file}`, import.meta.url)), `${dir}/${file}`);
  }
  const stage = readFileSync(new URL('../.tools/stage-cloudflare.mjs', import.meta.url), 'utf8');
  assert.ok(stage.includes("'assets/data/shell-models.json'"), 'staging copies shell-models.json');
});
