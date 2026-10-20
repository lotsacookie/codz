import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEntry, iwiToPng, fxNames } from '../.tools/reference-pack/extract.mjs';

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
