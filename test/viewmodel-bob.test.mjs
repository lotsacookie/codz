import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewmodelBob } from '../export/web/viewmodel-bob.js';

const run = (bob, seconds, input, dt = 1 / 60) => {
  const samples = [];
  for (let t = 0; t < seconds; t += dt) samples.push({ ...bob.update(dt, input) });
  return samples;
};
const range = (samples, key) => Math.max(...samples.map(s => s[key])) - Math.min(...samples.map(s => s[key]));

test('standing still produces no bob', () => {
  const s = run(new ViewmodelBob(), 1, { moving: false });
  assert.ok(s.every(o => Object.values(o).every(v => v === 0)));
});

test('walking bobs side to side, up and down and rolls the gun', () => {
  const s = run(new ViewmodelBob(), 3, { moving: true });
  assert.ok(range(s, 'x') > 0.03);
  assert.ok(range(s, 'y') > 0.02);
  assert.ok(range(s, 'rz') > 0.02);
});

test('the gun drops twice per sway cycle (a figure of eight)', () => {
  const bob = new ViewmodelBob();
  run(bob, 2, { moving: true }); // reach full amplitude
  const s = run(bob, 1 / 1.9, { moving: true }); // one full cycle at walk rate
  let lows = 0;
  for (let i = 1; i < s.length - 1; i++) if (s[i].y < s[i - 1].y && s[i].y < s[i + 1].y) lows++;
  assert.equal(lows, 2);
});

test('sprinting bobs harder and faster than walking', () => {
  const walk = run(new ViewmodelBob(), 3, { moving: true });
  const sprint = run(new ViewmodelBob(), 3, { moving: true, sprint: true });
  assert.ok(range(sprint, 'x') > range(walk, 'x') * 1.4);
});

test('aiming down sights nearly removes the bob', () => {
  const hip = run(new ViewmodelBob(), 3, { moving: true });
  const ads = run(new ViewmodelBob(), 3, { moving: true, aim: 1 });
  assert.ok(range(ads, 'x') < range(hip, 'x') * 0.2);
});

test('stopping settles smoothly back to rest without a snap', () => {
  const bob = new ViewmodelBob();
  run(bob, 2, { moving: true });
  const s = run(bob, 1.5, { moving: false });
  const first = s[0];
  assert.ok(Math.abs(first.x) < 0.06);
  assert.equal(s.at(-1).x, 0);
  for (let i = 1; i < s.length; i++) assert.ok(Math.abs(s[i].x - s[i - 1].x) < 0.01, 'no jump');
});
