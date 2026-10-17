import * as THREE from 'three';
import { ShangriSession } from './shangri-la-session.js';
import { ShangriFeatures } from './shangri-la-features.js';
import { SurvivalNavigation } from './shangri-la-navigation.js';
import { ROOM, OBSTACLES, PATH_POINTS, OUTSIDE, SPAWN, REPAIR_POINT } from './one-window-challenge-world.js';

const LINK_RANGE = 150;
const CLEARANCE = 24;
const WALK_MARGIN = 14;
const PUSH_MARGIN = 16;

export class OneWindowSession extends ShangriSession {
  reset() {
    super.reset();
    this.power = true;
  }
}

export class OneWindowFeatures extends ShangriFeatures {
  async load() {
    await super.load();
    for (const barrier of this.barriers) barrier.position.set(...REPAIR_POINT);
  }
}

const blocked = (ax, az, bx, bz, box, margin) => {
  const minX = box.min[0] - margin, maxX = box.max[0] + margin, minZ = box.min[2] - margin, maxZ = box.max[2] + margin;
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, minX, maxX], [az, dz, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      let near = (lo - p) / d, far = (hi - p) / d;
      if (near > far) [near, far] = [far, near];
      t0 = Math.max(t0, near);
      t1 = Math.min(t1, far);
      if (t0 > t1) return false;
    }
  }
  return true;
};

export class PathPointNavigation extends SurvivalNavigation {
  constructor(base) {
    super(base);
    this.nodes = PATH_POINTS.map(p => new THREE.Vector3(...p));
    this.links = this.nodes.map((a, i) => this.nodes.reduce((list, b, j) => {
      if (i !== j && Math.hypot(a.x - b.x, a.z - b.z) <= LINK_RANGE && this.clear(a, b)) list.push(j);
      return list;
    }, []));
  }

  async load() {
    this.baked = false;
    this.metadata = { candidates: [{ kind: 'spawn', position: OUTSIDE }], start: SPAWN.position };
  }

  clear(a, b) {
    for (const box of OBSTACLES) if (blocked(a.x, a.z, b.x, b.z, box, CLEARANCE)) return false;
    return true;
  }

  nearest(p) {
    let best = -1, bestVisible = -1, distance = Infinity, visibleDistance = Infinity;
    this.nodes.forEach((node, i) => {
      const d = Math.hypot(node.x - p.x, node.z - p.z);
      if (d < distance) { distance = d; best = i; }
      if (d < visibleDistance && this.clear(p, node)) { visibleDistance = d; bestVisible = i; }
    });
    return bestVisible >= 0 ? bestVisible : best;
  }

  route(a, b) {
    const start = this.nearest(a), goal = this.nearest(b);
    const cost = new Array(this.nodes.length).fill(Infinity), previous = new Array(this.nodes.length).fill(-1), open = new Set([start]);
    cost[start] = 0;
    while (open.size) {
      let current = -1;
      for (const i of open) if (current < 0 || cost[i] + this.heuristic(i, goal) < cost[current] + this.heuristic(current, goal)) current = i;
      if (current === goal) break;
      open.delete(current);
      for (const next of this.links[current]) {
        const step = cost[current] + this.nodes[current].distanceTo(this.nodes[next]);
        if (step < cost[next]) { cost[next] = step; previous[next] = current; open.add(next); }
      }
    }
    const chain = [];
    for (let i = goal; i >= 0; i = previous[i]) { chain.unshift(this.nodes[i]); if (i === start) break; }
    const points = [a.clone(), ...chain.map(n => n.clone()), b.clone()];
    const pulled = [points[0]];
    for (let i = 0; i < points.length - 1;) {
      let j = points.length - 1;
      while (j > i + 1 && !this.clear(points[i], points[j])) j--;
      pulled.push(points[j]);
      i = j;
    }
    return pulled;
  }

  heuristic(i, goal) { return this.nodes[i].distanceTo(this.nodes[goal]); }

  path(a, b) { return this.route(a, b); }

  rawPath(a, b) { return this.route(a, b); }

  autoPath(a, b) { return this.route(a, b); }

  canReach() { return true; }

  viable(barriers) { return barriers; }

  stepClear(a, b) { return this.clear(a, b); }

  closest(p) {
    const out = new THREE.Vector3(
      THREE.MathUtils.clamp(p.x, ROOM.minX + WALK_MARGIN, ROOM.maxX - WALK_MARGIN),
      0,
      THREE.MathUtils.clamp(p.z, ROOM.minZ + WALK_MARGIN, ROOM.maxZ - WALK_MARGIN),
    );
    for (const box of OBSTACLES) {
      const minX = box.min[0] - PUSH_MARGIN, maxX = box.max[0] + PUSH_MARGIN, minZ = box.min[2] - PUSH_MARGIN, maxZ = box.max[2] + PUSH_MARGIN;
      if (out.x <= minX || out.x >= maxX || out.z <= minZ || out.z >= maxZ) continue;
      const pushes = [[out.x - minX, 'x', minX], [maxX - out.x, 'x', maxX], [out.z - minZ, 'z', minZ], [maxZ - out.z, 'z', maxZ]]
        .filter(([, axis, value]) => axis === 'x' ? value >= ROOM.minX + WALK_MARGIN && value <= ROOM.maxX - WALK_MARGIN : value >= ROOM.minZ + WALK_MARGIN && value <= ROOM.maxZ - WALK_MARGIN)
        .sort((m, n) => m[0] - n[0]);
      if (pushes.length) out[pushes[0][1]] = pushes[0][2];
    }
    return out;
  }

  attach(world, { start, barriers = [], candidates = [], onChange } = {}) {
    this.world = world;
    this.start = start instanceof THREE.Vector3 ? start.clone() : new THREE.Vector3(...start);
    this.barriers = barriers;
    this.candidates = candidates;
    this.onChange = onChange;
  }

  async prepare() {
    this.reachableIds = new Set(this.barriers.map(b => b.id));
    this.version++;
    this.health = {
      baked: false, mapped: true, pathPoints: this.nodes.length, links: this.links.reduce((sum, l) => sum + l.length, 0) / 2,
      barriers: this.barriers.length, reachable: this.reachableIds.size, unreachable: 0, ms: 0,
    };
    this.onChange?.(this.health);
    return this.health;
  }

  setBlockers() {}

  queueRefresh() {}
}
