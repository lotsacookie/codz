// Small numeric helpers that used to be re-declared in camera, gamepad, touch, player and viewmodel code.
export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Frame-rate independent exponential smoothing of `current` toward `target`.
export function damp(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt);
}
