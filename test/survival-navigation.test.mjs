import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SurvivalNavigation } from '../export/web/shangri-la-navigation.js';

// Open floor with a wall at x=200 and a doorway (z 0..110); no baked navmesh at all.
const boxes = [
  { floor: true, box: new THREE.Box3(new THREE.Vector3(-600, -10, -600), new THREE.Vector3(800, 0, 600)) },
  { box: new THREE.Box3(new THREE.Vector3(190, 0, -600), new THREE.Vector3(210, 200, 0)) },
  { box: new THREE.Box3(new THREE.Vector3(190, 0, 110), new THREE.Vector3(210, 200, 600)) },
];
const raycast = (ray, near = 0, far = Infinity) => {
  let best = null;
  for (const { box, floor } of boxes) {
    const point = ray.intersectBox(box, new THREE.Vector3());
    const distance = point?.distanceTo(ray.origin);
    if (!point || distance < near || distance > far || best && best.distance <= distance) continue;
    best = { distance, position: point, point, triangle: { getNormal: v => v.set(floor ? 0 : 1, floor ? 1 : 0, 0) } };
  }
  return best ?? false;
};

test('with no baked mesh the level is mapped before the round and unreachable barricades are excluded', async () => {
  const nav = new SurvivalNavigation('./missing');
  nav.metadata = { candidates: [] };            // load() was never called: no baked mesh
  const barriers = [
    { id: 1, inside: new THREE.Vector3(420, 0, 300) },     // other side of the wall, reachable through the doorway
    { id: 2, inside: new THREE.Vector3(3000, 0, 3000) },   // outside the level
  ];
  nav.attach({ raycast }, { start: new THREE.Vector3(0, 0, 300), barriers });
  const status = [];
  const health = await nav.prepare({ onStatus: s => status.push(s) });
  assert.equal(health.baked, false);
  assert.equal(health.mapped, true);
  assert.deepEqual(nav.viable(barriers).map(b => b.id), [1]);
  assert.ok(status.some(s => /Mapping/.test(s)));
  const route = nav.autoPath(new THREE.Vector3(420, 0, 300), new THREE.Vector3(0, 0, 300));
  assert.ok(nav.arrives(route, new THREE.Vector3(0, 0, 300)));
  assert.equal(nav.canReach(barriers[1].inside, new THREE.Vector3(0, 0, 300)), false);
  assert.equal(nav.stepClear(new THREE.Vector3(180, 0, 300), new THREE.Vector3(215, 0, 300)), false);
});
