import * as THREE from 'three';
import { ShangriSession } from '../shangri-la-session.js';
import { ShangriFeatures } from '../shangri-la-features.js';
import { SurvivalNavigation } from '../shangri-la-navigation.js';

const DOWN = new THREE.Vector3(0, -1, 0);

export class CustomSession extends ShangriSession {
  reset() {
    super.reset();
    this.power = true;
  }
}

export class CustomFeatures extends ShangriFeatures {
  async load() {
    await super.load();
    for (const barrier of this.barriers) {
      const entity = this.data.entities[barrier.id];
      if (entity?.repair) barrier.position.set(...entity.repair);
      if (entity?.spawn) barrier.spawnPoint = new THREE.Vector3(...entity.spawn);
      if (entity?.spawns?.length) barrier.spawnPoints = entity.spawns.map(point => new THREE.Vector3(...point));
    }
  }
}

// Binary min-heap over parallel typed arrays (no per-entry allocation). Sifting uses the exact same
// comparisons as the tuple version it replaces, so equal priorities pop in the same order.
class Heap {
  constructor(capacity = 1024) {
    this.prio = new Float64Array(capacity);
    this.node = new Int32Array(capacity);
    this.size = 0;
  }

  clear() { this.size = 0; }

  push(node, priority) {
    if (this.size === this.prio.length) this.grow();
    const prio = this.prio, nodes = this.node;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (prio[parent] <= priority) break;
      prio[i] = prio[parent];
      nodes[i] = nodes[parent];
      i = parent;
    }
    prio[i] = priority;
    nodes[i] = node;
  }

  pop() {
    const prio = this.prio, nodes = this.node, top = nodes[0];
    const n = --this.size;
    if (n > 0) {
      const lastPriority = prio[n], lastNode = nodes[n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = -1, best = lastPriority;
        if (l < n && prio[l] < best) { m = l; best = prio[l]; }
        if (r < n && prio[r] < best) m = r;
        if (m < 0) break;
        prio[i] = prio[m];
        nodes[i] = nodes[m];
        i = m;
      }
      prio[i] = lastPriority;
      nodes[i] = lastNode;
    }
    return top;
  }

  grow() {
    const prio = new Float64Array(this.prio.length * 2), nodes = new Int32Array(this.node.length * 2);
    prio.set(this.prio);
    nodes.set(this.node);
    this.prio = prio;
    this.node = nodes;
  }
}

export function createGridNavigation(getLayout) {
  return class GridNavigation extends SurvivalNavigation {
    constructor(base) {
      super(base);
      const layout = getLayout();
      this.layout = layout;
      this.grid = layout.grid;
      const count = this.grid.count;
      this.seen = new Uint32Array(count);
      this.cost = new Float32Array(count);
      this.from = new Int32Array(count);
      this.token = 0;
      const home = this.grid.nearest(layout.spawn.position[0], layout.spawn.position[1], layout.spawn.position[2], 3, 120);
      this.home = home >= 0 ? this.grid.comp[home] : this.grid.largest();
    }

    async load() {
      this.baked = false;
      this.metadata = {
        candidates: this.layout.windows.map(w => ({ kind: 'spawn', position: w.outside })),
        start: this.layout.spawn.position,
      };
    }

    node(p, rings = 3) { return this.grid.nearest(p.x, p.y, p.z, rings, 90); }

    route(a, b) {
      const grid = this.grid, start = this.node(a), goal = this.node(b);
      if (start < 0 || goal < 0 || grid.comp[start] !== grid.comp[goal]) return [];
      const token = ++this.token, nodes = grid.nodes, alive = grid.alive, links = grid.links;
      const seen = this.seen, cost = this.cost, from = this.from;
      const heap = this.heap ??= new Heap();
      heap.clear();
      const gx = nodes[goal].x, gy = nodes[goal].y, gz = nodes[goal].z;
      const h = i => {
        const n = nodes[i], dx = n.x - gx, dy = n.y - gy, dz = n.z - gz;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      };
      seen[start] = token;
      cost[start] = 0;
      from[start] = -1;
      heap.push(start, h(start));
      let found = false;
      for (let steps = 0; heap.size && steps < 40000; steps++) {
        const current = heap.pop();
        if (current === goal) {
          found = true;
          break;
        }
        const here = nodes[current], base = cost[current], around = links[current];
        for (let k = 0; k < around.length; k++) {
          const next = around[k];
          if (!alive[next]) continue;
          const there = nodes[next], dx = there.x - here.x, dy = there.y - here.y, dz = there.z - here.z;
          const step = base + Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (seen[next] !== token || step < cost[next]) {
            seen[next] = token;
            cost[next] = step;
            from[next] = current;
            heap.push(next, step + h(next));
          }
        }
      }
      if (!found) return [];
      const chain = [];
      for (let i = goal; i >= 0; i = from[i]) chain.push(new THREE.Vector3(nodes[i].x, nodes[i].y, nodes[i].z));
      chain.reverse();
      const points = [a.clone(), ...chain, b.clone()];
      const pulled = [points[0]];
      for (let i = 0; i < points.length - 1;) {
        let j = points.length - 1;
        while (j > i + 1 && !grid.walkable(points[i].x, points[i].y, points[i].z, points[j].x, points[j].y, points[j].z)) j--;
        pulled.push(points[j]);
        i = j;
      }
      return pulled;
    }

    path(a, b) { return this.route(a, b); }

    rawPath(a, b) { return this.route(a, b); }

    autoPath(a, b) { return this.route(a, b); }

    canReach(from, goal) {
      const a = this.node(from), b = this.node(goal);
      return a >= 0 && b >= 0 && this.grid.comp[a] === this.grid.comp[b];
    }

    viable(barriers) {
      if (this.reachableIds) {
        const chosen = barriers.filter(barrier => this.reachableIds.has(barrier.id));
        if (chosen.length) return chosen;
      }
      const list = barriers.filter(barrier => {
        const i = this.node(barrier.inside);
        return i >= 0 && this.grid.comp[i] === this.home;
      });
      return list.length ? list : barriers;
    }

    floorAt(x, z, hint) {
      const hit = this.world?.raycast?.(new THREE.Ray(new THREE.Vector3(x, hint + 40, z), DOWN), 0, 100);
      return hit && Math.abs(hit.point.y - hint) <= 30 ? hit.point.y : hint;
    }

    closest(p) {
      const i = this.node(p, 2);
      if (i < 0) return null;
      const node = this.grid.nodes[i], half = this.grid.cell / 2 + 4;
      if (Math.abs(node.x - p.x) <= half && Math.abs(node.z - p.z) <= half) return new THREE.Vector3(p.x, this.floorAt(p.x, p.z, node.y), p.z);
      return new THREE.Vector3(node.x, node.y, node.z);
    }

    // Component of the floor right under a point (tight match), or -1 when there is none.
    compAt(p) {
      const i = this.grid.nearest(p.x, p.y, p.z, 2, 40);
      return i >= 0 ? this.grid.comp[i] : -1;
    }

    async prepare() {
      const reachable = this.barriers.filter(b => {
        const i = this.node(b.inside);
        return i >= 0 && this.grid.comp[i] === this.home;
      });
      // Zombies start outside their window, so prefer windows whose outside is on floor that connects to
      // the player's area; a ledge or pocket with no way down would leave them stranded there. Keep
      // every window that can be reached when a map has too few of the connected kind.
      const linked = reachable.filter(b => this.compAt(b.outside) === this.home);
      const spawning = linked.length >= Math.min(3, reachable.length) ? linked : reachable;
      this.reachableIds = new Set(spawning.map(b => b.id));
      this.version++;
      this.health = {
        baked: false, mapped: true, pathPoints: this.grid.count, links: this.grid.links.reduce((sum, l) => sum + l.length, 0) / 2,
        barriers: this.barriers.length, reachable: spawning.length, unreachable: this.barriers.length - spawning.length, ms: 0,
      };
      this.onChange?.(this.health);
      return this.health;
    }

    homeComponent() {
      const p = this.layout.spawn.position;
      const home = this.grid.nearest(p[0], p[1], p[2], 3, 120);
      return home >= 0 ? this.grid.comp[home] : this.grid.largest();
    }

    // Closed buyable doors cut the walkable grid; opening one rejoins the areas behind it.
    setBlockers(boxes = []) {
      let changed = false;
      for (const door of this.layout.doors ?? []) {
        const closed = boxes.some(box => box.containsPoint(door.center));
        if (closed || !door.closed) continue;
        door.closed = false;
        this.grid.revive(door.ids);
        changed = true;
      }
      if (!changed) return;
      this.grid.recompute();
      this.home = this.homeComponent();
      this.prepare();
    }

    queueRefresh() {}
  };
}
