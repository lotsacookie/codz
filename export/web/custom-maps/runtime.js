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
    }
  }
}

class Heap {
  constructor() { this.items = []; }

  get size() { return this.items.length; }

  push(node, priority) {
    const items = this.items;
    items.push([priority, node]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= items[i][0]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const items = this.items, top = items[0], last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < items.length && items[l][0] < items[m][0]) m = l;
        if (r < items.length && items[r][0] < items[m][0]) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top[1];
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
      const token = ++this.token, nodes = grid.nodes, heap = new Heap();
      const gx = nodes[goal].x, gy = nodes[goal].y, gz = nodes[goal].z;
      const h = i => Math.hypot(nodes[i].x - gx, nodes[i].y - gy, nodes[i].z - gz);
      this.seen[start] = token;
      this.cost[start] = 0;
      this.from[start] = -1;
      heap.push(start, h(start));
      let found = false;
      for (let steps = 0; heap.size && steps < 40000; steps++) {
        const current = heap.pop();
        if (current === goal) {
          found = true;
          break;
        }
        const here = nodes[current];
        for (const next of grid.links[current]) {
          if (!grid.alive[next]) continue;
          const there = nodes[next];
          const step = this.cost[current] + Math.hypot(there.x - here.x, there.y - here.y, there.z - here.z);
          if (this.seen[next] !== token || step < this.cost[next]) {
            this.seen[next] = token;
            this.cost[next] = step;
            this.from[next] = current;
            heap.push(next, step + h(next));
          }
        }
      }
      if (!found) return [];
      const chain = [];
      for (let i = goal; i >= 0; i = this.from[i]) chain.unshift(new THREE.Vector3(nodes[i].x, nodes[i].y, nodes[i].z));
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

    async prepare() {
      const reachable = this.viable(this.barriers).filter(b => {
        const i = this.node(b.inside);
        return i >= 0 && this.grid.comp[i] === this.home;
      });
      this.reachableIds = new Set(reachable.map(b => b.id));
      this.version++;
      this.health = {
        baked: false, mapped: true, pathPoints: this.grid.count, links: this.grid.links.reduce((sum, l) => sum + l.length, 0) / 2,
        barriers: this.barriers.length, reachable: reachable.length, unreachable: this.barriers.length - reachable.length, ms: 0,
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
