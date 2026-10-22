import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHELLS, ENABLED, shellKindFor } from '../export/web/shell-kinds.js';

test('only pistols eject shells for now', () => {
  assert.deepEqual([...ENABLED], ['pistol']);
  assert.equal(shellKindFor({ kind: 'pistol' }), 'pistol');
  assert.equal(shellKindFor({ kind: 'shotgun' }), null);
  assert.equal(shellKindFor({ kind: 'smg' }), null);
  assert.equal(shellKindFor(null), null);
});

test('baked reference shell meshes are valid', () => {
  const models = JSON.parse(readFileSync(new URL('../export/web/shell-models.json', import.meta.url), 'utf8'));
  for (const spec of Object.values(SHELLS)) {
    const m = models[spec.model];
    assert.equal(m.pos.length % 3, 0);
    assert.equal(m.uv.length / 2, m.pos.length / 3);
    assert.ok(m.idx.every(i => i < m.pos.length / 3));
  }
});
