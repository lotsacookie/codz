export const ZOMBIE_HZ = 15;
export const MAX_ZOMBIES = 64;
export const MAX_BOARDS = 128;
export const PUPPET_DELAY_MS = 110;
export const PUPPET_TIMEOUT_MS = 4000;
export const KINDS = ['zombie', 'dog', 'nova', 'astronaut'];
export const STATES = ['chase', 'attack', 'barricade', 'entering', 'approach'];
export const MAX_HIT_DAMAGE = 1e6;
export const MAX_PEER_DAMAGE = 500;

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const round1 = value => Math.round(value * 10) / 10;
const round2 = value => Math.round(value * 100) / 100;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => {
  const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * t;
};

export function packZombie(z) {
  const p = z.root.position;
  const max = z.maxHealth || z.health || 1;
  return [
    z.id | 0,
    Math.max(0, KINDS.indexOf(z.kind)),
    round1(p.x), round1(p.y), round1(p.z),
    round2(z.root.rotation.y),
    Math.max(0, STATES.indexOf(z.state)),
    Math.round(255 * clamp(finite(z.health) / max, 0, 1)),
  ];
}

export function packSnapshot({ seq, session, zombies, boards = null }) {
  return {
    q: seq | 0,
    r: finite(session.round) | 0,
    p: (session.corePhase ?? session.phase) === 'preparing' ? 0 : 1,
    t: finite(session.total) | 0,
    s: finite(session.spawned) | 0,
    k: finite(session.killed) | 0,
    c: round1(Math.max(0, finite(session.countdown))),
    d: session.dogRound ? 1 : 0,
    a: String(session.area ?? '').slice(0, 24),
    z: zombies.slice(0, MAX_ZOMBIES).map(packZombie),
    b: boards ? boards.slice(0, MAX_BOARDS).map(n => clamp(finite(n) | 0, 0, 255)) : null,
  };
}

function cleanZombie(raw) {
  if (!Array.isArray(raw) || raw.length < 8) return null;
  const [id, kind, x, y, z, yaw, state, hp] = raw.map(Number);
  if (![id, kind, x, y, z, yaw, state, hp].every(Number.isFinite)) return null;
  if (Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || Math.abs(z) > 1e6) return null;
  return {
    id: id | 0,
    kind: KINDS[kind | 0] ?? 'zombie',
    x, y, z, yaw,
    state: clamp(state | 0, 0, STATES.length - 1),
    hp: clamp(hp, 0, 255) / 255,
  };
}

export function cleanSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.z)) return null;
  const zombies = [];
  for (const entry of raw.z.slice(0, MAX_ZOMBIES)) {
    const zombie = cleanZombie(entry);
    if (zombie) zombies.push(zombie);
  }
  return {
    seq: finite(raw.q) | 0,
    round: clamp(finite(raw.r, 1) | 0, 0, 9999),
    phase: finite(raw.p) === 0 ? 'preparing' : 'fighting',
    total: clamp(finite(raw.t) | 0, 0, 9999),
    spawned: clamp(finite(raw.s) | 0, 0, 9999),
    killed: clamp(finite(raw.k) | 0, 0, 9999),
    countdown: clamp(finite(raw.c), 0, 999),
    dogRound: finite(raw.d) === 1,
    area: String(raw.a ?? '').slice(0, 24),
    zombies,
    boards: Array.isArray(raw.b) ? raw.b.slice(0, MAX_BOARDS).map(n => clamp(finite(n) | 0, 0, 255)) : null,
  };
}

export function cleanHit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.nuke) return { nuke: true };
  const id = Number(raw.i);
  if (!Number.isFinite(id)) return null;
  const damage = clamp(finite(raw.d), 0, MAX_HIT_DAMAGE);
  if (!(damage > 0)) return null;
  return {
    id: id | 0,
    damage,
    head: !!raw.h,
    melee: !!raw.m,
    cause: String(raw.c ?? 'bullet').replace(/[^a-z_]/gi, '').slice(0, 16) || 'bullet',
    score: raw.s !== false && raw.s !== 0,
  };
}

export function packHit(id, { damage, head = false, melee = false, cause = 'bullet', score = true }) {
  return { i: id | 0, d: round1(finite(damage)), h: head ? 1 : 0, m: melee ? 1 : 0, c: String(cause).slice(0, 16), s: score ? 1 : 0 };
}

export function cleanDead(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(Number(raw.i))) return null;
  return { id: Number(raw.i) | 0, cause: String(raw.c ?? 'bullet').replace(/[^a-z_]/gi, '').slice(0, 16) || 'bullet', gas: !!raw.g };
}

export function cleanAward(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return { killed: !!raw.k, head: !!raw.h, melee: !!raw.m };
}

export function cleanHurt(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const amount = clamp(finite(raw.a), 0, MAX_PEER_DAMAGE);
  return amount > 0 ? { amount } : null;
}

export function cleanBoardRequest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const index = Number(raw.i), count = Number(raw.n);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || index >= MAX_BOARDS) return null;
  return { index, count: clamp(count, 0, 255) };
}

export class PuppetTracker {
  constructor({ now = () => performance.now(), delay = PUPPET_DELAY_MS, timeout = PUPPET_TIMEOUT_MS } = {}) {
    this.now = now; this.delay = delay; this.timeout = timeout; this.entries = new Map(); this.lastSeq = -1;
  }

  receive(snapshot, t = this.now()) {
    if (!snapshot) return { gone: [] };
    if (snapshot.seq < this.lastSeq && this.lastSeq - snapshot.seq < 1000) return { gone: [] };
    this.lastSeq = snapshot.seq;
    const present = new Set();
    for (const z of snapshot.zombies) {
      present.add(z.id);
      let entry = this.entries.get(z.id);
      if (!entry) { entry = { id: z.id, samples: [] }; this.entries.set(z.id, entry); }
      entry.kind = z.kind; entry.state = z.state; entry.hp = z.hp; entry.seen = t;
      entry.samples.push({ t, x: z.x, y: z.y, z: z.z, yaw: z.yaw });
      while (entry.samples.length > 10 || (entry.samples.length > 2 && entry.samples[1].t < t - 1500)) entry.samples.shift();
    }
    const gone = [];
    for (const id of [...this.entries.keys()]) if (!present.has(id)) { this.entries.delete(id); gone.push(id); }
    return { gone };
  }

  forget(id) { this.entries.delete(id); }
  clear() { this.entries.clear(); this.lastSeq = -1; }
  ids() { return [...this.entries.keys()]; }
  get(id) { return this.entries.get(id) ?? null; }

  stale(t = this.now()) {
    const out = [];
    for (const entry of this.entries.values()) if (t - entry.seen > this.timeout) out.push(entry.id);
    return out;
  }

  sample(id, t = this.now()) {
    const entry = this.entries.get(id);
    if (!entry || !entry.samples.length) return null;
    const s = entry.samples, at = t - this.delay;
    let a = s[0], b = s[s.length - 1];
    for (let i = s.length - 1; i > 0; i--) if (s[i - 1].t <= at) { a = s[i - 1]; b = s[i]; break; }
    const span = b.t - a.t, k = span > 0 ? clamp((at - a.t) / span, 0, 1) : 1;
    return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), yaw: lerpAngle(a.yaw, b.yaw, k) };
  }
}
