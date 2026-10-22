import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Enemies } from '../export/web/assets/js/enemies.js';
import { Grid } from '../export/web/assets/js/custom-maps/analyze.js';
import { createGridNavigation } from '../export/web/assets/js/custom-maps/runtime.js';

function fakeZombie(id) {
  const root = new THREE.Group();
  root.position.set(id * 40, 0, 0);
  return { id, kind: 'zombie', state: 'chase', root, health: 100, path: [], pathIndex: 0, repath: 0, growl: 99, stuck: 0, lastPosition: root.position.clone(), speed: 40, heading: null, attackLeft: 0, rig: { update() {}, play() {}, mixer: {} } };
}

function setup(budget) {
  const session = { phase: 'fighting', corePhase: 'fighting', total: 99, spawned: 5, round: 1, time: 0, dogRound: false, random: Math.random, power: true };
  let calls = 0;
  const world = { path: () => { calls++; const end = performance.now() + 2; while (performance.now() < end); return []; }, lineClear: () => false, closest: () => null };
  const enemies = new Enemies(new THREE.Scene(), world, { rules: {} }, session, { damage() {}, kill() {}, hit() {} });
  enemies.autoSpawn = false;
  enemies.autoRounds = false;
  if (budget) enemies.routeBudgetMs = budget;
  for (let i = 0; i < 6; i++) enemies.list.push(fakeZombie(i));
  return { enemies, calls: () => calls };
}

test('without a budget every due zombie routes in the same frame', () => {
  const { enemies, calls } = setup(0);
  enemies.update(.016, new THREE.Vector3(500, 0, 0));
  assert.equal(calls(), 6);
});

test('with a routing budget only some zombies route per frame and the rest follow on later frames', () => {
  const { enemies, calls } = setup(3);
  const player = new THREE.Vector3(500, 0, 0);
  enemies.update(.016, player);
  const first = calls();
  assert.ok(first >= 1 && first < 6, `routed ${first}`);
  for (let i = 0; i < 6; i++) enemies.update(.016, player);
  assert.ok(calls() >= 6);
});

test('grid routes go around a wall and equal-cost ties still resolve', () => {
  const cols = 7, rows = 5, nodes = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!(c === 3 && r < 4)) nodes.push({ x: c * 36 + 18, y: 0, z: r * 36 + 18, col: c, row: r });
  const grid = new Grid({ nodes, cell: 36, cols, rows, minX: 0, minZ: 0 });
  nodes.forEach((a, i) => nodes.forEach((b, j) => { if (i < j && Math.abs(a.col - b.col) <= 1 && Math.abs(a.row - b.row) <= 1) { grid.links[i].push(j); grid.links[j].push(i); } }));
  grid.recompute();
  const Nav = createGridNavigation(() => ({ grid, spawn: { position: [18, 0, 18] }, windows: [] }));
  const nav = new Nav('./x');
  const a = new THREE.Vector3(18, 0, 18), b = new THREE.Vector3(6 * 36 + 18, 0, 18);
  const route = nav.route(a, b);
  assert.ok(route.length >= 3);
  assert.ok(route.some(p => p.z > 4 * 36));
  assert.ok(route.at(-1).distanceTo(b) < 1);
  assert.equal(nav.route(a, b).length, route.length);
});
