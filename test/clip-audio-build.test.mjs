import test from 'node:test';
import assert from 'node:assert/strict';
import { cueKey, selectClips } from '../.tools/build-clip-audio.mjs';

test('cueKey drops the sound root and extension', () => {
  assert.equal(cueKey('sound/vox/zmb/standard/attack_01.wav'), 'ref/vox/zmb/standard/attack_01');
  assert.equal(cueKey('english/sound/voiceovers/zmb/line.wav'), 'ref/english/voiceovers/zmb/line');
  assert.equal(cueKey('sound/wpn/pistol/m1911/fire 1.wav'), 'ref/wpn/pistol/m1911/fire_1');
  assert.equal(cueKey('sound/../etc/passwd.wav'), null);
  assert.equal(cueKey(''), null);
});

test('selectClips filters by pattern, sorts by name and skips duplicate keys', () => {
  const names = {
    'clips/c.wav': 'sound/wpn/b.wav',
    'clips/a.wav': 'sound/vox/zmb/a.wav',
    'clips/b.wav': 'sound/wpn/a.wav',
    'clips/d.wav': 'sound/wpn/a.wav'
  };
  assert.deepEqual(selectClips(names).map(item => item.key), ['ref/vox/zmb/a', 'ref/wpn/a', 'ref/wpn/b']);
  assert.deepEqual(selectClips(names, '^sound/wpn/').map(item => item.clip), ['clips/b.wav', 'clips/c.wav']);
});

test('treeNames lists named wavs under sound and english', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { treeNames } = await import('../.tools/build-clip-audio.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'tree-'));
  await mkdir(join(dir, 'sound/aml/dog'), { recursive: true });
  await mkdir(join(dir, 'english/sound/vox'), { recursive: true });
  await writeFile(join(dir, 'sound/aml/dog/dog_bite_00.wav'), '');
  await writeFile(join(dir, 'sound/aml/dog/readme.txt'), '');
  await writeFile(join(dir, 'english/sound/vox/line.wav'), '');
  const names = await treeNames(dir);
  assert.deepEqual(Object.keys(names).sort(), ['english/sound/vox/line.wav', 'sound/aml/dog/dog_bite_00.wav']);
  assert.deepEqual(selectClips(names).map(item => item.key).sort(), ['ref/aml/dog/dog_bite_00', 'ref/english/vox/line']);
});
