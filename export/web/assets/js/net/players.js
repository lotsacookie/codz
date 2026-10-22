// Remote player state: throttled pose sending and smooth interpolation of what other players send. Pure logic.

export const POSE_HZ = 15;
export const INTERP_DELAY_MS = 120;   // render slightly in the past so there are always two samples to blend
export const POSE_TIMEOUT_MS = 8000;

const finite = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * t; }

/** Clamp an incoming pose. Position is world units, yaw/pitch radians; `a` is a small animation/state flag set. */
export function cleanPose(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pose = { x: finite(raw.x), y: finite(raw.y), z: finite(raw.z), yaw: finite(raw.yaw), pitch: Math.max(-1.6, Math.min(1.6, finite(raw.pitch))), w: String(raw.w ?? '').slice(0, 40), a: finite(raw.a) | 0, hp: Math.max(0, Math.min(1, finite(raw.hp, 1))) };
  return Math.abs(pose.x) > 1e6 || Math.abs(pose.y) > 1e6 || Math.abs(pose.z) > 1e6 ? null : pose;
}

export class PoseSender {
  constructor(channel, { hz = POSE_HZ, now = () => performance.now() } = {}) {
    this.channel = channel; this.interval = 1000 / hz; this.now = now; this.last = -Infinity; this.prev = null;
  }
  /** Call every frame with the local pose; only sends when the interval passed and something changed (or as a keep-alive). */
  update(pose) {
    const t = this.now();
    if (t - this.last < this.interval) return false;
    const moved = !this.prev || ['x', 'y', 'z', 'yaw', 'pitch', 'w', 'a', 'hp'].some(k => this.prev[k] !== pose[k]);
    if (!moved && t - this.last < 1000) return false;
    this.last = t; this.prev = { ...pose };
    this.channel.send('pose', pose);
    return true;
  }
}

export class RemotePlayers {
  constructor({ now = () => performance.now(), delay = INTERP_DELAY_MS, timeout = POSE_TIMEOUT_MS } = {}) {
    this.now = now; this.delay = delay; this.timeout = timeout; this.players = new Map();
  }
  setRoster(roster, selfId) {
    const keep = new Set();
    for (const p of roster) {
      if (p.id === selfId) continue;
      keep.add(p.id);
      const entry = this.players.get(p.id) ?? { id: p.id, samples: [], seen: 0 };
      entry.name = p.name; this.players.set(p.id, entry);
    }
    for (const id of [...this.players.keys()]) if (!keep.has(id)) this.players.delete(id);
  }
  receive(id, raw) {
    const entry = this.players.get(id), pose = cleanPose(raw);
    if (!entry || !pose) return false;
    const t = this.now();
    entry.seen = t; entry.samples.push({ t, pose });
    while (entry.samples.length > 12 || (entry.samples.length > 2 && entry.samples[1].t < t - 1500)) entry.samples.shift();
    return true;
  }
  /** Interpolated pose for each remote player that is still sending. */
  sample() {
    const t = this.now(), at = t - this.delay, out = [];
    for (const entry of this.players.values()) {
      const s = entry.samples;
      if (!s.length || t - entry.seen > this.timeout) continue;
      let a = s[0], b = s[s.length - 1];
      for (let i = s.length - 1; i > 0; i--) if (s[i - 1].t <= at) { a = s[i - 1]; b = s[i]; break; }
      const span = b.t - a.t, k = span > 0 ? Math.max(0, Math.min(1, (at - a.t) / span)) : 1;
      const p = a.pose, q = b.pose;
      out.push({ id: entry.id, name: entry.name, x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k), z: lerp(p.z, q.z, k), yaw: lerpAngle(p.yaw, q.yaw, k), pitch: lerp(p.pitch, q.pitch, k), w: q.w, a: q.a, hp: q.hp });
    }
    return out;
  }
}
