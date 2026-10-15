import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphicsSettings, AutoGraphics, GRAPHICS_PRESETS, nextSetting, lowerLevel, detectLowEnd, isWeakGpu } from '../export/web/graphics.js';

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
  for (let i = 0; i < 5 + 10 * 2; i++) if (auto.sample(30)) drops++;
  assert.equal(drops, 0);
  for (let i = 0; i < 10; i++) if (auto.sample(30)) drops++;
  assert.equal(drops, 1);
  const fast = new AutoGraphics({ targetMs: 16.7, windowFrames: 10, graceFrames: 0 });
  for (let i = 0; i < 200; i++) assert.equal(fast.sample(14), false);
  for (let i = 0; i < 200; i++) assert.equal(fast.sample(500), false); // hitches are ignored
});

test('low is much cheaper than medium: no post pass, lower resolution, shorter view, no overlay', () => {
  const { low, medium, high } = GRAPHICS_PRESETS;
  assert.equal(low.postProcess, false);
  assert.equal(low.muzzleLight, false);
  assert.equal(low.overlay, false);
  assert.ok(low.resolution < medium.resolution && low.minResolution < medium.minResolution);
  assert.ok(low.farScale < medium.farScale && medium.farScale <= high.farScale);
  assert.deepEqual([high.postProcess, medium.postProcess], [true, true]);
});

test('low-end devices such as Chromebooks default to low until the player chooses', () => {
  assert.equal(detectLowEnd({ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/120' }), true);
  assert.equal(detectLowEnd({ userAgent: 'Windows', hardwareConcurrency: 16, deviceMemory: 8 }), false);
  assert.equal(detectLowEnd({ userAgent: 'Windows', hardwareConcurrency: 8, deviceMemory: 4 }), true);
  assert.equal(detectLowEnd({ userAgent: 'Windows', hardwareConcurrency: 2, deviceMemory: 8 }), true);
  assert.equal(detectLowEnd({}), false);
  const storage = memory();
  const g = new GraphicsSettings({ storage, lowEnd: true });
  assert.equal(g.level, 'low');
  assert.equal(storage.getItem('codz.graphics'), null);
  g.set('high');
  assert.equal(new GraphicsSettings({ storage, lowEnd: true }).level, 'high');
});

test('a weak GPU switches an untouched setting to low but never overrides a choice', () => {
  assert.ok(isWeakGpu('ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11)'));
  assert.ok(isWeakGpu('Google SwiftShader'));
  assert.ok(isWeakGpu('Mali-G52'));
  assert.ok(!isWeakGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)'));
  assert.ok(!isWeakGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)'));
  const g = new GraphicsSettings({ storage: memory() });
  const seen = [];
  g.onChange(() => seen.push(g.level));
  assert.ok(g.assessGpu('Mali-G52'));
  assert.deepEqual(seen, ['low']);
  const chosen = new GraphicsSettings({ storage: memory() });
  chosen.set('high');
  assert.ok(!chosen.assessGpu('Mali-G52'));
  assert.equal(chosen.level, 'high');
});

test('auto drops two strikes at once when frames are severely slow', () => {
  const auto = new AutoGraphics({ targetMs: 16.7, windowFrames: 10, strikesToDrop: 3, graceFrames: 0 });
  let drops = 0;
  for (let i = 0; i < 20; i++) if (auto.sample(80)) drops++;
  assert.equal(drops, 1);
});
