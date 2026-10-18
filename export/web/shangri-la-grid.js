import * as THREE from 'three';
import { Grid, bvhProbe, scanWalkable } from './custom-maps/analyze.js';
import { createGridNavigation } from './custom-maps/runtime.js';

const CELL = 36;
const MAX_COLUMNS = 24000;
const MARGIN = 160;
const DOOR_MARGIN = CELL * .75;
const MIN_COMPONENT = 150;
const TOLERANCE = { step: 20, slope: 1.1, mid: 18, diagonal: 1 };

export function collisionProbe(collision) {
  const index = collision.geometry.index?.array;
  if (!index) throw new Error('collision geometry has no index');
  return bvhProbe(collision.bvh, collision.geometry.attributes.position.array, index);
}

export function traversalBounds(entities, margin = MARGIN) {
  const box = new THREE.Box3();
  for (const e of entities) {
    if (e.position && (e.classname === 'node_pathnode' || e.targetname === 'initial_spawn_points')) box.expandByPoint(new THREE.Vector3(...e.position));
  }
  return box.isEmpty() ? null : box.expandByScalar(margin);
}

export function doorFootprint(grid, box) {
  const m = DOOR_MARGIN, ids = [];
  grid.nodes.forEach((node, i) => {
    if (node.x > box.min.x - m && node.x < box.max.x + m && node.z > box.min.z - m && node.z < box.max.z + m && node.y > box.min.y - 40 && node.y < box.max.y + 20) ids.push(i);
  });
  return ids;
}

function closeDoor(layout, door) {
  for (const i of door.ids) {
    layout.blocked[i]++;
    layout.grid.alive[i] = 0;
  }
}

function openDoor(layout, door) {
  for (const i of door.ids) {
    if (layout.blocked[i] > 0 && --layout.blocked[i] === 0) layout.grid.alive[i] = 1;
  }
}

export async function buildShangriLayout({ collision, entities, spawn, barriers = [], doorParts = [], onStatus = () => {} }) {
  const bounds = traversalBounds(entities) ?? new THREE.Box3(new THREE.Vector3(...collision.metadata.bounds.min), new THREE.Vector3(...collision.metadata.bounds.max));
  const probe = collisionProbe(collision);
  onStatus('Scanning the floor…');
  const scan = await scanWalkable(probe, bounds, { cell: CELL, maxColumns: MAX_COLUMNS });
  if (scan.nodes.length < 25) throw new Error(`Could not find walkable floor to map zombie routes (${scan.nodes.length} points)`);
  const grid = new Grid(scan, TOLERANCE);
  onStatus('Mapping zombie paths…');
  await grid.link(probe);
  const layout = {
    grid,
    blocked: new Uint16Array(grid.count),
    spawn: { position: [...spawn] },
    windows: barriers.map(b => ({ outside: [...b.outside], inside: [...b.inside] })),
    doors: [],
  };
  for (const part of doorParts) {
    const door = { ids: doorFootprint(grid, part.box), center: part.box.getCenter(new THREE.Vector3()), closed: true };
    closeDoor(layout, door);
    layout.doors.push(door);
  }
  grid.recompute();
  return layout;
}

export function createShangriNavigation(getLayout) {
  const Base = createGridNavigation(getLayout);
  return class ShangriNavigation extends Base {
    constructor(base) {
      super(base);
      this.home = this.homeComponent();
    }

    node(p, rings = 3) {
      const grid = this.grid;
      const i = grid.nearest(p.x, p.y, p.z, rings, 90, MIN_COMPONENT);
      return i >= 0 ? i : grid.nearest(p.x, p.y, p.z, rings, 90);
    }

    homeComponent() {
      const p = this.layout.spawn.position, grid = this.grid;
      let home = grid.nearest(p[0], p[1], p[2], 3, 120, MIN_COMPONENT);
      if (home < 0) home = grid.nearest(p[0], p[1], p[2], 3, 120);
      return home >= 0 ? grid.comp[home] : grid.largest();
    }
    viable(barriers, goal = null) {
      if (goal) {
        const at = this.node(goal);
        if (at >= 0) {
          const comp = this.grid.comp[at];
          const list = barriers.filter(b => {
            const i = this.node(b.inside);
            return i >= 0 && this.grid.comp[i] === comp;
          });
          if (list.length) return list;
        }
      }
      return super.viable(barriers);
    }

    setBlockers(boxes = []) {
      const layout = this.layout;
      let changed = false;
      for (const door of layout.doors ?? []) {
        const closed = boxes.some(box => box.containsPoint(door.center));
        if (closed === door.closed) continue;
        door.closed = closed;
        if (closed) closeDoor(layout, door); else openDoor(layout, door);
        changed = true;
      }
      if (!changed) return;
      this.grid.recompute();
      this.home = this.homeComponent();
      if (this.barriers) this.prepare();
    }
  };
}
