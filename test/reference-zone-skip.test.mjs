import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zoneIsDone, markZoneDone } from '../.tools/reference-pack/extract.mjs';

const dir = await mkdtemp(join(tmpdir(), 'zone-skip-'));
const item = { path: 'zone/Common/zombie_theater.ff', sha256: 'abc' };
const kinds = new Set(['models', 'scripts', 'images']);
try {
  assert.equal(await zoneIsDone(dir, item, kinds, null), false, 'nothing walked yet');
  await writeFile(join(dir, '_zone.json'), JSON.stringify({ complete: false }));
  assert.equal(await markZoneDone(dir, item, kinds, null), false, 'incomplete walks are never stamped');
  await writeFile(join(dir, '_zone.json'), JSON.stringify({ complete: true }));
  assert.equal(await markZoneDone(dir, item, kinds, null), true);
  assert.equal(await zoneIsDone(dir, item, kinds, null), true, 'same source and kinds: skipped');
  assert.equal(await zoneIsDone(dir, item, new Set(['images', 'sounds']), null), true, 'archive-only kinds do not matter');
  assert.equal(await zoneIsDone(dir, item, new Set([...kinds, 'weapons']), null), false, 'new zone kind: redo');
  assert.equal(await zoneIsDone(dir, { ...item, sha256: 'def' }, kinds, null), false, 'source changed: redo');
  assert.equal(await zoneIsDone(dir, item, kinds, /dempsey/i), false, 'different --only: redo');
  console.log('reference-zone-skip ok');
} finally { await rm(dir, { recursive: true, force: true }); }
