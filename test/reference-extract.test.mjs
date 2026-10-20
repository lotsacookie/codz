import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { classifyEntry, iwiToPng, fxNames } from '../.tools/reference-pack/extract.mjs';
import { scanRawFiles, inflateZone } from '../.tools/reference-pack/lib.mjs';

const header = (format, w, h) => { const b = Buffer.alloc(48); b.write('IWi', 0, 'latin1'); b[3] = 13; b[4] = format; b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); b.writeUInt16LE(1, 10); return b; };

test('IWI BGRA decodes to a PNG', () => {
  const result = iwiToPng(Buffer.concat([header(1, 2, 1), Buffer.from([0, 0, 255, 255, 0, 255, 0, 128])]));
  assert.equal(result.width, 2);
  assert.equal(result.png.subarray(1, 4).toString(), 'PNG');
});

test('bad or truncated IWI is reported, not thrown', () => {
  assert.ok(iwiToPng(Buffer.from('nope')).error);
  assert.ok(iwiToPng(Buffer.concat([header(1, 4, 4), Buffer.alloc(8)])).error);
});

test('entries classify and fx names filter', () => {
  assert.equal(classifyEntry('images/fx_smoke.iwi'), 'images');
  assert.equal(classifyEntry('sound/x/a.wav'), 'sounds');
  assert.equal(classifyEntry('maps/x.gsc'), 'raw');
  assert.deepEqual(fxNames(new Set(['fx/maps/zombie/fx_muzzle_flash', 'weapon_ak47'])), ['fx/maps/zombie/fx_muzzle_flash']);
});

test('put never replaces an existing file unless overwrite is set', async () => {
  const { mkdtemp, readFile, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { put, targetFor } = await import('../.tools/reference-pack/extract.mjs');
  const out = await mkdtemp(join(tmpdir(), 'extract-'));
  assert.deepEqual(await put(out, 'images/a.png', Buffer.from('one')), { file: 'images/a.png', existed: false });
  assert.deepEqual(await put(out, 'images/a.png', Buffer.from('two')), { file: 'images/a.png', existed: true });
  assert.equal((await readFile(join(out, 'images/a.png'))).toString(), 'one');
  await put(out, 'images/a.png', Buffer.from('three'), true);
  assert.equal((await readFile(join(out, 'images/a.png'))).toString(), 'three');
  assert.equal(targetFor('images', 'images/fx_smoke.iwi'), 'images/fx_smoke.png');
  assert.equal((await put(out, '../escape.txt', Buffer.from('x'))).file, null);
});

test('raw-file scripts are found by name in an uncompressed IWffr100 zone', () => {
  const source = Buffer.from('#include maps\\_utility;\r\nmain()\r\n{\r\n}\r\n');
  const packed = zlib.deflateSync(source);
  const head = Buffer.alloc(8); head.writeUInt32LE(source.length, 0); head.writeUInt32LE(packed.length, 4);
  const body = Buffer.concat([Buffer.alloc(32, 0xff), Buffer.from('maps/zombie_test.gsc\0'), head, packed, Buffer.alloc(16)]);
  const zone = Buffer.concat([Buffer.from('IWffr100'), Buffer.alloc(4), body]);
  const inflated = inflateZone(zone);
  assert.ok(inflated.data);
  const files = scanRawFiles(inflated.data);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'maps/zombie_test.gsc');
  assert.equal(files[0].data.toString(), source.toString());
});
