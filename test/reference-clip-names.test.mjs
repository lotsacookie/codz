import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyNames, clipNames, fetchLfsObject, parsePointer } from '../.tools/reference-pack/name-clips.mjs';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const pointerText = (oid, size) => `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;

test('parsePointer reads an LFS pointer and ignores real data', () => {
  assert.deepEqual(parsePointer(Buffer.from(pointerText(hashA, 42))), { oid: hashA, size: 42 });
  assert.equal(parsePointer(Buffer.from('KSIX not a pointer')), null);
  assert.equal(parsePointer(Buffer.alloc(5000, 1)), null);
});

test('clipNames maps clip files to forward-slash sound names', () => {
  const index = Buffer.from(`\0\0sound\\zmb\\zombie\\attack_01.wavclips/${hashA}.wav\0\0english\\sound\\vox\\line.wavclips/${hashB}.wav`, 'latin1');
  const names = clipNames(index);
  assert.equal(names[`clips/${hashA}.wav`], 'sound/zmb/zombie/attack_01.wav');
  assert.equal(names[`clips/${hashB}.wav`], 'english/sound/vox/line.wav');
});

test('fetchLfsObject verifies the download against the pointer', async () => {
  const body = Buffer.from('index bytes');
  const oid = createHash('sha256').update(body).digest('hex');
  const make = payload => async url => String(url).endsWith('/batch')
    ? { ok: true, json: async () => ({ objects: [{ actions: { download: { href: 'https://lfs.example/object', header: {} } } }] }) }
    : { ok: true, arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length) };
  assert.deepEqual(await fetchLfsObject('o/r', { oid, size: body.length }, make(body)), body);
  await assert.rejects(fetchLfsObject('o/r', { oid, size: body.length }, make(Buffer.from('tampered!!!'))), /does not match/);
});

test('applyNames moves clips, never replaces files and skips unsafe names', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'clipnames-'));
  try {
    mkdirSync(path.join(dir, 'clips'));
    writeFileSync(path.join(dir, `clips/${hashA}.wav`), 'A');
    writeFileSync(path.join(dir, `clips/${hashB}.wav`), 'B');
    mkdirSync(path.join(dir, 'sound'));
    writeFileSync(path.join(dir, 'sound/taken.wav'), 'old');
    const result = await applyNames(dir, {
      [`clips/${hashA}.wav`]: 'sound/zmb/a.wav',
      [`clips/${hashB}.wav`]: 'sound/taken.wav',
      'clips/missing.wav': 'sound/missing.wav'
    });
    assert.equal(readFileSync(path.join(dir, 'sound/zmb/a.wav'), 'utf8'), 'A');
    assert.equal(existsSync(path.join(dir, `clips/${hashA}.wav`)), false);
    assert.equal(readFileSync(path.join(dir, 'sound/taken.wav'), 'utf8'), 'old');
    assert.equal(result.moved.length, 1);
    assert.deepEqual(result.skipped.map(item => item.reason).sort(), ['missing', 'target-exists']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
