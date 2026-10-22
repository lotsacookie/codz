import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Grid } from '../export/web/assets/js/custom-maps/analyze.js';
import { createShangriNavigation, doorFootprint } from '../export/web/assets/js/shangri-la-grid.js';

function strip(cols) {
  const nodes = [];
  for (let col = 0; col < cols; col++) nodes.push({ x: col * 36, y: 0, z: 0, col, row: 0 });
  const grid = new Grid({ nodes, cell: 36, cols, rows: 1, minX: -18, minZ: -18 });
  for (let i = 0; i < cols - 1; i++) { grid.links[i].push(i + 1); grid.links[i + 1].push(i); }
  return grid;
}

function layoutFor(grid, doorBox) {
  const door = { ids: doorFootprint(grid, doorBox), center: doorBox.getCenter(new THREE.Vector3()), closed: true };
  const layout = { grid, blocked: new Uint16Array(grid.count), spawn: { position: [0, 2, 0] }, windows: [], doors: [door] };
  for (const i of door.ids) { layout.blocked[i]++; grid.alive[i] = 0; }
  grid.recompute();
  return layout;
}

test('door footprint covers the grid points inside the door box', () => {
  const grid = strip(10);
  const ids = doorFootprint(grid, new THREE.Box3(new THREE.Vector3(150, -10, -20), new THREE.Vector3(170, 40, 20)));
  assert.deepEqual(ids, [4, 5]);
});

test('closed doors split the zombie grid and opening or re-closing them rejoins or re-splits it', () => {
  const grid = strip(10);
  const box = new THREE.Box3(new THREE.Vector3(150, -10, -20), new THREE.Vector3(170, 40, 20));
  const layout = layoutFor(grid, box);
  const Nav = createShangriNavigation(() => layout);
  const nav = new Nav('./none');
  const a = new THREE.Vector3(0, 0, 0), b = new THREE.Vector3(324, 0, 0);
  assert.equal(nav.canReach(a, b), false);
  nav.setBlockers([]);
  assert.equal(nav.canReach(a, b), true);
  assert.ok(nav.arrives(nav.path(a, b), b));
  nav.setBlockers([box]);
  assert.equal(nav.canReach(a, b), false);
});

test('windows are chosen from the area the player is standing in', () => {
  const grid = strip(10);
  const box = new THREE.Box3(new THREE.Vector3(150, -10, -20), new THREE.Vector3(170, 40, 20));
  const layout = layoutFor(grid, box);
  const nav = new (createShangriNavigation(() => layout))('./none');
  const near = { id: 'near', inside: new THREE.Vector3(36, 0, 0) };
  const far = { id: 'far', inside: new THREE.Vector3(300, 0, 0) };
  assert.deepEqual(nav.viable([near, far], new THREE.Vector3(0, 0, 0)).map(w => w.id), ['near']);
  assert.deepEqual(nav.viable([near, far], new THREE.Vector3(324, 0, 0)).map(w => w.id), ['far']);
  assert.deepEqual(nav.viable([near, far]).map(w => w.id), ['near']);
});
