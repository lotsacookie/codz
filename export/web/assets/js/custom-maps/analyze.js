import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export const PLAYER = { radius: 15, step: 18, headroom: 75, wallProbe: 30 };
export const AXES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const NEIGHBOURS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const RING = [[1, 0], [.7071, .7071], [0, 1], [-.7071, .7071], [-1, 0], [-.7071, -.7071], [0, -1], [.7071, -.7071]];
const MAX_COLUMNS = 14000;
const MAX_LAYERS = 12;
const FLAT_LIMIT = 4000000;
const WINDOW_DEPTH = { outside: 78, inside: 42, repair: 24 };

export const tick = () => new Promise(resolve => setTimeout(resolve, 0));

export function createProbe(positions, index) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  const bvh = new MeshBVH(geometry, { targetLeafSize: 12 });
  return { ...bvhProbe(bvh, positions, index), geometry };
}

export function bvhProbe(bvh, positions, index) {
  const ray = new THREE.Ray();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const cast = (x, y, z, dx, dy, dz, far) => {
    ray.origin.set(x, y, z);
    ray.direction.set(dx, dy, dz);
    return bvh.raycastFirst(ray, THREE.DoubleSide, 0, far);
  };
  const normalY = hit => {
    const i = hit.faceIndex * 3;
    a.fromArray(positions, index[i] * 3);
    b.fromArray(positions, index[i + 1] * 3);
    c.fromArray(positions, index[i + 2] * 3);
    b.sub(a);
    c.sub(a);
    b.cross(c);
    const length = b.length();
    return length > 1e-12 ? Math.abs(b.y) / length : 0;
  };
  return { cast, normalY, positions, index, bvh };
}

function standable(probe, x, y, z) {
  if (probe.cast(x, y + 2, z, 0, 1, 0, PLAYER.headroom)) return false;
  for (const [dx, dz] of RING) if (probe.cast(x, y + PLAYER.wallProbe, z, dx, 0, dz, PLAYER.radius)) return false;
  return true;
}

export async function scanWalkable(probe, box, { cell = 40, maxColumns = MAX_COLUMNS, onProgress = null } = {}) {
  const width = box.max.x - box.min.x, depth = box.max.z - box.min.z;
  let size = cell;
  while ((width / size) * (depth / size) > maxColumns) size *= 1.15;
  const cols = Math.max(1, Math.ceil(width / size)), rows = Math.max(1, Math.ceil(depth / size));
  const top = box.max.y + 4, bottom = box.min.y - 4;
  const nodes = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = box.min.x + (col + .5) * size, z = box.min.z + (row + .5) * size;
      let y = top;
      for (let layer = 0; layer < MAX_LAYERS; layer++) {
        const hit = probe.cast(x, y, z, 0, -1, 0, y - bottom);
        if (!hit) break;
        const floor = hit.point.y;
        y = floor - 2;
        if (probe.normalY(hit) < .62 || !standable(probe, x, floor, z)) continue;
        nodes.push({ x, y: floor, z, col, row });
      }
    }
    if (row % 6 === 5) {
      onProgress?.(row / rows);
      await tick();
    }
  }
  return { nodes, cell: size, cols, rows, minX: box.min.x, minZ: box.min.z };
}

export class Grid {
  constructor({ nodes, cell, cols, rows, minX, minZ }, tolerance = {}) {
    this.tolerance = { step: PLAYER.step, slope: .9, mid: 10, diagonal: 2, ...tolerance };
    this.nodes = nodes;
    this.cell = cell;
    this.cols = cols;
    this.rows = rows;
    this.minX = minX;
    this.minZ = minZ;
    this.count = nodes.length;
    this.alive = new Uint8Array(this.count).fill(1);
    this.comp = new Int32Array(this.count).fill(-1);
    this.sizes = [];
    this.links = nodes.map(() => []);
    this.columns = new Map();
    nodes.forEach((node, i) => {
      const key = node.row * cols + node.col;
      const list = this.columns.get(key);
      if (list) list.push(i); else this.columns.set(key, [i]);
    });
    // Flat lookup used by the hot path (nearest / walkable run thousands of times per route); a plain
    // array read is several times cheaper than a Map.get. Skipped for absurdly large footprints.
    this.flat = cols * rows <= FLAT_LIMIT ? new Array(cols * rows).fill(null) : null;
    if (this.flat) for (const [key, list] of this.columns) this.flat[key] = list;
  }

  at(col, row) {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return null;
    return this.flat ? this.flat[row * this.cols + col] : (this.columns.get(row * this.cols + col) ?? null);
  }

  async link(probe, onProgress = null) {
    for (let i = 0; i < this.count; i++) {
      const a = this.nodes[i];
      for (const [dc, dr] of NEIGHBOURS) {
        const list = this.at(a.col + dc, a.row + dr);
        if (!list) continue;
        for (const j of list) {
          if (!this.connects(probe, i, j, dc, dr)) continue;
          this.links[i].push(j);
          this.links[j].push(i);
        }
      }
      if (i % 600 === 599) {
        onProgress?.(i / this.count);
        await tick();
      }
    }
    return this;
  }

  connects(probe, i, j, dc, dr) {
    const a = this.nodes[i], b = this.nodes[j], t = this.tolerance;
    const dy = Math.abs(b.y - a.y), run = Math.hypot(b.x - a.x, b.z - a.z);
    if (dy > Math.max(t.step, run * t.slope)) return false;
    const mid = (a.y + b.y) / 2;
    if (dy > PLAYER.step) {
      const ground = probe.cast((a.x + b.x) / 2, Math.max(a.y, b.y) + 40, (a.z + b.z) / 2, 0, -1, 0, 90);
      if (!ground || Math.abs(ground.point.y - mid) > t.mid) return false;
    }
    if (probe.cast(a.x, mid + PLAYER.wallProbe, a.z, (b.x - a.x) / run, 0, (b.z - a.z) / run, run)) return false;
    if (dc !== 0 && dr !== 0) {
      let open = 0;
      for (const list of [this.at(a.col + dc, a.row), this.at(a.col, a.row + dr)]) {
        if (list?.some(k => Math.abs(this.nodes[k].y - a.y) <= 30)) open++;
      }
      if (open < t.diagonal) return false;
    }
    return true;
  }

  recompute() {
    this.comp.fill(-1);
    this.sizes = [];
    const stack = [];
    for (let start = 0; start < this.count; start++) {
      if (!this.alive[start] || this.comp[start] >= 0) continue;
      const id = this.sizes.length;
      let size = 0;
      this.comp[start] = id;
      stack.push(start);
      while (stack.length) {
        const node = stack.pop();
        size++;
        for (const next of this.links[node]) {
          if (this.alive[next] && this.comp[next] < 0) {
            this.comp[next] = id;
            stack.push(next);
          }
        }
      }
      this.sizes.push(size);
    }
    return this;
  }

  largest() {
    let best = -1;
    this.sizes.forEach((size, i) => { if (best < 0 || size > this.sizes[best]) best = i; });
    return best;
  }

  kill(test) {
    const ids = [];
    this.nodes.forEach((node, i) => {
      if (this.alive[i] && test(node, i)) {
        this.alive[i] = 0;
        ids.push(i);
      }
    });
    return ids;
  }

  revive(ids) {
    for (const i of ids) this.alive[i] = 1;
  }

  nearest(x, y, z, rings = 3, drop = 80, minSize = 0) {
    const cell = this.cell, col = Math.floor((x - this.minX) / cell), row = Math.floor((z - this.minZ) / cell);
    const nodes = this.nodes, alive = this.alive, comp = this.comp, sizes = this.sizes;
    let best = -1, bestCost = Infinity;
    for (let r = 0; r <= rings; r++) {
      for (let dr = -r; dr <= r; dr++) {
        // Only the border of the ring: every column when on the top/bottom row, else just the two ends.
        const step = dr === -r || dr === r ? 1 : 2 * r || 1;
        for (let dc = -r; dc <= r; dc += step) {
          const list = this.at(col + dc, row + dr);
          if (!list) continue;
          for (let k = 0; k < list.length; k++) {
            const i = list[k];
            if (!alive[i] || (minSize && sizes[comp[i]] < minSize)) continue;
            const node = nodes[i], dy = Math.abs(node.y - y);
            if (dy > drop) continue;
            const ex = node.x - x, ez = node.z - z;
            const cost = Math.sqrt(ex * ex + ez * ez) + dy * 1.5;
            if (cost < bestCost) {
              bestCost = cost;
              best = i;
            }
          }
        }
      }
      if (best >= 0 && bestCost <= (r + .5) * cell) break;
    }
    return best;
  }

  walkable(ax, ay, az, bx, by, bz) {
    const run = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(run / (this.cell * .5)));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (this.nearest(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, 0, 26) < 0) return false;
    }
    return true;
  }
}

export function wallDistance(probe, node, dx, dz, far = 420) {
  const hit = probe.cast(node.x, node.y + PLAYER.wallProbe, node.z, dx, 0, dz, far);
  return hit ? hit.distance : far;
}

export function findChokes(probe, grid, main, { minWidth = 70, maxWidth = 260, open = 170 } = {}) {
  const found = [];
  grid.nodes.forEach((node, i) => {
    if (!grid.alive[i] || grid.comp[i] !== main) return;
    for (const n of [[1, 0], [0, 1]]) {
      const tangent = [n[1], n[0]];
      const plus = wallDistance(probe, node, tangent[0], tangent[1]);
      const minus = wallDistance(probe, node, -tangent[0], -tangent[1]);
      const width = plus + minus;
      if (width < minWidth || width > maxWidth) continue;
      if (wallDistance(probe, node, n[0], n[1]) < open || wallDistance(probe, node, -n[0], -n[1]) < open) continue;
      const shift = (plus - minus) / 2;
      found.push({ node: i, x: node.x + tangent[0] * shift, y: node.y, z: node.z + tangent[1] * shift, n, t: tangent, width });
    }
  });
  return found;
}

const flat = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function footprint(grid, w) {
  const half = w.width / 2 + 20;
  return grid.kill(node => {
    if (Math.abs(node.y - w.y) > 60) return false;
    const dx = node.x - w.x, dz = node.z - w.z;
    return Math.abs(dx * w.t[0] + dz * w.t[1]) <= half && Math.abs(dx * w.n[0] + dz * w.n[1]) <= 22;
  });
}

function sideComponent(grid, w, sign) {
  const x = w.x + w.n[0] * sign * 56, z = w.z + w.n[1] * sign * 56;
  const i = grid.nearest(x, w.y, z, 2, 60);
  if (i < 0) return -1;
  const node = grid.nodes[i];
  return Math.hypot(node.x - x, node.z - z) <= 56 ? grid.comp[i] : -1;
}

export function pickSpawn(probe, grid, comp) {
  let cx = 0, cz = 0, count = 0;
  grid.nodes.forEach((node, i) => {
    if (grid.alive[i] && grid.comp[i] === comp) {
      cx += node.x;
      cz += node.z;
      count++;
    }
  });
  if (!count) return null;
  cx /= count;
  cz /= count;
  const ids = [];
  grid.nodes.forEach((node, i) => { if (grid.alive[i] && grid.comp[i] === comp) ids.push(i); });
  ids.sort((p, q) => Math.hypot(grid.nodes[p].x - cx, grid.nodes[p].z - cz) - Math.hypot(grid.nodes[q].x - cx, grid.nodes[q].z - cz));
  let best = null;
  for (const i of ids.slice(0, 160)) {
    const node = grid.nodes[i];
    let clearance = Infinity, far = 0, facing = RING[0];
    for (const dir of RING) {
      const d = wallDistance(probe, node, dir[0], dir[1], 360);
      clearance = Math.min(clearance, d);
      if (d > far) {
        far = d;
        facing = dir;
      }
    }
    const score = clearance - Math.hypot(node.x - cx, node.z - cz) * .15;
    if (!best || score > best.score) best = { score, index: i, facing };
  }
  const node = grid.nodes[best.index];
  const rotation = Math.atan2(-best.facing[0], -best.facing[1]);
  return { index: best.index, position: [node.x, node.y + 2, node.z], yaw: rotation + Math.PI / 2 };
}

export function findWallSites(probe, grid, comp, spawn) {
  const sites = [];
  grid.nodes.forEach((node, i) => {
    if (!grid.alive[i] || grid.comp[i] !== comp) return;
    for (const [dx, dz] of AXES) {
      const d = wallDistance(probe, node, dx, dz, 110);
      if (d < 34 || d > 100) continue;
      const tx = -dz, tz = dx;
      let flatWall = true;
      for (const side of [-36, 36]) {
        const hit = probe.cast(node.x + tx * side, node.y + PLAYER.wallProbe, node.z + tz * side, dx, 0, dz, 140);
        if (!hit || Math.abs(hit.distance - d) > 6) {
          flatWall = false;
          break;
        }
      }
      if (!flatWall || wallDistance(probe, node, -dx, -dz, 200) < 140) continue;
      const anchor = [node.x + dx * d, node.z + dz * d];
      sites.push({ node: i, anchor, normal: [-dx, -dz], y: node.y, distance: Math.hypot(node.x - spawn.position[0], node.z - spawn.position[2]) });
    }
  });
  return sites;
}

export function assignSites(grid, comp, spawn, roles, wallSites, spacing = 104) {
  const ordered = wallSites.filter(site => site.distance > 140).sort((a, b) => a.distance - b.distance);
  const placed = [];
  const clear = anchor => placed.every(p => flat(p.anchor, anchor) >= spacing);
  const open = [];
  grid.nodes.forEach((node, i) => { if (grid.alive[i] && grid.comp[i] === comp) open.push(i); });
  open.sort((p, q) => Math.hypot(grid.nodes[p].x - spawn.position[0], grid.nodes[p].z - spawn.position[2]) - Math.hypot(grid.nodes[q].x - spawn.position[0], grid.nodes[q].z - spawn.position[2]));
  for (const role of roles) {
    const site = ordered.find(candidate => clear(candidate.anchor));
    if (site) {
      placed.push({ role, anchor: site.anchor, normal: site.normal, y: site.y, free: false });
      continue;
    }
    const spot = open.find(i => {
      const node = grid.nodes[i];
      return Math.hypot(node.x - spawn.position[0], node.z - spawn.position[2]) > 140 && clear([node.x, node.z]);
    });
    if (spot === undefined) continue;
    const node = grid.nodes[spot];
    const toX = spawn.position[0] - node.x, toZ = spawn.position[2] - node.z;
    const normal = Math.abs(toX) > Math.abs(toZ) ? [Math.sign(toX) || 1, 0] : [0, Math.sign(toZ) || 1];
    placed.push({ role, anchor: [node.x - normal[0] * 18, node.z - normal[1] * 18], normal, y: node.y, free: true });
  }
  return placed;
}

export function finishWindow(w, inward) {
  const n = [inward[0] + 0, inward[1] + 0];
  const at = (k, lift = 0) => [w.x + n[0] * k, w.y + lift, w.z + n[1] * k];
  return {
    x: w.x, y: w.y, z: w.z, n, t: w.t, width: w.width, free: !!w.free,
    inside: at(WINDOW_DEPTH.inside),
    outside: at(-WINDOW_DEPTH.outside),
    repair: at(WINDOW_DEPTH.repair, 60),
    spawnPoint: w.spawnPoint ?? null,
    spawnPoints: w.spawnPoints ?? null,
  };
}

function openFieldWindow(probe, grid, main, spawn) {
  const ids = [];
  grid.nodes.forEach((node, i) => { if (grid.alive[i] && grid.comp[i] === main) ids.push(i); });
  ids.sort((p, q) => Math.hypot(grid.nodes[q].x - spawn.position[0], grid.nodes[q].z - spawn.position[2]) - Math.hypot(grid.nodes[p].x - spawn.position[0], grid.nodes[p].z - spawn.position[2]));
  const pool = ids.filter(i => Math.hypot(grid.nodes[i].x - spawn.position[0], grid.nodes[i].z - spawn.position[2]) > 500);
  const node = grid.nodes[(pool.length ? pool[Math.floor(pool.length / 3)] : ids[0])];
  const toX = spawn.position[0] - node.x, toZ = spawn.position[2] - node.z;
  const n = Math.abs(toX) > Math.abs(toZ) ? [1, 0] : [0, 1];
  const t = [Math.abs(n[1]), Math.abs(n[0])];
  return { x: node.x, y: node.y, z: node.z, n, t, width: 220, free: true };
}

export async function planLevel(probe, box, { roles = [], windowCount = 4, onStatus = () => {} } = {}) {
  onStatus('Scanning the floor…', .1);
  const scan = await scanWalkable(probe, box, { onProgress: f => onStatus('Scanning the floor…', .1 + f * .2) });
  if (scan.nodes.length < 25) return { failed: 'no-floor', nodes: scan.nodes.length };
  const grid = new Grid(scan);
  onStatus('Mapping zombie paths…', .3);
  await grid.link(probe, f => onStatus('Mapping zombie paths…', .3 + f * .25));
  grid.recompute();
  const first = grid.largest();
  if (grid.sizes[first] < 25) return { failed: 'no-floor', nodes: grid.sizes[first] };
  onStatus('Placing windows…', .6);
  const guess = pickSpawn(probe, grid, first);
  const chokes = findChokes(probe, grid, first).sort((a, b) => a.width - b.width);
  let active = [];
  for (const choke of chokes) {
    if (Math.hypot(choke.x - guess.position[0], choke.z - guess.position[2]) < 260) continue;
    if (active.some(o => flat([o.x, o.z], [choke.x, choke.z]) < 380)) continue;
    active.push(choke);
    if (active.length >= windowCount) break;
  }
  const baseline = grid.sizes[first];
  let main = first, killed = new Map(), passed = false;
  for (let pass = 0; pass < 6; pass++) {
    for (const ids of killed.values()) grid.revive(ids);
    killed = new Map();
    for (const w of active) killed.set(w, footprint(grid, w));
    grid.recompute();
    main = grid.largest();
    if (active.length > 1 && grid.sizes[main] < baseline * .35) {
      active = active.slice(0, -1);
      continue;
    }
    const keep = active.filter(w => sideComponent(grid, w, 1) === main || sideComponent(grid, w, -1) === main);
    if (keep.length === active.length) {
      passed = true;
      break;
    }
    active = keep;
  }
  if (!passed) {
    for (const ids of killed.values()) grid.revive(ids);
    killed = new Map();
    for (const w of active) killed.set(w, footprint(grid, w));
    grid.recompute();
    main = grid.largest();
  }
  let spawn = pickSpawn(probe, grid, main);
  if (!active.length) {
    const w = openFieldWindow(probe, grid, main, spawn);
    active = [w];
    killed.set(w, footprint(grid, w));
    grid.recompute();
    main = grid.largest();
    spawn = pickSpawn(probe, grid, main);
  }
  const windows = active.map(w => {
    const plus = sideComponent(grid, w, 1) === main, minus = sideComponent(grid, w, -1) === main;
    const towardSpawn = (spawn.position[0] - w.x) * w.n[0] + (spawn.position[2] - w.z) * w.n[1] >= 0;
    const inwardPositive = plus && minus ? towardSpawn : plus;
    return finishWindow(w, inwardPositive ? w.n : [-w.n[0], -w.n[1]]);
  });
  onStatus('Finding spots for perks and the box…', .7);
  const sites = assignSites(grid, main, spawn, roles, findWallSites(probe, grid, main, spawn));
  return { grid, main, spawn, windows, sites };
}
