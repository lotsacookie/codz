// Co-op game logic shared by every map: player colors, nearest-target selection and the live scoreboard. Pure logic.

/** Tab colors, one per slot in the roster (host first). Index wraps if a room ever exceeds the palette. */
export const PLAYER_COLORS = ['#e6e600', '#38c8ff', '#5be34d', '#ff8c1a'];
export const PLAYER_COLOR_HEX = [0xe6e600, 0x38c8ff, 0x5be34d, 0xff8c1a];

export const colorIndexFor = (roster, id) => {
  const index = (roster ?? []).findIndex(p => p.id === id);
  return (index < 0 ? 0 : index) % PLAYER_COLORS.length;
};
export const colorFor = (roster, id) => PLAYER_COLORS[colorIndexFor(roster, id)];

/**
 * The closest of the candidate points to `from` (plain {x,y,z} objects or THREE.Vector3). Returns `fallback` when the
 * list is empty or nothing is closer than it, so zombies keep chasing the local player unless someone else is nearer.
 */
export function nearestTarget(from, candidates, fallback) {
  let best = fallback, bestSq = fallback ? sq(from, fallback) : Infinity;
  for (const c of candidates ?? []) {
    const d = sq(from, c);
    if (d < bestSq) { bestSq = d; best = c; }
  }
  return best;
}
const sq = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

const cleanPoints = value => { const n = Math.trunc(Number(value)); return Number.isFinite(n) ? Math.max(-1e9, Math.min(1e9, n)) : 0; };

/** Clamp an incoming score update. */
export function cleanScore(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return { points: cleanPoints(raw.points), delta: cleanPoints(raw.delta) };
}

/**
 * Everyone's points, live. `setLocal` is called every frame with the local total and reports a change worth sending;
 * remote totals arrive through `receive`. Each change carries the signed delta so the HUD can pop "+60".
 */
export class Scoreboard {
  constructor(roster = [], selfId = null) { this.entries = new Map(); this.selfId = selfId; this.listeners = new Set(); this.setRoster(roster, selfId); }
  onPopup(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  setRoster(roster, selfId = this.selfId) {
    this.selfId = selfId; this.roster = roster ?? [];
    const keep = new Set();
    this.roster.forEach((p, i) => {
      keep.add(p.id);
      const entry = this.entries.get(p.id) ?? { id: p.id, points: 500, name: '' };
      entry.name = p.name; entry.color = PLAYER_COLORS[i % PLAYER_COLORS.length]; entry.self = p.id === selfId;
      this.entries.set(p.id, entry);
    });
    for (const id of [...this.entries.keys()]) if (!keep.has(id)) this.entries.delete(id);
  }
  /** Returns the message to broadcast, or null if nothing changed. */
  setLocal(points) {
    const entry = this.entries.get(this.selfId);
    if (!entry || entry.points === points) return null;
    const delta = points - entry.points;
    entry.points = points;
    return { points, delta };
  }
  receive(id, raw) {
    const entry = this.entries.get(id), score = cleanScore(raw);
    if (!entry || !score || entry.self) return false;
    entry.points = score.points;
    if (score.delta) for (const fn of this.listeners) fn(entry, score.delta);
    return true;
  }
  list() { return [...this.entries.values()]; }
}
