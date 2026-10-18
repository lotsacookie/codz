import { Grid, scanWalkable, pickSpawn, wallDistance, footprint, finishWindow } from './analyze.js';

const axisOf = yawDegrees => {
  const radians = yawDegrees * Math.PI / 180;
  const x = Math.cos(radians), z = -Math.sin(radians);
  return Math.abs(x) >= Math.abs(z) ? [Math.sign(x) || 1, 0] : [0, Math.sign(z) || 1];
};
const AXES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const WINDOW_WIDTH = 80;
const DOOR_PAD = 28;

// Plans a level from the NZ:P entities of a BSP map (already in world units) instead of guessing.
// Returns null when the map lacks what is needed, so the caller can fall back to automatic planning.
export async function planFromLayout(probe, box, layout, { roles = [], onStatus = () => {} } = {}) {
  if (!layout?.spawn || (!layout.windows.length && !layout.spawners?.length)) return null;
  onStatus('Scanning the floor…', .1);
  const scan = await scanWalkable(probe, box, { onProgress: f => onStatus('Scanning the floor…', .1 + f * .2) });
  if (scan.nodes.length < 25) return { failed: 'no-floor', nodes: scan.nodes.length };
  const grid = new Grid(scan);
  onStatus('Mapping zombie paths…', .3);
  await grid.link(probe, f => onStatus('Mapping zombie paths…', .3 + f * .25));
  grid.recompute();

  onStatus('Closing the doors…', .6);
  const doors = layout.doors.map(door => {
    const ids = grid.kill(node => node.x > door.min[0] - DOOR_PAD && node.x < door.max[0] + DOOR_PAD
      && node.z > door.min[2] - DOOR_PAD && node.z < door.max[2] + DOOR_PAD
      && node.y > door.min[1] - 60 && node.y < door.max[1] + 10);
    return { ...door, ids, center: [(door.min[0] + door.max[0]) / 2, (door.min[1] + door.max[1]) / 2, (door.min[2] + door.max[2]) / 2] };
  });
  grid.recompute();

  let spawnIndex = grid.nearest(layout.spawn.point[0], layout.spawn.point[1], layout.spawn.point[2], 4, 120);
  if (spawnIndex < 0 || grid.sizes[grid.comp[spawnIndex]] < 25) spawnIndex = -1;
  const main = spawnIndex >= 0 ? grid.comp[spawnIndex] : grid.largest();
  if (main < 0 || grid.sizes[main] < 25) return { failed: 'no-floor', nodes: 0 };
  const facing = axisOf(layout.spawn.yaw);
  let spawn;
  if (spawnIndex >= 0) {
    const node = grid.nodes[spawnIndex];
    spawn = { index: spawnIndex, position: [node.x, node.y + 2, node.z], yaw: Math.atan2(-facing[0], -facing[1]) + Math.PI / 2 };
  } else spawn = pickSpawn(probe, grid, main);

  onStatus('Placing windows…', .7);
  let entries = layout.windows;
  if (!entries.length) {
    // No barricades in this map: let zombies come in at their spawn points, spread around the level.
    const inMain = layout.spawners.filter(p => {
      const i = grid.nearest(p[0], p[1], p[2], 3, 100);
      return i >= 0 && grid.comp[i] === main;
    });
    const far = distance => inMain.filter(p => Math.hypot(p[0] - spawn.position[0], p[2] - spawn.position[2]) > distance);
    const usable = far(300).length ? far(300) : far(120);
    const chosen = [];
    for (const p of usable) if (chosen.length < 4 && chosen.every(c => Math.hypot(c[0] - p[0], c[2] - p[2]) > 350)) chosen.push(p);
    if (!chosen.length && usable.length) chosen.push(usable[0]);
    if (!chosen.length) return null;
    entries = chosen.map(point => {
      const dx = spawn.position[0] - point[0], dz = spawn.position[2] - point[2];
      const yaw = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 0 : 180) : (dz > 0 ? 270 : 90);
      return { point, yaw, spawner: null };
    });
  }
  const windows = [];
  for (const entry of entries) {
    const n = axisOf(entry.yaw), t = [Math.abs(n[1]), Math.abs(n[0])];
    const [x, y, z] = entry.point;
    // The zombie spawner that targets the barricade stands outside; otherwise face the player's side.
    const reference = entry.spawner ?? null;
    let inward = n;
    if (reference) inward = (x - reference[0]) * n[0] + (z - reference[2]) * n[1] >= 0 ? n : [-n[0], -n[1]];
    else inward = (spawn.position[0] - x) * n[0] + (spawn.position[2] - z) * n[1] >= 0 ? n : [-n[0], -n[1]];
    const floor = grid.nearest(x + inward[0] * 50, y - 32, z + inward[1] * 50, 3, 90);
    const base = { x, y: floor >= 0 ? grid.nodes[floor].y : y - 32, z, n: inward, t, width: WINDOW_WIDTH };
    // NZ:P zombies spawn at the spawn_zombie point tied to the barricade and walk to the window.
    if (reference) {
      const at = grid.nearest(reference[0], reference[1], reference[2], 3, 100);
      if (at >= 0 && Math.hypot(reference[0] - x, reference[2] - z) > 120) base.spawnPoint = [grid.nodes[at].x, grid.nodes[at].y + 2, grid.nodes[at].z];
    }
    windows.push(base);
  }
  for (const w of windows) footprint(grid, w);
  grid.recompute();
  const placed = windows.map(w => finishWindow(w, w.n));

  onStatus('Placing perks and the box…', .8);
  const sites = [];
  for (const entry of layout.sites) {
    if (!roles.includes(entry.role)) continue;
    const [x, y, z] = entry.point;
    let n = axisOf(entry.yaw);
    const probeNode = { x, y, z };
    let behind = wallDistance(probe, probeNode, -n[0], -n[1], 120);
    if (behind > 70) {
      // The facing did not line up with a wall behind the machine: back it against the nearest open wall.
      let best = null;
      for (const axis of AXES) {
        const wall = wallDistance(probe, probeNode, axis[0], axis[1], 120);
        const open = wallDistance(probe, probeNode, -axis[0], -axis[1], 200);
        if (wall < 70 && open > 80 && (!best || wall < best.wall)) best = { axis, wall };
      }
      if (best) { n = [-best.axis[0], -best.axis[1]]; behind = best.wall; }
    }
    const floor = grid.nearest(x + n[0] * 40, y, z + n[1] * 40, 3, 90);
    const floorY = floor >= 0 ? grid.nodes[floor].y : y;
    const reach = Math.min(Math.max(behind, 0), 60);
    sites.push({ role: entry.role, anchor: [x - n[0] * reach, z - n[1] * reach], normal: n, y: floorY, free: false });
  }

  return { grid, main, spawn, windows: placed, sites, doors, fromEntities: true };
}
