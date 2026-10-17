const TAU = Math.PI * 2;
export function shortestAngle(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return d;
}
export function turnToward(current, target, dt, { rate = 10, maxSpeed = Math.PI * 2.4 } = {}) {
  const diff = shortestAngle(current, target);
  const eased = diff * (1 - Math.exp(-rate * dt));
  const cap = maxSpeed * dt;
  return current + Math.max(-cap, Math.min(cap, eased));
}

export function damp(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt);
}

export function steerDirection(current, desired, dt, rate = 8) {
  const k = Number.isFinite(rate) ? 1 - Math.exp(-rate * dt) : 1;
  current.x += (desired.x - current.x) * k;
  current.y += (desired.y - current.y) * k;
  current.z += (desired.z - current.z) * k;
  const horizontal = Math.hypot(current.x, current.z);
  if (horizontal > .2) { current.x /= horizontal; current.y /= horizontal; current.z /= horizontal; }
  else { current.x = desired.x; current.y = desired.y; current.z = desired.z; }
  current.y = Math.max(-2, Math.min(2, current.y));
  return current;
}

export function smoothingEnabled(search = globalThis.location?.search ?? '') {
  return !/[?&]smooth=0\b/.test(search);
}
