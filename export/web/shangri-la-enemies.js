import * as THREE from 'three';
import { Enemies } from './enemies.js';

const EYE = new THREE.Vector3(0, 45, 0);

export class ShangriEnemies extends Enemies {
  constructor(...args) {
    super(...args);
    this.autoSpawn = false;
    this.autoRounds = false;
    this.spawnDelay = 2;
    this.spawnFailures = 0;
    this.barriers = [];
    this.candidates = [];
  }

  reachable(from, player) {
    const path = this.world.path(from, player);
    return path.length > 1 && path.at(-1).distanceTo(player) < 70;
  }

  trySpawn(player, kind) {
    const s = this.session;
    const relaxed = this.spawnFailures >= 5, near = relaxed ? 110 : 180, far = relaxed ? Infinity : 1900;
    if (kind === 'zombie' && this.barriers.length) {
      const viable = this.barriers.filter(b => {
        const d = b.inside.distanceTo(player);
        if (d < near || d > far || this.list.some(z => z.barrier === b && ['barricade', 'entering'].includes(z.state))) return false;
        return this.reachable(b.inside, player);
      });
      if (viable.length) {
        this.spawn(null, viable[Math.floor(s.random() * viable.length)], kind);
        this.spawnFailures = 0;
        return true;
      }
    }
    const pool = this.candidates.filter(c => {
      const d = c.point.distanceTo(player);
      return d > near && d < far;
    });
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < Math.min(32, pool.length); i++) {
        const c = pool[Math.floor(s.random() * pool.length)];
        if (pass === 0 && this.world.lineClear(player.clone().add(EYE), c.point.clone().add(EYE))) continue;
        if (this.list.some(z => z.root.position.distanceTo(c.point) < 42)) continue;
        if (!this.reachable(c.point, player)) continue;
        this.spawn(c.point, null, kind);
        this.spawnFailures = 0;
        return true;
      }
    }
    this.spawnFailures++;
    return false;
  }

  // A spawn or a per-frame update that throws would otherwise stop the whole game loop the moment a
  // round starts. Contain it: back off, count it, and remove any actor left with a broken position.
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

  update(dt, player) {
    const s = this.session;
    this.spawnDelay -= dt;
    if (s.phase === 'fighting' && this.list.length < (s.dogRound ? 8 : 24) && s.spawned < s.total && this.spawnDelay <= 0) {
      const spawned = this.guard('spawn', () => this.trySpawn(player, s.dogRound ? 'dog' : 'zombie'));
      this.spawnDelay = spawned ? (s.dogRound ? 1.6 : Math.max(.4, 2 * Math.pow(.95, s.round - 1))) : spawned === undefined ? 2 : .8;
    }
    this.guard('update', () => super.update(dt, player));
    this.purgeBroken();
    if (s.phase === 'fighting' && s.spawned >= s.total && !this.list.length) {
      if (s.dogRound && this.lastDogDeath) this.onDrop?.('full_ammo', this.lastDogDeath);
      s.nextRound();
      this.spawnDelay = 1;
      this.lastDogDeath = null;
    }
  }

  reset() {
    super.reset();
    this.spawnDelay = 2;
    this.spawnFailures = 0;
  }
}
