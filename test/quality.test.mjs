import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveResolution, applyAnisotropy, createPerfOverlay } from '../export/web/quality.js';
import { shortestAngle, turnToward } from '../export/web/steering.js';

const feed = (a, ms, frames) => { let last = null; for (let i = 0; i < frames; i++) { const r = a.sample(ms); if (r !== null) last = r; } return last; };

test('render scale drops when frames run long and never goes below the floor', () => {
  const a = new AdaptiveResolution({ min: .6, step: .1, windowFrames: 10 });
  assert.equal(feed(a, 25, 10), .9);
  feed(a, 25, 200);
  assert.equal(a.scale, .6);
});
test('a healthy frame rate keeps full resolution', () => {
  const a = new AdaptiveResolution({ windowFrames: 10 });
  assert.equal(feed(a, 16.5, 500), null);
  assert.equal(a.scale, 1);
});
test('hitches, pauses and disabled mode are ignored', () => {
  const a = new AdaptiveResolution({ windowFrames: 5 });
  assert.equal(feed(a, 500, 50), null);
  const off = new AdaptiveResolution({ windowFrames: 5, enabled: false });
  assert.equal(feed(off, 40, 50), null);
});
test('probes back up when stable, and backs off after a failed probe', () => {
  const a = new AdaptiveResolution({ windowFrames: 5, step: .1 });
  feed(a, 25, 5); assert.equal(a.scale, .9);
  const up = feed(a, 16, 5 * 4); assert.equal(up, .95, 'probe after 4 stable windows');
  assert.equal(feed(a, 25, 5), .85, 'failed probe drops again');
  assert.equal(a.holdWindows, 8, 'and waits longer before probing');
});
test('aim for the display cap: a 30 fps target tolerates 33 ms frames', () => {
  const a = new AdaptiveResolution({ targetMs: 1000 / 30, windowFrames: 10 });
  assert.equal(feed(a, 33.4, 200), null);
});

test('anisotropy is applied once per texture and never lowered', () => {
  const shared = { anisotropy: 1 }, sharp = { anisotropy: 16 };
  const root = { traverse(fn) { fn({ material: { map: shared, normalMap: sharp } }); fn({ material: [{ map: shared }, { emissiveMap: { anisotropy: 1 } }] }); fn({}); } };
  assert.equal(applyAnisotropy(root, 8), 3);
  assert.equal(shared.anisotropy, 8); assert.equal(sharp.anisotropy, 16);
  assert.equal(applyAnisotropy(root, 1), 0);
});
test('perf overlay only exists with ?perf=1', () => {
  assert.equal(createPerfOverlay('', {}), null);
  assert.equal(createPerfOverlay('?perf=0', {}), null);
});

test('shortestAngle takes the short way around', () => {
  assert.ok(Math.abs(shortestAngle(3.0, -3.0) - (2 * Math.PI - 6)) < 1e-9);
  assert.ok(Math.abs(shortestAngle(-3.0, 3.0) + (2 * Math.PI - 6)) < 1e-9);
});
test('turnToward eases, never overshoots and respects the speed cap', () => {
  let y = 0;
  const seen = [];
  for (let i = 0; i < 120; i++) { y = turnToward(y, 2, 1 / 60); seen.push(y); }
  assert.ok(seen.every((v, i) => !i || v >= seen[i - 1]), 'monotonic');
  assert.ok(seen.every(v => v <= 2 + 1e-9), 'no overshoot');
  assert.ok(Math.abs(seen.at(-1) - 2) < .01, 'arrives');
  assert.ok(seen[0] <= Math.PI * 2.4 / 60 + 1e-9, 'first step capped');
  assert.ok(Math.abs(turnToward(0, 2, 0) ) < 1e-12, 'zero dt does not move');
});
test('turnToward wraps across the +-pi seam instead of spinning the long way', () => {
  const y = turnToward(3.0, -3.0, 1 / 60);
  assert.ok(y > 3.0, 'continues increasing through pi, not back through zero');
});
