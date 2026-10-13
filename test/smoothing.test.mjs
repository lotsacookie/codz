import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraSmoother } from '../export/web/camera-smoothing.js';
import { damp, steerDirection, smoothingEnabled } from '../export/web/steering.js';

const run = (s, frames, dt, state) => { let out; for (let i = 0; i < frames; i++) out = s.update(dt, typeof state === 'function' ? state(i) : state); return out; };
const stand = { feetY: 0, eyeHeight: 60, onFloor: true, velocityY: 0 };

test('damp is frame-rate independent', () => {
  let a = 0, b = 0;
  for (let i = 0; i < 60; i++) a = damp(a, 1, 10, 1 / 60);
  for (let i = 0; i < 120; i++) b = damp(b, 1, 10, 1 / 120);
  assert.ok(Math.abs(a - b) < 1e-9);
});

test('crouching eases the eye down instead of snapping, then settles exactly', () => {
  const s = new CameraSmoother();
  run(s, 5, 1 / 60, stand);
  const first = s.update(1 / 60, { ...stand, eyeHeight: 40 }).eye;
  assert.ok(first < 60 && first > 50, `first frame ${first} moves only part of the way`);
  const settled = run(s, 120, 1 / 60, { ...stand, eyeHeight: 40 }).eye;
  assert.ok(Math.abs(settled - 40) < .01);
  const up = [];
  for (let i = 0; i < 120; i++) up.push(s.update(1 / 60, stand).eye);
  assert.ok(up.every((v, i) => !i || v >= up[i - 1]), 'standing up is monotonic');
});

test('a stair step is absorbed: the view does not jump, then glides to the new height', () => {
  const s = new CameraSmoother();
  run(s, 5, 1 / 60, stand);
  const before = s.update(1 / 60, stand);
  const after = s.update(1 / 60, { ...stand, feetY: 12 });
  const viewJump = (12 + after.eye + after.offset) - (0 + before.eye + before.offset);
  assert.ok(Math.abs(viewJump) < 2.5, `view moved ${viewJump} instead of 12`);
  const end = run(s, 90, 1 / 60, { ...stand, feetY: 12 });
  assert.ok(Math.abs(end.offset) < .05, 'offset decays to zero');
});

test('walking up a gentle ramp is left alone', () => {
  const s = new CameraSmoother();
  const out = run(s, 120, 1 / 60, i => ({ ...stand, feetY: i * 1.2 }));  // 72 units/s
  assert.ok(Math.abs(out.offset) < 1e-6);
});

test('landing dips the view briefly and recovers; hard falls dip more but are capped', () => {
  const dip = vy => {
    const s = new CameraSmoother();
    run(s, 5, 1 / 60, { ...stand, onFloor: false, velocityY: vy });
    let min = 0, last;
    for (let i = 0; i < 180; i++) { last = s.update(1 / 60, { ...stand, onFloor: true }); min = Math.min(min, last.offset); }
    assert.ok(Math.abs(last.offset) < .05, 'recovers');
    return min;
  };
  const small = dip(-200), hard = dip(-700), extreme = dip(-5000);
  assert.ok(small < -.3 && small > -3.6);
  assert.ok(hard <= small);
  assert.ok(extreme >= -3.5 - 1e-9, 'capped');
  assert.equal(dip(-60), 0, 'tiny drops do nothing');
});

test('teleports and respawns do not glide across the map', () => {
  const s = new CameraSmoother();
  run(s, 5, 1 / 60, stand);
  const out = s.update(1 / 60, { ...stand, feetY: 900 });
  assert.equal(out.offset, 0);
});

test('steerDirection bends a path gradually and keeps horizontal speed constant', () => {
  const dir = { x: 1, y: 0, z: 0 };
  const want = { x: 0, y: 0, z: 1 };
  steerDirection(dir, want, 1 / 60, 8);
  assert.ok(dir.x > .9 && dir.z > 0 && dir.z < .5, 'first frame turns only a little');
  assert.ok(Math.abs(Math.hypot(dir.x, dir.z) - 1) < 1e-9);
  for (let i = 0; i < 120; i++) steerDirection(dir, want, 1 / 60, 8);
  assert.ok(dir.z > .999);
});
test('steerDirection with an infinite rate is the old instant behaviour', () => {
  const dir = { x: 1, y: 0, z: 0 };
  steerDirection(dir, { x: 0, y: .25, z: 1 }, 1 / 60, Infinity);
  assert.deepEqual([dir.x, dir.y, dir.z], [0, .25, 1]);
});
test('steerDirection survives an exact reversal', () => {
  const dir = { x: 1, y: 0, z: 0 };
  steerDirection(dir, { x: -1, y: 0, z: 0 }, 1 / 60, Infinity);
  assert.equal(dir.x, -1);
  const d2 = { x: 1, y: 0, z: 0 };
  for (let i = 0; i < 5; i++) steerDirection(d2, { x: -1, y: 0, z: 0 }, 1 / 60, 8);
  assert.ok(Number.isFinite(d2.x) && Number.isFinite(d2.z));
});

test('?smooth=0 disables smoothing', () => {
  assert.equal(smoothingEnabled(''), true);
  assert.equal(smoothingEnabled('?perf=1&smooth=0'), false);
  assert.equal(smoothingEnabled('?smooth=1'), true);
});
