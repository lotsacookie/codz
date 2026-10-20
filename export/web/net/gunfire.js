export const GUN_NEAR = 450;
export const GUN_RANGE = 2600;
export const SHOT_MIN_MS = 45;
export const MIN_GAIN = .03;

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const round1 = value => Math.round(value * 10) / 10;

export function packShot(def, position) {
  return { w: String(def.id).slice(0, 40), x: round1(position.x), y: round1(position.y), z: round1(position.z) };
}

export function cleanShot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const weapon = String(raw.w ?? '').replace(/[^a-z0-9_]/gi, '').slice(0, 40);
  if (!weapon) return null;
  const x = finite(raw.x, NaN), y = finite(raw.y, NaN), z = finite(raw.z, NaN);
  if (![x, y, z].every(Number.isFinite) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || Math.abs(z) > 1e6) return null;
  return { weapon, x, y, z };
}

export function shotGain(distance) {
  if (!Number.isFinite(distance) || distance >= GUN_RANGE) return 0;
  if (distance <= GUN_NEAR) return 1;
  const gain = 1 - (distance - GUN_NEAR) / (GUN_RANGE - GUN_NEAR);
  return gain * gain < MIN_GAIN ? 0 : gain * gain;
}

export class ShotLimiter {
  constructor(minMs = SHOT_MIN_MS) { this.minMs = minMs; this.last = -Infinity; }
  allow(t) {
    if (t - this.last < this.minMs) return false;
    this.last = t;
    return true;
  }
}
