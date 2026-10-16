import fs from 'node:fs';
import path from 'node:path';
import { init, generateSoloNavMesh } from './lib/solo-navmesh.mjs';
import { exportNavMesh, NavMeshQuery } from '@recast-navigation/core';
import { spawnPoints } from '../export/web/shangri-la-rules.js';

const out = path.resolve(import.meta.dirname, '../export/web/shangri-la');
const data = JSON.parse(fs.readFileSync(path.join(out, 'map-data.json')));
const meta = JSON.parse(fs.readFileSync(path.join(out, 'collision.json')));
const binary = fs.readFileSync(path.join(out, 'collision.bin'));
const array = (name, Type) => new Type(binary.buffer, binary.byteOffset + meta.layout[name].byteOffset, meta.layout[name].count);
const src = array('position', Float32Array), ix = array('index', Uint32Array);
const anchors = data.entities.filter(e => e.classname === 'node_pathnode' || e.targetname === 'initial_spawn_points' || e.script_noteworthy === 'zombie_spawner' || e.targetname === 'exterior_goal' || e.targetname === 'player_respawn_point').map(e => e.position);
const cell = 256, grid = new Set();
for (const [x, y, z] of anchors) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) grid.add(`${Math.floor(x / cell) + dx},${Math.floor(y / cell) + dy},${Math.floor(z / cell) + dz}`);
const near = v => grid.has(`${Math.floor(src[v * 3] / cell)},${Math.floor(src[v * 3 + 1] / cell)},${Math.floor(src[v * 3 + 2] / cell)}`);
const positions = [], indices = [], used = new Map();
for (let i = 0; i < ix.length; i += 3) {
  if (!near(ix[i]) && !near(ix[i + 1]) && !near(ix[i + 2])) continue;
  for (let k = 0; k < 3; k++) {
    const v = ix[i + k];
    if (!used.has(v)) { used.set(v, positions.length / 3); positions.push(src[v * 3], src[v * 3 + 1], src[v * 3 + 2]); }
    indices.push(used.get(v));
  }
}
await init();
const config = { cs: 4, ch: 2, walkableSlopeAngle: 55, walkableHeight: 35, walkableClimb: 18, walkableRadius: 3, maxEdgeLen: 48, maxSimplificationError: 1.3, minRegionArea: 8, mergeRegionArea: 20, maxVertsPerPoly: 6, detailSampleDist: 6, detailSampleMaxError: 1 };
const result = generateSoloNavMesh(new Float32Array(positions), new Uint32Array(indices), config);
fs.writeFileSync(path.join(out, 'navigation.bin'), exportNavMesh(result.navMesh));
const query = new NavMeshQuery(result.navMesh, { maxNodes: 8192 });
query.defaultQueryHalfExtents = { x: 50, y: 80, z: 50 };
const snap = (position, limit) => { const r = query.findClosestPoint({ x: position[0], y: position[1], z: position[2] }); return r.success && Math.hypot(r.point.x - position[0], r.point.y - position[1], r.point.z - position[2]) < limit ? [r.point.x, r.point.y, r.point.z] : null; };
const candidates = [];
for (const e of data.entities.filter(e => e.classname === 'node_pathnode')) { const p = snap(e.position, 70); if (p) candidates.push({ entity: e.id, kind: 'node', position: p }); }
for (const s of spawnPoints(data.entities)) { const p = snap(s.position, 90); if (p) candidates.push({ entity: s.id, kind: 'spawner', position: p }); }
const start = snap(data.spawn.position, 120);
if (!start) throw new Error('No navigation at the player spawn');
fs.writeFileSync(path.join(out, 'navigation.json'), JSON.stringify({ config, triangles: indices.length / 3, polygons: result.polygons, start, candidates }));
console.log('Shangri-La navigation:', indices.length / 3, 'triangles,', result.polygons, 'polygons,', candidates.length, 'spawn candidates');
