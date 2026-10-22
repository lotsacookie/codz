import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TouchInput } from '../export/web/assets/js/touch-controls.js';

test('stick has a dead zone, proportional walking, and a circular speed limit', () => {
  const input = new TouchInput();
  input.begin(1, 'move', 100, 100);
  input.move(1, 103, 98);
  assert.equal(input.read().forward, 0);
  input.move(1, 100, 75);
  assert.ok(input.read().forward > 0.4 && input.read().forward < 0.5);
  input.move(1, 200, 0);
  const diagonal = input.read();
  assert.ok(Math.abs(Math.hypot(diagonal.forward, diagonal.strafe) - 1) < 1e-10);
  assert.equal(diagonal.sprint, false);
  input.end(1);
  assert.equal(input.read().forward, 0);
  assert.equal(input.read().strafe, 0);
});

test('movement, looking, and firing are owned by separate fingers', () => {
  const turns = [];
  const input = new TouchInput({ onLook: (...delta) => turns.push(delta) });
  input.begin(1, 'move', 0, 0);
  input.move(1, 0, -50);
  assert.equal(input.begin(2, 'move', 20, 20), false);
  input.begin(2, 'look', 200, 100);
  input.move(2, 225, 90);
  input.begin(3, 'fire', 300, 150);
  input.move(3, 325, 150);
  input.move(2, 250, 90); // Fire owns aim while both right-side fingers move.
  assert.deepEqual(turns, [[25, -10], [25, 0]]);
  assert.equal(input.read().forward, 1);
  assert.equal(input.read().fire, true);
  input.end(3);
  input.move(2, 252, 90);
  assert.deepEqual(turns.at(-1), [2, 0]);
  assert.equal(input.read().fire, false);
  assert.equal(input.read().forward, 1);
});

test('sprint uses hysteresis and yields immediately to aim, crouch, or fire', () => {
  const input = new TouchInput();
  input.begin(1, 'move', 0, 0);
  input.move(1, 0, -50);
  assert.equal(input.read().sprint, true);
  input.move(1, 0, -42);
  assert.equal(input.read().sprint, true);
  for (const action of ['aim', 'crouch', 'fire']) {
    input.begin(2, action, 0, 0);
    assert.equal(input.read().sprint, false, action);
    input.end(2);
    if (action !== 'fire') { input.begin(2, action, 0, 0); input.end(2); }
    assert.equal(input.read().sprint, true);
  }
  input.move(1, 0, 50);
  assert.equal(input.read().sprint, false);
});

test('quick fire and jump taps survive until one simulation frame', () => {
  const input = new TouchInput();
  for (const kind of ['fire', 'jump']) {
    input.begin(1, kind, 0, 0);
    input.end(1);
    assert.equal(input.read()[kind], true);
    assert.equal(input.read()[kind], false);
  }
});

test('cancellation discards pending actions and reset clears every owned input', () => {
  const input = new TouchInput();
  input.begin(1, 'fire', 0, 0);
  input.end(1, true);
  assert.equal(input.read().fire, false);
  input.begin(1, 'jump', 0, 0);
  input.end(1, true);
  assert.equal(input.read().jump, false);
  input.begin(1, 'move', 0, 0);
  input.move(1, 50, -50);
  input.begin(2, 'fire', 0, 0);
  input.begin(3, 'aim', 0, 0);
  input.begin(4, 'crouch', 0, 0);
  input.reset();
  input.move(1, 500, 500); // Stale events after rotation or pause have no effect.
  assert.deepEqual(input.read(), { forward: 0, strafe: 0, sprint: false, crouch: false, aim: false, fire: false, firePressed: false, jump: false, use: false, hack: false });
  assert.equal(input.getState().pointers, 0);
});

test('reload is invoked once per pointer press', () => {
  let reloads = 0;
  const input = new TouchInput({ onAction: () => reloads++ });
  input.begin(1, 'reload', 0, 0);
  input.begin(1, 'reload', 0, 0);
  input.move(1, 200, 200);
  assert.equal(reloads, 1);
  input.end(1);
  input.begin(1, 'reload', 0, 0);
  assert.equal(reloads, 2);
});

test('held fire has one press edge, and a quick tap still fires once', () => {
  const input = new TouchInput();
  input.begin(1, 'fire', 0, 0);
  assert.equal(input.read().firePressed, true);
  const held = input.read();
  assert.equal(held.fire, true);
  assert.equal(held.firePressed, false);
  input.end(1);
  input.begin(2, 'fire', 0, 0);
  input.end(2);
  assert.equal(input.read().firePressed, true);
  assert.equal(input.read().fire, false);
});

test('use and hack remain held across frames and cancel independently', () => {
  const actions = [];
  const input = new TouchInput({ onAction: action => actions.push(action) });
  input.begin(1, 'use', 0, 0);
  input.begin(2, 'hack', 0, 0);
  input.move(1, 400, 300);
  assert.equal(input.read().use, true);
  assert.equal(input.read().use, true);
  assert.equal(input.read().hack, true);
  assert.deepEqual(actions, ['use', 'hack']);
  input.end(1, true);
  assert.equal(input.read().use, false);
  assert.equal(input.read().hack, true);
  input.reset();
  assert.equal(input.read().hack, false);
});
