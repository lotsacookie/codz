// Console controller support, laid out like the Black Ops (T5) default scheme.
//
//   Left stick  Move                 Right stick  Look
//   L3          Sprint               R3           Knife
//   RT          Fire                 LT           Aim down sights
//   A           Jump                 B            Crouch (tap to toggle)
//   X           Use / Reload         Y            Switch weapon
//   LB          Grenade              RB           Monkey Bomb / Gersh / QED
//   D-pad up    Alt fire / attachment    D-pad down   Claymore / P.E.S. suit
//   Back        Objective            Start        Pause
//
// "Use / Reload" is context sensitive, as in the console game: X uses whatever
// is in reach and reloads otherwise. Each map resolves that through the
// `usereload` action because only the map knows whether a prompt is in range.
//
// The browser's "standard" Gamepad mapping puts these buttons at the same
// indices on Xbox, PlayStation and Switch Pro pads (A/Cross, B/Circle, ...).

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const BUTTON = Object.freeze({
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
});
const BUTTON_COUNT = 16;

export const MOVE_DEADZONE = 0.2;
export const LOOK_DEADZONE = 0.15;
// Pixels per second at full deflection, in the same units a touch drag or a
// mouse delta uses. The maps turn 0.005 rad per unit, so 1.0 sensitivity is
// about 160 degrees per second, before the maps halve it while aiming.
export const LOOK_SPEED = 560;
const LOOK_CURVE = 1.6;

export const PAD_CONTROLS = [
  'CONTROLLER',
  'Left stick · Move   L3 · Sprint   Right stick · Look   R3 · Knife',
  'RT · Fire   LT · Aim   A · Jump   B · Crouch',
  'X · Use / Reload (hold to repair)   Y · Switch weapon',
  'LB · Grenade   RB · Monkey Bomb / Gersh / QED',
  'D-pad up · Alt fire / attachment   D-pad down · Claymore / P.E.S.',
  'Back · Objective (Moon)   Start · Pause',
].join('\n');

const SENSITIVITY_KEY = 'zombies.padSensitivity';

function readSensitivity() {
  try {
    const value = Number(globalThis.localStorage?.getItem(SENSITIVITY_KEY));
    if (value > 0) return clamp(value, 0.4, 2);
  } catch { /* Storage is optional in private browsing and embedded games. */ }
  return 1;
}

// Shared by the game input, the pause-menu slider and the explorer maps.
export const padSettings = {
  sensitivity: readSensitivity(),
  set(value) {
    if (!Number.isFinite(Number(value))) return;
    this.sensitivity = clamp(Number(value), 0.4, 2);
    try { globalThis.localStorage?.setItem(SENSITIVITY_KEY, String(this.sensitivity)); } catch {}
  },
};

export function getGamepads() {
  try {
    return [...(globalThis.navigator?.getGamepads?.() ?? [])].filter(pad => pad?.connected);
  } catch {
    return [];
  }
}

// Radial dead zone: direction is kept, magnitude is rescaled so the stick
// leaves zero smoothly instead of jumping to the dead-zone radius.
export function stick(x, y, deadzone, curve = 1) {
  const length = Math.hypot(x, y);
  if (!(length > deadzone)) return { x: 0, y: 0, magnitude: 0 };
  const magnitude = clamp((length - deadzone) / (1 - deadzone), 0, 1) ** curve;
  return { x: x / length * magnitude, y: y / length * magnitude, magnitude };
}

// Triggers are analogue; a half pull is a deliberate press, a graze is not.
const isDown = (button, threshold = 0.5) => !!button && (button.pressed || button.value > threshold);

function hasInput(pad) {
  return (pad.buttons ?? []).some(button => button?.pressed)
    || (pad.axes ?? []).some(value => Math.abs(value) > 0.5);
}

// Prefer the pad already in use, but follow the player to another one the
// moment it is touched. Many systems also list virtual HID devices as pads.
export function pickPad(pads, index) {
  const usable = pads.filter(pad => pad?.connected && pad.axes?.length >= 4 && pad.buttons?.length >= 10);
  if (!usable.length) return null;
  const busy = usable.find(pad => pad.index !== index && hasInput(pad));
  return busy ?? usable.find(pad => pad.index === index)
    ?? usable.find(pad => pad.mapping === 'standard') ?? usable[0];
}

const neutral = () => ({
  forward: 0, strafe: 0, sprint: false, crouch: false, aim: false, fire: false,
  firePressed: false, jump: false, use: false, hack: false, jumpHeld: false, crouchHeld: false,
});

// Combine touch/pad reads into the one object every map already consumes.
export function mergeInput(touch, pad) {
  const sum = (a, b) => clamp(a + b, -1, 1);
  return {
    ...touch,
    forward: sum(touch.forward, pad.forward), strafe: sum(touch.strafe, pad.strafe),
    sprint: touch.sprint || pad.sprint, crouch: touch.crouch || pad.crouch, aim: touch.aim || pad.aim,
    fire: touch.fire || pad.fire, firePressed: touch.firePressed || pad.firePressed,
    jump: touch.jump || pad.jump, use: touch.use || pad.use, hack: touch.hack || pad.hack,
  };
}

// Gameplay input. `read()` is polled once per frame by the map and returns the
// same fields as TouchInput.read(). Discrete buttons call `onAction` with the
// same action names the touch buttons use; the right stick calls `onLook`.
export class GamepadInput {
  constructor({
    onLook = () => {}, onAction = () => {}, onPause = () => {},
    getPads = getGamepads, now = () => performance.now(),
  } = {}) {
    this.onLook = onLook;
    this.onAction = onAction;
    this.onPause = onPause;
    this.getPads = getPads;
    this.now = now;
    this.prev = new Array(BUTTON_COUNT).fill(false);
    this.index = null;
    this.connected = false;
    // Gameplay input is `enabled`; Start can pause whenever the game is `visible`
    // (a downed player cannot act, but can still pause).
    this.enabled = false;
    this.visible = false;
    // True while the pad is the most recently used device (drives on-screen labels).
    this.active = false;
    this.last = now();
    this.detach = () => {};
    this.reset();
  }

  reset() {
    this.sprinting = false;
    this.crouch = false;
  }

  setEnabled(enabled, visible = enabled) {
    enabled = !!enabled;
    visible = !!visible;
    if (this.enabled && !enabled) this.reset();
    this.enabled = enabled;
    this.visible = visible;
  }

  // Keyboard and mouse take the labels back as soon as they are used.
  attach(target = globalThis) {
    this.detach();
    const device = event => {
      if (event.type === 'mousemove' && !event.movementX && !event.movementY) return;
      this.active = false;
    };
    const types = ['keydown', 'mousedown', 'pointerdown', 'mousemove'];
    for (const type of types) target.addEventListener(type, device, { capture: true, passive: true });
    this.detach = () => {
      for (const type of types) target.removeEventListener(type, device, { capture: true });
      this.detach = () => {};
    };
    return this.detach;
  }

  read() {
    const t = this.now();
    const dt = clamp((t - this.last) / 1000, 0, 0.1);
    this.last = t;
    const out = neutral();
    const pad = pickPad(this.getPads(), this.index);
    if (!pad) {
      this.connected = false;
      this.prev.fill(false);
      this.reset();
      return out;
    }
    this.connected = true;
    this.index = pad.index;

    const down = Array.from({ length: BUTTON_COUNT }, (_, i) =>
      isDown(pad.buttons?.[i], i === BUTTON.LT || i === BUTTON.RT ? 0.35 : 0.5));
    const edges = down.map((value, i) => value && !this.prev[i]);
    this.prev = down;
    const axis = i => Number(pad.axes?.[i]) || 0;
    const move = stick(axis(0), axis(1), MOVE_DEADZONE);
    const look = stick(axis(2), axis(3), LOOK_DEADZONE, LOOK_CURVE);
    if (down.some(Boolean) || move.magnitude || look.magnitude) this.active = true;

    // Previous states are tracked even while idle, so a button held across
    // pause/resume never registers as a fresh press.
    if (!this.visible) { this.reset(); return out; }
    if (edges[BUTTON.START]) { this.reset(); this.onPause(); return out; }
    if (!this.enabled) { this.reset(); return out; }

    const forward = move.y ? -move.y : 0;  // stick up is negative; avoid reporting -0
    const fire = down[BUTTON.RT];
    const aim = down[BUTTON.LT];

    // A stands up from a crouch instead of jumping, as in the console game.
    if (edges[BUTTON.A]) {
      if (this.crouch) this.crouch = false;
      else out.jump = true;
    }
    if (edges[BUTTON.B]) {
      this.crouch = !this.crouch;
      if (this.crouch) this.sprinting = false;
    }
    // Click L3 while moving forward to sprint. Sprint ends when forward
    // movement stops, or when you aim or fire.
    if (edges[BUTTON.LS]) {
      if (this.sprinting) this.sprinting = false;
      else if (forward > 0.3) { this.sprinting = true; this.crouch = false; }
    }
    if (forward < 0.2 || fire || aim) this.sprinting = false;

    if (edges[BUTTON.X]) this.onAction('usereload');
    if (edges[BUTTON.Y]) this.onAction('weapon');
    if (edges[BUTTON.LB]) this.onAction('grenade');
    if (edges[BUTTON.RB]) this.onAction('equipment');
    if (edges[BUTTON.RS]) this.onAction('melee');
    if (edges[BUTTON.UP]) this.onAction('attachment');
    if (edges[BUTTON.DOWN]) { this.onAction('claymore'); this.onAction('suit'); }
    if (edges[BUTTON.BACK]) this.onAction('journal');

    if (look.magnitude) this.onLook(look.x * LOOK_SPEED * dt, look.y * LOOK_SPEED * dt);

    out.forward = forward;
    out.strafe = move.x;
    out.sprint = this.sprinting && !this.crouch;
    out.crouch = this.crouch;
    out.aim = aim;
    out.fire = fire;
    out.firePressed = edges[BUTTON.RT];
    out.use = out.hack = down[BUTTON.X];
    out.jumpHeld = down[BUTTON.A];
    out.crouchHeld = down[BUTTON.B];
    return out;
  }

  getState() {
    return {
      connected: this.connected, active: this.active, enabled: this.enabled,
      sprinting: this.sprinting, crouch: this.crouch, sensitivity: padSettings.sensitivity,
    };
  }
}

// Menu navigation for the launcher, loading screen and pause menu. The shell
// supplies what is focusable and what each button does; this class only turns
// pad input into moves, selects and backs, with key-style repeat.
export class MenuNav {
  constructor({
    getItems, getFocused = () => globalThis.document?.activeElement, focus, getDefault = items => items[0],
    onSelect = () => {}, onBack = () => {}, onStart = () => {},
    isBlocked = () => false, getPads = getGamepads, now = () => performance.now(),
    repeat = { first: 380, next: 110 },
  }) {
    Object.assign(this, { getItems, getFocused, focus, getDefault, onSelect, onBack, onStart, isBlocked, getPads, now, repeat });
    this.prev = new Array(BUTTON_COUNT).fill(false);
    this.index = null;
    this.seen = false;
    this.held = null;
    this.nextAt = 0;
  }

  poll() {
    const pad = pickPad(this.getPads(), this.index);
    if (!pad) { this.prev.fill(false); this.held = null; return; }
    this.index = pad.index;
    this.seen = true;
    const down = Array.from({ length: BUTTON_COUNT }, (_, i) =>
      isDown(pad.buttons?.[i], i === BUTTON.LT || i === BUTTON.RT ? 0.35 : 0.5));
    const edges = down.map((value, i) => value && !this.prev[i]);
    this.prev = down;
    // While the game itself is running, only keep the previous state fresh so
    // that Start (which pauses it) is not read again as a menu press.
    if (this.isBlocked()) { this.held = null; return; }

    const ax = Number(pad.axes?.[0]) || 0;
    const ay = Number(pad.axes?.[1]) || 0;
    const dx = down[BUTTON.RIGHT] || ax > 0.6 ? 1 : down[BUTTON.LEFT] || ax < -0.6 ? -1 : 0;
    const dy = down[BUTTON.DOWN] || ay > 0.6 ? 1 : down[BUTTON.UP] || ay < -0.6 ? -1 : 0;
    const direction = dx || dy ? `${dx},${dy}` : null;
    const t = this.now();
    if (direction !== this.held) {
      this.held = direction;
      this.nextAt = t + this.repeat.first;
      if (direction) this.move(dx, dy);
    } else if (direction && t >= this.nextAt) {
      this.nextAt = t + this.repeat.next;
      this.move(dx, dy);
    }

    if (edges[BUTTON.A]) this.onSelect(this.focused());
    if (edges[BUTTON.B]) this.onBack();
    if (edges[BUTTON.START]) this.onStart();
  }

  focused() {
    const current = this.getFocused();
    return this.getItems().includes(current) ? current : null;
  }

  move(dx, dy) {
    const items = this.getItems();
    if (!items.length) return;
    const current = items.indexOf(this.getFocused());
    // Left/right adjust a slider that has focus; everywhere else they step
    // through the list just like up/down.
    const slider = current >= 0 && items[current].type === 'range' ? items[current] : null;
    if (slider && dx) {
      if (dx > 0) slider.stepUp(); else slider.stepDown();
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const step = dy || dx;
    // The first move only reveals the focus, it does not skip an item.
    this.focus(current < 0 ? this.getDefault(items) ?? items[0] : items[(current + step + items.length) % items.length]);
  }
}
