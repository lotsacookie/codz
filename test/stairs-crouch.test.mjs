import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { PlayerController } from '../export/web/player-controller.js';

function stairWorld({ steps, rise, tread = 22, width = 160, ceiling = false }) {
  const group = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(400, 10, width), new THREE.MeshBasicMaterial());
  floor.position.set(-150, -5, 0);
  group.add(floor);
  for (let i = 0; i < steps; i++) {
    const height = rise * (i + 1);
    const box = new THREE.Mesh(new THREE.BoxGeometry(tread, height, width), new THREE.MeshBasicMaterial());
    box.position.set(i * tread + tread / 2, height / 2, 0);
    group.add(box);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(300, 10, width), new THREE.MeshBasicMaterial());
  top.position.set(steps * tread + 150, rise * steps - 5, 0);
  group.add(top);
  if (ceiling) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(tread * steps + 100, 10, width), new THREE.MeshBasicMaterial());
    slab.position.set(tread * steps / 2, rise * steps + 85, 0);
    group.add(slab);
  }
  group.updateMatrixWorld(true);
  const octree = new Octree();
  octree.fromGraphNode(group);
  return octree;
}

function climb({ steps, rise, sprint = false, ceiling = false, options = {} }) {
  const world = stairWorld({ steps, rise, ceiling });
  const camera = new THREE.PerspectiveCamera();
  camera.rotation.order = 'YXZ';
  camera.rotation.y = -Math.PI / 2;
  const player = new PlayerController(camera, world, { radius: 14, height: 70, eyeHeight: 60, moveSpeed: 190, sprintSpeed: 285, gravity: 800, jumpHeight: 39, groundProbeDistance: 4, groundSnapSpeed: 10, spawn: new THREE.Vector3(-120, 0, 0), spawnIsEye: false, ...options });
  for (let i = 0; i < 60; i++) player.update(1 / 60, {});
  let elapsed = 0;
  while (elapsed < 8 && player.getFeetPosition().x < steps * 22 + 40) {
    camera.updateMatrixWorld(true);
    player.update(1 / 60, { forward: 1, sprint });
    elapsed += 1 / 60;
  }
  return { x: player.getFeetPosition().x, y: player.getFeetPosition().y, elapsed };
}

for (const rise of [8, 12, 16, 20, 24]) {
  test(`walks up stairs with ${rise} unit risers`, () => {
    const result = climb({ steps: 8, rise });
    assert.ok(result.x >= 8 * 22 + 40, `stopped at x=${result.x.toFixed(1)}`);
    assert.ok(Math.abs(result.y - rise * 8) < 4, `feet at y=${result.y.toFixed(1)}`);
  });
}

test('sprints up stairs and climbs under a low ceiling', () => {
  const sprint = climb({ steps: 8, rise: 16, sprint: true });
  assert.ok(sprint.x >= 8 * 22 + 40, `sprint stopped at x=${sprint.x.toFixed(1)}`);
  const low = climb({ steps: 8, rise: 12, ceiling: true });
  assert.ok(low.x >= 8 * 22 + 40, `low ceiling stopped at x=${low.x.toFixed(1)}`);
});

test('crouching eases the eye height instead of snapping', () => {
  const world = stairWorld({ steps: 1, rise: 4 });
  const camera = new THREE.PerspectiveCamera();
  const player = new PlayerController(camera, world, { radius: 14, height: 70, eyeHeight: 60, spawn: new THREE.Vector3(-120, 0, 0), spawnIsEye: false, groundProbeDistance: 4 });
  for (let i = 0; i < 60; i++) player.update(1 / 60, {});
  const standing = camera.position.y;
  player.update(1 / 60, { crouch: true });
  const first = camera.position.y;
  assert.ok(standing - first < 4, `eye dropped ${standing - first} in one frame`);
  for (let i = 0; i < 120; i++) player.update(1 / 60, { crouch: true });
  assert.ok(Math.abs(standing - camera.position.y - 20) < 1, `settled drop ${standing - camera.position.y}`);
  for (let i = 0; i < 120; i++) player.update(1 / 60, {});
  assert.ok(Math.abs(camera.position.y - standing) < 1);
});
