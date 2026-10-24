import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { RAYGUN_FX, ringsDue, ringState } from '../export/web/assets/js/raygun-fx-data.js';

test('reference ring and glow textures exist', () => {
  for (const url of [RAYGUN_FX.ringUrl, RAYGUN_FX.glowUrl]) assert.ok(existsSync(new URL('../export/web/assets/' + url, import.meta.url)), url);
});

test('ringsDue emits at the configured rate and carries the remainder', () => {
  let carry = 0, total = 0;
  for (let i = 0; i < 60; i++) { const due = ringsDue(carry, 1 / 60, 36); carry = due.carry; total += due.count; }
  assert.ok(total === 35 || total === 36, 'floating point may leave one ring in the carry');
  assert.deepEqual(ringsDue(0.5, 0.25, 6), { count: 2, carry: 0 });
});

test('ringState expands, fades and finishes', () => {
  assert.deepEqual(ringState(0, 1, 2), { scale: 1, opacity: 1, done: false });
  const mid = ringState(0.5, 1, 2);
  assert.ok(mid.scale > 1 && mid.opacity < 1 && !mid.done);
  assert.equal(ringState(1, 1, 2).done, true);
});
