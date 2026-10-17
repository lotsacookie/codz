import { Enemies } from './enemies.js';

// Survival enemies use Kino's proven flow (Enemies base: barricade spawns that must path to the player,
// per-round population, auto round advance) plus two safety nets for imperfect navmeshes:
//  - starvation: if nothing could spawn for a while, force a spawn at any barricade;
//  - trail: when pathing fails, follow the player's breadcrumb trail (see player-trail.js).
export class ShangriEnemies extends Enemies {
  constructor(...args) {
    super(...args);
    this.barriers = [];
    this.candidates = [];
    this.starve = 0;
    this.seenSpawned = 0;
    this.trail = null;
    this.fallbackPath = (z, goal) => this.trail?.route(z.root.position, goal, (a, b) => this.world.lineClear(a, b)) ?? [];
  }

  guard(label, fn) {
    try { return fn(); } catch (error) {
      this.faults = (this.faults ?? 0) + 1;
      if (this.faults <= 3) console.error('[enemies] ' + label + ' failed', error);
      this.lastFault = String(error?.message ?? error);
      return undefined;
    }
  }

  purgeBroken() {
    for (const z of [...this.list]) {
      const p = z.root.position;
      if (Number.isFinite(p.x + p.y + p.z)) continue;
      this.remove(z);
      this.session.spawned = Math.max(0, this.session.spawned - 1);
    }
  }

  forceSpawn() {
    const s = this.session, kind = s.dogRound ? 'dog' : 'zombie';
    if (kind === 'zombie' && this.barriers.length) {
      const free = this.barriers.filter(b => !this.list.some(z => z.barrier === b && ['barricade', 'entering'].includes(z.state)));
      const pick = (free.length ? free : this.barriers)[Math.floor(s.random() * (free.length || this.barriers.length))];
      this.spawn(null, pick, kind);
    } else if (this.candidates.length) this.spawn(this.candidates[Math.floor(s.random() * this.candidates.length)].point, null, kind);
    else if (this.barriers.length) this.spawn(this.barriers[0].inside, null, kind);
  }

  update(dt, player) {
    const s = this.session;
    if (s.spawned !== this.seenSpawned) { this.seenSpawned = s.spawned; this.starve = 0; }
    if (s.phase === 'fighting' && s.spawned < s.total && this.list.length < 24) {
      this.starve += dt;
      if (this.starve > 5) { this.starve = 0; this.guard('forced spawn', () => this.forceSpawn()); }
    } else this.starve = 0;
    if (s.dogRound && s.phase === 'fighting' && s.spawned >= s.total && !this.list.length) this.onDrop?.('full_ammo', this.lastDogDeath ?? player);
    this.guard('update', () => super.update(dt, player));
    this.purgeBroken();
  }

  reset() {
    super.reset();
    this.starve = 0;
    this.seenSpawned = 0;
  }
}
