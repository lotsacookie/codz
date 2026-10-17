import * as THREE from 'three';
import { Enemies } from './enemies.js';

const SPAWN_DELAY_FLOOR = .08;
const LIFT = new THREE.Vector3(0, 30, 0);
const FALLBACK_BUDGET_MS = 2;
const TRAIL_CANDIDATES = 16;
const HITCH_MS = 40;

// Survival enemies use Kino's proven flow (Enemies base: barricade spawns, per-round population, auto round advance)
// with the spawn decision made from a preflight instead of at the moment the round starts:
//  - only barricades that navigation already verified can reach the player's spawn are used, and the chosen one is
//    re-checked with a single query, so a bad navmesh is never discovered by a zombie that then has nowhere to go;
//  - starvation: if nothing could spawn for a while, force a spawn at a verified barricade (any as a last resort);
//  - routes: baked navmesh first, then the automatically mapped graph, then the player's breadcrumb trail, then a
//    straight line when it is clear. Every one of the fallbacks is wall-checked (see Enemies.update stepClear).
// Crash protection (spawn/update faults) is applied by guardEnemies() in MoonCombat.
export class ShangriEnemies extends Enemies {
  constructor(...args) {
    super(...args);
    this.autoSpawn = false;
    this.barriers = [];
    this.candidates = [];
    this.starve = 0;
    this.seenSpawned = 0;
    this.trail = null;
    this.spent = 0;
    this.lastHitchLog = -Infinity;
    this.fallbackPath = (z, goal) => this.fallbackRoute(z, goal);
  }

  arrives(route, goal) { return route?.length > 1 && route.at(-1).distanceTo(goal) < 90; }

  fallbackRoute(z, goal) {
    if (this.spent > FALLBACK_BUDGET_MS) { z.repath = .08 + (z.id % 5) * .03; return []; }
    const began = performance.now();
    const route = this.findFallback(z, goal);
    this.spent += performance.now() - began;
    if (!route.length) z.repath = 1 + (z.id % 5) * .1;
    return route;
  }

  findFallback(z, goal) {
    const from = z.root.position, nav = this.world.navigation;
    const auto = nav?.autoPath?.(from, goal);
    if (this.arrives(auto, goal)) return auto;
    const crumbs = this.trail?.route(from, goal, (a, b) => this.world.lineClear(a, b), TRAIL_CANDIDATES);
    if (crumbs?.length) return crumbs;
    if (this.world.lineClear(from.clone().add(LIFT), goal.clone().add(LIFT))) return [goal.clone()];
    return [];
  }

  pool() {
    const nav = this.world.navigation;
    return nav?.viable ? nav.viable(this.barriers) : this.barriers;
  }

  isFree(b) { return !this.list.some(z => z.barrier === b && ['barricade', 'entering'].includes(z.state)); }

  spawnStep(dt, player) {
    const s = this.session;
    if (s.phase !== 'fighting' || s.spawned >= s.total || this.list.length >= 24) return;
    this.nextSpawn -= dt;
    if (this.nextSpawn > 0) return;
    const nav = this.world.navigation, kind = s.dogRound ? 'dog' : 'zombie';
    const free = this.pool().filter(b => this.isFree(b));
    for (let tries = 0; tries < 4 && free.length; tries++) {
      const b = free.splice(Math.floor(s.random() * free.length), 1)[0];
      if (nav?.canReach && !nav.canReach(b.inside, player)) continue;
      if (kind === 'dog') this.spawn(b.inside, null, 'dog'); else this.spawn(null, b, 'zombie');
      this.nextSpawn = Math.max(SPAWN_DELAY_FLOOR, (this.data.rules.zombie_spawn_delay ?? 2) * Math.pow(.95, s.round - 1));
      return;
    }
    this.nextSpawn = 1;
  }

  forceSpawn() {
    const s = this.session, kind = s.dogRound ? 'dog' : 'zombie';
    const verified = this.pool();
    const barriers = verified.length ? verified : this.barriers;
    if (kind === 'zombie' && barriers.length) {
      const free = barriers.filter(b => this.isFree(b));
      const list = free.length ? free : barriers;
      this.spawn(null, list[Math.floor(s.random() * list.length)], kind);
    } else if (barriers.length) this.spawn(barriers[Math.floor(s.random() * barriers.length)].inside, null, kind);
    else if (this.candidates.length) this.spawn(this.candidates[Math.floor(s.random() * this.candidates.length)].point, null, kind);
  }

  update(dt, player) {
    const began = performance.now();
    this.step(dt, player);
    const took = performance.now() - began;
    if (took > HITCH_MS && began - this.lastHitchLog > 1000) {
      this.lastHitchLog = began;
      console.warn('[perf] enemy update hitch', JSON.stringify({ ms: Math.round(took), zombies: this.list.length, fallbackMs: Math.round(this.spent * 10) / 10, ...this.world.navigation?.perfSnapshot?.() }));
    }
  }

  step(dt, player) {
    const s = this.session;
    this.spent = 0;
    if (s.spawned !== this.seenSpawned) { this.seenSpawned = s.spawned; this.starve = 0; }
    if (s.phase === 'fighting' && s.spawned < s.total && this.list.length < 24) {
      this.starve += dt;
      if (this.starve > 5) { this.starve = 0; this.forceSpawn(); }
    } else this.starve = 0;
    this.spawnStep(dt, player);
    if (s.dogRound && s.phase === 'fighting' && s.spawned >= s.total && !this.list.length) this.onDrop?.('full_ammo', this.lastDogDeath ?? player);
    super.update(dt, player);
  }

  reset() {
    super.reset();
    this.starve = 0;
    this.seenSpawned = 0;
  }
}
