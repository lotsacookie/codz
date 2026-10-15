import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphicsSettings, AutoGraphics, GRAPHICS_PRESETS, nextSetting, lowerLevel } from '../export/web/graphics.js';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('graphics defaults to auto at high and persists a chosen setting', () => {
  const storage = memory();
  const g = new GraphicsSettings({ storage });
  assert.equal(g.setting, 'auto');
  assert.equal(g.level, 'high');
  g.set('low');
  assert.equal(new GraphicsSettings({ storage }).setting, 'low');
  assert.equal(new GraphicsSettings({ storage }).level, 'low');
});

test('low has no shadows or god rays and is slightly dimmer; high has all of them', () => {
  assert.deepEqual([GRAPHICS_PRESETS.low.shadows, GRAPHICS_PRESETS.low.godRays], [false, false]);
  assert.ok(GRAPHICS_PRESETS.low.sunScale < 1 && GRAPHICS_PRESETS.low.sunScale > 0.5);
  assert.deepEqual([GRAPHICS_PRESETS.high.shadows, GRAPHICS_PRESETS.high.godRays], [true, true]);
  assert.deepEqual([GRAPHICS_PRESETS.medium.shadows, GRAPHICS_PRESETS.medium.godRays], [true, false]);
});

test('the menu cycles auto, high, medium, low', () => {
  assert.equal(nextSetting('auto'), 'high');
  assert.equal(nextSetting('high'), 'medium');
  assert.equal(nextSetting('medium'), 'low');
  assert.equal(nextSetting('low'), 'auto');
  assert.equal(lowerLevel('low'), 'low');
});

test('auto steps down one level at a time and a manual setting never changes on its own', () => {
  const g = new GraphicsSettings({ storage: memory() });
  const seen = [];
  g.onChange(() => seen.push(g.level));
  assert.ok(g.stepDown()); assert.ok(g.stepDown()); assert.ok(!g.stepDown());
  assert.deepEqual(seen, ['medium', 'low']);
  g.set('high');
  assert.ok(!g.stepDown());
  assert.equal(g.level, 'high');
  g.set('auto');
  assert.equal(g.level, 'high');
});

test('auto graphics asks to step down only after sustained slow frames', () => {
  const auto = new AutoGraphics({ targetMs: 16.7, windowFrames: 10, strikesToDrop: 3, graceFrames: 5 });
  let drops = 0;
  for (let i = 0; i < 5 + 10 * 2; i++) if (auto.sample(40)) drops++;
  assert.equal(drops, 0);
  for (let i = 0; i < 10; i++) if (auto.sample(40)) drops++;
  assert.equal(drops, 1);
  const fast = new AutoGraphics({ targetMs: 16.7, windowFrames: 10, graceFrames: 0 });
  for (let i = 0; i < 200; i++) assert.equal(fast.sample(14), false);
  for (let i = 0; i < 200; i++) assert.equal(fast.sample(500), false); // hitches are ignored
});
