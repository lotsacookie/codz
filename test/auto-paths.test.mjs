import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AutoPaths } from '../export/web/assets/js/auto-paths.js';

// A flat floor split by a wall at x=200 with one doorway (z 0..110). Everything is an axis-aligned box.
function level({ door = true } = {}) {
  const boxes = [
    { floor: true, box: new THREE.Box3(new THREE.Vector3(-600, -10, -600), new THREE.Vector3(800, 0, 600)) },
    { box: new THREE.Box3(new THREE.Vector3(190, 0, -600), new THREE.Vector3(210, 200, door ? 0 : 600)) },
    ...(door ? [{ box: new THREE.Box3(new THREE.Vector3(190, 0, 110), new THREE.Vector3(210, 200, 600)) }] : []),
  ];
  const world = {
    raycast(ray, near = 0, far = Infinity) {
      let best = null;
      for (const { box, floor } of boxes) {
        const point = ray.intersectBox(box, new THREE.Vector3());
        if (!point) continue;
        const distance = point.distanceTo(ray.origin);
        if (distance < near || distance > far || best && best.distance <= distance) continue;
        best = { distance, position: point, point, triangle: { getNormal: v => v.set(floor ? 0 : 1, floor ? 1 : 0, 0) } };
      }
      return best ?? false;
    },
  };
  return world;
}
const crossesWall = (a, b) => (a.x < 190 && b.x > 210) || (a.x > 210 && b.x < 190) ? Math.abs(a.z + (b.z - a.z) * (200 - a.x) / (b.x - a.x) - 55) > 55 : false;

test('auto paths map the level and route through the doorway, never through the wall', async () => {
  const paths = new AutoPaths(level(), { budgetMs: 8000 });
  const stats = await paths.build(new THREE.Vector3(0, 0, 300));
  assert.ok(stats.nodes > 50, `mapped ${stats.nodes} nodes`);
  const from = new THREE.Vector3(60, 0, 300), to = new THREE.Vector3(420, 0, 300);
  const route = paths.path(from, to);
  assert.ok(route.length >= 3, 'found a route');
  assert.ok(route.at(-1).distanceTo(to) < 60, 'ends at the goal');
  for (let i = 1; i < route.length; i++) assert.equal(crossesWall(route[i - 1], route[i]), false, `segment ${i} stays out of the wall`);
  assert.ok(route.some(p => p.x > 170 && p.x < 230 && p.z > -5 && p.z < 115), 'goes through the doorway');
});

test('a sealed wall (closed door) leaves the far side unmapped, so no route exists', async () => {
  const paths = new AutoPaths(level({ door: false }), { budgetMs: 8000 });
  await paths.build(new THREE.Vector3(0, 0, 300));
  assert.equal(paths.contains(new THREE.Vector3(420, 0, 300)), false);
  assert.deepEqual(paths.path(new THREE.Vector3(60, 0, 300), new THREE.Vector3(420, 0, 300)), []);
});

test('stepClear rejects a step into the wall and allows open ground', async () => {
  const paths = new AutoPaths(level());
  assert.equal(paths.stepClear(new THREE.Vector3(180, 0, 300), new THREE.Vector3(215, 0, 300)), false);
  assert.equal(paths.stepClear(new THREE.Vector3(100, 0, 300), new THREE.Vector3(120, 0, 300)), true);
});
