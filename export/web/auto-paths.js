import * as THREE from 'three';

// Automatic wall-safe path graph.
//
// The baked navigation mesh only covers the areas it was baked for and can be fragmented or missing. Instead of
// finding that out when the first zombie of a round fails to reach the player, this module maps the level itself:
// it flood-fills outward from a known walkable point over a coarse grid, and a cell is only connected to its neighbour
// when real collision queries say a body can walk between them (floor continuous, slope walkable, headroom, no wall
// at knee or chest height). Every edge was therefore checked against the walls and the closed doors, and routes made
// of those edges can not pass through them. Rays go through `world.raycast`, which includes runtime door colliders.
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
const nextFrame = () => new Promise(resolve => {
  if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && !document.hidden) requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 0);
});
const _origin = new THREE.Vector3(), _dir = new THREE.Vector3(), _side = new THREE.Vector3(), _normal = new THREE.Vector3();
const _ray = new THREE.Ray();

export class AutoPaths {
  constructor(world, options = {}) {
    this.world = world;
    this.opt = { cell: 88, maxNodes: 9000, stepUp: 20, drop: 64, knee: 22, chest: 42, radius: 12, minNormalY: .55, headroom: 56, budgetMs: 3500, fields: 4, straight: .98, ...options };
    this.reset();
  }

  reset() {
    this.nodes = [];       // THREE.Vector3 per node
    this.adj = [];         // neighbour indices per node
    this.grid = new Map(); // "ix,iz" -> node indices (several floors can share a column)
    this.built = false;
    this.fields = [];
    this.rays = 0;
    this.stats = { nodes: 0, edges: 0, ms: 0, workMs: 0, rays: 0, truncated: false };
  }

  hit(origin, direction, far) {
    if (far <= 0) return false;
    this.rays++;
    _ray.origin.copy(origin);
    _ray.direction.copy(direction);
    return this.world.raycast(_ray, 0, far);
  }

  // Floor below (x, y, z), or null if there is none within climb/drop range, it is too steep, or there is no headroom.
  ground(x, y, z) {
    const { stepUp, drop, minNormalY, headroom } = this.opt;
    _origin.set(x, y + stepUp, z);
    const down = this.hit(_origin, _dir.set(0, -1, 0), stepUp + drop);
    if (!down) return null;
    if (down.triangle?.getNormal) { down.triangle.getNormal(_normal); if (Math.abs(_normal.y) < minNormalY) return null; }
    const point = new THREE.Vector3(x, _origin.y - down.distance, z);
    _origin.set(x, point.y + 2, z);
    if (this.hit(_origin, _dir.set(0, 1, 0), headroom)) return null;
    return point;
  }

  // Can a body walk the straight line a -> b? Knee and chest rays (plus side rays for body width) must not hit a wall
  // and the floor under the line must stay continuous.
  walkable(a, b) {
    const { knee, chest, radius, stepUp } = this.opt;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, length = Math.hypot(dx, dy, dz);
    if (length < .01) return true;
    _dir.set(dx / length, dy / length, dz / length);
    const flat = Math.hypot(dx, dz) || 1;
    _side.set(-dz / flat * radius, 0, dx / flat * radius);
    const dir = _dir.clone(), side = _side.clone();
    for (const h of [knee, chest]) {
      if (this.hit(_origin.set(a.x, a.y + h, a.z), dir, length)) return false;
      if (h === knee) {
        if (this.hit(_origin.set(a.x + side.x, a.y + h, a.z + side.z), dir, length)) return false;
        if (this.hit(_origin.set(a.x - side.x, a.y + h, a.z - side.z), dir, length)) return false;
      }
    }
    const probes = Math.max(1, Math.floor(flat / 36));
    for (let i = 1; i <= probes; i++) {
      const t = i / (probes + 1), x = a.x + dx * t, z = a.z + dz * t, expected = a.y + dy * t;
      const floor = this.ground(x, expected, z);
      if (!floor || Math.abs(floor.y - expected) > stepUp + 4) return false;
    }
    return true;
  }

  // Wall check for a single movement step, used while following a path.
  stepClear(a, b) {
    const { knee, chest } = this.opt;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, length = Math.hypot(dx, dy, dz);
    if (length < .01) return true;
    const dir = _dir.set(dx / length, dy / length, dz / length).clone();
    for (const h of [knee, chest]) if (this.hit(_origin.set(a.x, a.y + h, a.z), dir, length + 6)) return false;
    return true;
  }

  async build(start, { budgetMs = this.opt.budgetMs, onProgress, sliceMs = 8, background = false } = {}) {
    const began = performance.now(), { cell, maxNodes } = this.opt;
    const pause = background ? nextFrame : yieldTask;
    this.reset();
    const origin = new THREE.Vector3(start.x, start.y, start.z);
    const first = this.ground(origin.x, origin.y + 8, origin.z) ?? origin.clone();
    const key = (ix, iz) => ix + ',' + iz;
    const cellOf = v => [Math.round((v.x - origin.x) / cell), Math.round((v.z - origin.z) / cell)];
    const floors = new Map();
    const floorAt = (ix, iz, x, y, z) => {
      const k = ix + ',' + iz + ',' + Math.round(y * 4);
      if (floors.has(k)) return floors.get(k);
      const floor = this.ground(x, y, z);
      floors.set(k, floor);
      return floor;
    };
    const add = point => {
      const [ix, iz] = cellOf(point), index = this.nodes.length;
      this.nodes.push(point); this.adj.push([]);
      const k = key(ix, iz);
      (this.grid.get(k) ?? this.grid.set(k, []).get(k)).push(index);
      return index;
    };
    const queue = [add(first)];
    let sliceStart = performance.now(), worked = 0, edges = 0;
    for (let head = 0; head < queue.length; head++) {
      if (this.nodes.length >= maxNodes || worked + performance.now() - sliceStart > budgetMs) { this.stats.truncated = true; break; }
      const from = queue[head], a = this.nodes[from], [ix, iz] = cellOf(a);
      for (const [ox, oz] of NEIGHBOURS) {
        const x = origin.x + (ix + ox) * cell, z = origin.z + (iz + oz) * cell;
        const floor = floorAt(ix + ox, iz + oz, x, a.y, z);
        if (!floor) continue;
        const column = this.grid.get(key(ix + ox, iz + oz)) ?? [];
        let to = column.find(i => Math.abs(this.nodes[i].y - floor.y) < this.opt.stepUp);
        if (to === undefined) {
          if (!this.walkable(a, floor)) continue;
          to = add(floor.clone()); queue.push(to);
        } else if (this.adj[from].includes(to) || !this.walkable(a, this.nodes[to])) continue;
        this.adj[from].push(to); this.adj[to].push(from); edges++;
      }
      if (performance.now() - sliceStart > sliceMs) {
        worked += performance.now() - sliceStart;
        onProgress?.({ nodes: this.nodes.length, queued: queue.length - head });
        await pause(); sliceStart = performance.now();
      }
    }
    worked += performance.now() - sliceStart;
    this.built = this.nodes.length > 1;
    this.stats = { nodes: this.nodes.length, edges, ms: Math.round(performance.now() - began), workMs: Math.round(worked), rays: this.rays, truncated: this.stats.truncated };
    return this.stats;
  }

  // Nearest mapped node that can actually be reached from `point` in a straight, wall-free line.
  nearest(point, maxDistance = 150) {
    if (!this.built) return -1;
    const { cell } = this.opt, reach = Math.ceil(maxDistance / cell) + 1;
    const first = this.nodes[0], ix = Math.round((point.x - first.x) / cell), iz = Math.round((point.z - first.z) / cell);
    const candidates = [];
    // The grid is keyed relative to the first node, which is the build origin.
    for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) {
      for (const i of this.grid.get((ix + dx) + ',' + (iz + dz)) ?? []) {
        const d = this.nodes[i].distanceTo(point);
        if (d <= maxDistance && Math.abs(this.nodes[i].y - point.y) < 90) candidates.push([d, i]);
      }
    }
    candidates.sort((p, q) => p[0] - q[0]);
    for (const [d, i] of candidates.slice(0, 6)) if (d < 12 || this.stepClear(point, this.nodes[i])) return i;
    return -1;
  }

  contains(point, maxDistance = 150) { return this.nearest(point, maxDistance) >= 0; }

  field(goal) {
    const hit = this.fields.findIndex(f => f.goal === goal);
    if (hit >= 0) {
      const [f] = this.fields.splice(hit, 1);
      this.fields.unshift(f);
      return f;
    }
    const n = this.nodes.length;
    const f = this.fields.length >= this.opt.fields ? this.fields.pop() : { dist: new Float32Array(n), next: new Int32Array(n) };
    f.goal = goal;
    f.dist.fill(Infinity);
    f.next.fill(-1);
    const keys = [], items = [];
    const push = (k, v) => {
      let i = keys.length;
      keys.push(k); items.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= k) break;
        keys[i] = keys[p]; items[i] = items[p]; i = p;
      }
      keys[i] = k; items[i] = v;
    };
    const pop = () => {
      const top = items[0], lastKey = keys.pop(), lastItem = items.pop();
      const size = keys.length;
      if (size) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          if (l >= size) break;
          const r = l + 1, m = r < size && keys[r] < keys[l] ? r : l;
          if (keys[m] >= lastKey) break;
          keys[i] = keys[m]; items[i] = items[m]; i = m;
        }
        keys[i] = lastKey; items[i] = lastItem;
      }
      return top;
    };
    f.dist[goal] = 0;
    push(0, goal);
    while (keys.length) {
      const u = pop(), du = f.dist[u], pu = this.nodes[u];
      for (const v of this.adj[u]) {
        const c = du + pu.distanceTo(this.nodes[v]);
        if (c < f.dist[v]) { f.dist[v] = c; f.next[v] = u; push(c, v); }
      }
    }
    this.fields.unshift(f);
    return f;
  }

  route(from, to) {
    if (from === to) return [from];
    const f = this.field(to);
    if (f.dist[from] === Infinity) return [];
    const out = [];
    for (let at = from; at !== -1; at = f.next[at]) out.push(at);
    return out;
  }

  path(from, to) {
    if (!this.built) return [];
    const a = this.nearest(from), b = this.nearest(to);
    if (a < 0 || b < 0) return [];
    const ids = this.route(a, b);
    if (!ids.length) return [];
    const points = [from.clone(), ...ids.map(i => this.nodes[i].clone())];
    if (to.distanceTo(points.at(-1)) > 1) points.push(to.clone());
    const out = [points[0]];
    const before = new THREE.Vector3(), after = new THREE.Vector3();
    for (let i = 1; i < points.length - 1; i++) {
      before.subVectors(points[i], out.at(-1)).setY(0);
      after.subVectors(points[i + 1], points[i]).setY(0);
      const lengths = before.length() * after.length();
      if (i > 1 && lengths > 1e-6 && before.dot(after) / lengths > this.opt.straight && Math.abs(points[i].y - out.at(-1).y) < this.opt.stepUp) continue;
      out.push(points[i]);
    }
    out.push(points.at(-1));
    return out;
  }
}
