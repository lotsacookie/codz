import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUTTON, GamepadInput, LOOK_SPEED, MenuNav, mergeInput, pickPad, stick,
} from '../export/web/gamepad.js';

// A fake standard-mapping pad whose state the tests edit between frames.
function fakePad(index = 0) {
  const pad = {
    index, connected: true, mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    press(name, value = 1) { this.buttons[BUTTON[name]] = { pressed: value > 0.5, value }; return this; },
    release(name) { this.buttons[BUTTON[name]] = { pressed: false, value: 0 }; return this; },
    stickLeft(x, y) { this.axes[0] = x; this.axes[1] = y; return this; },
    stickRight(x, y) { this.axes[2] = x; this.axes[3] = y; return this; },
  };
  return pad;
}

function harness({ enabled = true, visible = enabled } = {}) {
  const pad = fakePad();
  const log = { actions: [], looks: [], pauses: 0 };
  let time = 0;
  const input = new GamepadInput({
    getPads: () => [pad], now: () => time,
    onAction: action => log.actions.push(action),
    onLook: (x, y) => log.looks.push([x, y]),
    onPause: () => { log.pauses++; },
  });
  input.setEnabled(enabled, visible);
  // One 60 Hz frame.
  const frame = () => { time += 1000 / 60; return input.read(); };
  frame();
  return { pad, input, log, frame };
}

test('sticks have a radial dead zone and rescale smoothly from its edge', () => {
  assert.deepEqual(stick(0.1, 0.1, 0.2), { x: 0, y: 0, magnitude: 0 });
  const full = stick(0, -1, 0.2);
  assert.equal(full.magnitude, 1);
  assert.equal(full.y, -1);
  const diagonal = stick(1, 1, 0.2);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-12, 'diagonal is not faster than straight');
  const justOut = stick(0.21, 0, 0.2);
  assert.ok(justOut.magnitude > 0 && justOut.magnitude < 0.02, 'no jump at the dead-zone edge');
});

test('left stick moves: up is forward, right is strafe right', () => {
  const { pad, frame } = harness();
  pad.stickLeft(0, -1);
  assert.equal(frame().forward, 1);
  pad.stickLeft(1, 0);
  const right = frame();
  assert.equal(right.strafe, 1);
  assert.equal(right.forward, 0);
  pad.stickLeft(0.1, 0.1);
  assert.equal(frame().strafe, 0);
});

test('right stick looks in frame-rate independent units and respects its dead zone', () => {
  const { pad, log, frame } = harness();
  pad.stickRight(0.05, 0);
  frame();
  assert.equal(log.looks.length, 0);
  pad.stickRight(1, 0);
  frame();
  const [x, y] = log.looks.at(-1);
  assert.ok(Math.abs(x - LOOK_SPEED / 60) < 1e-9);
  assert.equal(y, 0);
  pad.stickRight(0, 1);
  frame();
  assert.ok(log.looks.at(-1)[1] > 0, 'pushing down looks down (not inverted)');
});

test('L3 sprints while moving forward, and fire, aim or releasing the stick end it', () => {
  const { pad, frame } = harness();
  pad.press('LS');
  assert.equal(frame().sprint, false, 'no sprint without forward movement');
  pad.release('LS');
  pad.stickLeft(0, -1);
  frame();
  pad.press('LS');
  assert.equal(frame().sprint, true);
  pad.release('LS');
  assert.equal(frame().sprint, true, 'sprint stays latched after the click');

  pad.press('RT');
  assert.equal(frame().sprint, false, 'firing ends sprint');
  pad.release('RT');
  assert.equal(frame().sprint, false, 'and it does not resume by itself');

  pad.press('LS');
  frame();
  pad.release('LS');
  pad.stickLeft(0, 0);
  frame();
  pad.stickLeft(0, -1);
  assert.equal(frame().sprint, false, 'letting go of the stick ends sprint');
});

test('A jumps once per press; B toggles crouch; A stands up instead of jumping', () => {
  const { pad, frame } = harness();
  pad.press('A');
  assert.equal(frame().jump, true);
  assert.equal(frame().jump, false, 'holding A does not repeat the jump');
  pad.release('A');
  frame();

  pad.press('B');
  assert.equal(frame().crouch, true);
  pad.release('B');
  assert.equal(frame().crouch, true, 'crouch is a toggle');
  pad.press('A');
  const stand = frame();
  assert.equal(stand.crouch, false);
  assert.equal(stand.jump, false);
  pad.release('A');
  frame();
  pad.press('B');
  frame();
  pad.release('B');
  assert.equal(frame().crouch, true);
  pad.press('B');
  assert.equal(frame().crouch, false);
});

test('triggers fire and aim at a half pull, and fire reports its leading edge once', () => {
  const { pad, frame } = harness();
  pad.press('RT', 0.2);
  assert.equal(frame().fire, false, 'a graze is not a shot');
  pad.press('RT', 0.6);
  const first = frame();
  assert.equal(first.fire, true);
  assert.equal(first.firePressed, true);
  const held = frame();
  assert.equal(held.fire, true);
  assert.equal(held.firePressed, false);
  pad.press('LT', 0.9);
  assert.equal(frame().aim, true);
});

test('buttons map to the Black Ops console actions, once per press', () => {
  const { pad, log, frame } = harness();
  const expected = {
    X: ['usereload'], Y: ['weapon'], LB: ['grenade'], RB: ['equipment'],
    RS: ['melee'], UP: ['attachment'], DOWN: ['claymore', 'suit'], BACK: ['journal'],
  };
  for (const [name, actions] of Object.entries(expected)) {
    log.actions.length = 0;
    pad.press(name);
    frame();
    frame(); // still held
    assert.deepEqual(log.actions, actions, name);
    pad.release(name);
    frame();
  }
  pad.press('X');
  assert.equal(frame().use, true, 'X is also held-to-use (barricades, hacking)');
});

test('Start pauses; while paused nothing acts and a held button is not a fresh press on resume', () => {
  const { pad, input, log, frame } = harness();
  pad.press('START');
  frame();
  assert.equal(log.pauses, 1);
  pad.release('START');

  input.setEnabled(false);
  pad.press('A');
  pad.press('X');
  pad.press('RT');
  const paused = frame();
  assert.equal(paused.jump || paused.fire || paused.use, false);
  assert.deepEqual(log.actions, []);

  // Resume while A is still held: no jump or reload.
  input.setEnabled(true);
  const resumed = frame();
  assert.equal(resumed.jump, false);
  assert.deepEqual(log.actions, []);
  assert.equal(resumed.fire, true, 'a held trigger is still held');
  assert.equal(resumed.firePressed, false);
});

test('a downed player cannot act but can still pause', () => {
  const { pad, log, frame } = harness({ enabled: false, visible: true });
  pad.press('X');
  frame();
  assert.deepEqual(log.actions, []);
  pad.release('X');
  pad.press('START');
  frame();
  assert.equal(log.pauses, 1);
});

test('disconnecting the pad neutralises input and clears latches', () => {
  const { pad, input, frame } = harness();
  pad.stickLeft(0, -1);
  frame();
  pad.press('LS');
  assert.equal(frame().sprint, true);
  input.getPads = () => [];
  const gone = frame();
  assert.equal(gone.forward, 0);
  assert.equal(gone.sprint, false);
  assert.equal(input.connected, false);
});

test('pickPad follows the pad that is being used and ignores non-pads', () => {
  const idle = fakePad(0);
  const busy = fakePad(1).press('A');
  const keyboardLike = { index: 2, connected: true, axes: [], buttons: [] };
  assert.equal(pickPad([idle, keyboardLike], null), idle);
  assert.equal(pickPad([idle, busy], 0), busy);
  assert.equal(pickPad([keyboardLike], null), null);
  assert.equal(pickPad([], null), null);
});

test('merging keeps touch and adds the pad without exceeding full speed', () => {
  const touch = { forward: 0.5, strafe: 0, sprint: false, crouch: false, aim: false, fire: false, firePressed: false, jump: false, use: false, hack: false, pointers: 2 };
  const pad = { forward: 0.8, strafe: -1, sprint: true, crouch: false, aim: true, fire: false, firePressed: false, jump: true, use: false, hack: false };
  const merged = mergeInput(touch, pad);
  assert.equal(merged.forward, 1);
  assert.equal(merged.strafe, -1);
  assert.equal(merged.sprint, true);
  assert.equal(merged.aim, true);
  assert.equal(merged.jump, true);
  assert.equal(merged.pointers, 2, 'unrelated touch fields pass through');
});

test('menu navigation steps through items, repeats while held, and selects the focused item', () => {
  const pad = fakePad();
  let time = 0;
  const items = ['a', 'b', 'c'].map(name => ({ name }));
  let focused = null;
  const selected = [];
  let blocked = false;
  const nav = new MenuNav({
    getItems: () => items, getFocused: () => focused, focus: item => { focused = item; },
    getDefault: list => list[1],
    onSelect: item => selected.push(item), getPads: () => [pad], now: () => time,
    isBlocked: () => blocked,
  });
  const poll = (advance = 16) => { time += advance; nav.poll(); };

  pad.press('DOWN');
  poll();
  assert.equal(focused, items[1], 'the first move reveals the default item');
  poll(100);
  assert.equal(focused, items[1], 'no repeat before the initial delay');
  poll(300);
  assert.equal(focused, items[2], 'repeats after the initial delay');
  poll(120);
  assert.equal(focused, items[0], 'wraps around');
  pad.release('DOWN');
  poll();
  pad.press('UP');
  poll();
  assert.equal(focused, items[2]);

  pad.release('UP');
  poll();
  pad.press('A');
  poll();
  assert.deepEqual(selected, [items[2]]);
  poll();
  assert.equal(selected.length, 1, 'holding A does not select twice');

  // While the game runs, the menu ignores the pad but keeps its previous state fresh.
  pad.release('A');
  poll();
  blocked = true;
  pad.press('START');
  poll();
  const starts = [];
  nav.onStart = () => starts.push('start');
  blocked = false;
  poll();
  assert.deepEqual(starts, [], 'a Start press that paused the game is not read again by the menu');
});

test('left/right adjust a focused slider instead of moving focus', () => {
  const pad = fakePad();
  let time = 0;
  const events = [];
  const slider = {
    type: 'range', value: 1,
    stepUp() { this.value += 0.1; }, stepDown() { this.value -= 0.1; },
    dispatchEvent(event) { events.push(event.type); },
  };
  const other = { type: 'button' };
  let focused = slider;
  const nav = new MenuNav({
    getItems: () => [slider, other], getFocused: () => focused, focus: item => { focused = item; },
    getPads: () => [pad], now: () => time,
  });
  pad.press('RIGHT');
  time += 16;
  nav.poll();
  assert.ok(Math.abs(slider.value - 1.1) < 1e-9);
  assert.deepEqual(events, ['input']);
  assert.equal(focused, slider);
  pad.release('RIGHT');
  time += 16;
  nav.poll();
  pad.press('DOWN');
  time += 16;
  nav.poll();
  assert.equal(focused, other);
});
