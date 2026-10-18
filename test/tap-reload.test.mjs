import test from 'node:test';
import assert from 'node:assert/strict';
import { TapReload } from '../export/web/tap-reload.js';

test('a quick tap reloads when the button is released', () => {
  const tap = new TapReload();
  tap.press();
  assert.equal(tap.update(1 / 60, true), false);
  assert.equal(tap.update(1 / 60, true), false);
  assert.equal(tap.update(1 / 60, false), true);
  assert.equal(tap.update(1 / 60, false), false);
});

test('holding past the window keeps repairing and never reloads', () => {
  const tap = new TapReload(0.25);
  tap.press();
  let reloads = 0;
  for (let i = 0; i < 60; i++) if (tap.update(1 / 60, true)) reloads++;
  assert.equal(tap.update(1 / 60, false), false);
  assert.equal(reloads, 0);
});

test('a tap that is already released on the first step still reloads', () => {
  const tap = new TapReload();
  tap.press();
  assert.equal(tap.update(1 / 60, false), true);
});

test('cancel drops a pending tap', () => {
  const tap = new TapReload();
  tap.press();
  tap.cancel();
  assert.equal(tap.update(1 / 60, false), false);
});

test('without a press nothing happens', () => {
  const tap = new TapReload();
  assert.equal(tap.update(1, false), false);
  assert.equal(tap.update(1, true), false);
});
