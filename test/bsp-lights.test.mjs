import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { addMapLights, packLights, selectViewLights, lightReach, POOL_DESKTOP } from '../export/web/assets/js/custom-maps/lights.js';
import { windingSide } from '../export/web/assets/js/custom-maps/bsp.js';

function camera(x = 0, y = 0, z = 0, yaw = 0) {
  const cam = new THREE.PerspectiveCamera(78, 16 / 9, 1, 5000);
  cam.position.set(x, y, z);
  cam.rotation.set(0, yaw, 0);
  cam.updateMatrixWorld();
  return cam;
}

function planesOf(cam) {
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const planes = new Float32Array(24);
  frustum.planes.forEach((p, i) => { planes.set([p.normal.x, p.normal.y, p.normal.z, p.constant], i * 4); });
  return planes;
}

// A ring of lights 3000 units out, default intensity (reach 660), so only the ones ahead touch the view.
function ring(count = 40) {
  return Array.from({ length: count }, (_, k) => {
    const angle = (k / count) * Math.PI * 2;
    return { point: [Math.sin(angle) * 3000, 0, -Math.cos(angle) * 3000], color: [1, 1, 1], intensity: 300 };
  });
}

test('lights the camera looks at are chosen before nearer lights behind it', () => {
  const lights = [
    { point: [0, 0, 400], color: [1, 1, 1], intensity: 50 },    // behind the camera, nearer, reach 160
    { point: [0, 0, -1500], color: [1, 1, 1], intensity: 300 }, // far ahead, in view
  ];
  const cam = camera();
  const out = new Int32Array(1);
  const count = selectViewLights(packLights(lights), planesOf(cam), cam.position, 1, out);
  assert.equal(count, 1);
  assert.equal(out[0], 1);
});

test('a spare slot falls back to the nearest light outside the view', () => {
  const lights = [
    { point: [0, 0, 300], color: [1, 1, 1], intensity: 50 },
    { point: [0, 0, -300], color: [1, 1, 1], intensity: 50 },
    { point: [0, 0, 900], color: [1, 1, 1], intensity: 50 },
  ];
  const cam = camera();
  const out = new Int32Array(3);
  const count = selectViewLights(packLights(lights), planesOf(cam), cam.position, 3, out);
  assert.equal(count, 3);
  assert.deepEqual([...out], [1, 0, 2]);
});

test('selection follows the view as the camera turns', () => {
  const lights = ring();
  const packed = packLights(lights);
  const out = new Int32Array(8);
  const seen = yaw => {
    const cam = camera(0, 0, 0, yaw);
    const count = selectViewLights(packed, planesOf(cam), cam.position, 8, out);
    return [...out.slice(0, count)];
  };
  const facingNorth = seen(0), facingSouth = seen(Math.PI);
  assert.equal(facingNorth.length, 8);
  // Light k sits at angle k / 40 of a turn clockwise from north: 0 is dead ahead, 20 dead behind.
  const ahead = k => k <= 9 || k >= 31, behind = k => k >= 11 && k <= 29;
  assert.ok(facingNorth.every(ahead), 'looking north only lights in the north are used');
  assert.ok(facingSouth.every(behind), 'after turning round only lights in the south are used');
});

test('the pool never exceeds its size and never repeats a light', () => {
  const packed = packLights(ring(200));
  const cam = camera(10, 5, 10, 1);
  const out = new Int32Array(16);
  const count = selectViewLights(packed, planesOf(cam), cam.position, 16, out);
  assert.equal(count, 16);
  assert.equal(new Set(out).size, 16);
});

test('lights already in the pool resist near-equal swaps', () => {
  const lights = [
    { point: [0, 0, -400], color: [1, 1, 1], intensity: 300 },
    { point: [0, 0, -380], color: [1, 1, 1], intensity: 300 },
  ];
  const cam = camera();
  const out = new Int32Array(1);
  selectViewLights(packLights(lights), planesOf(cam), cam.position, 1, out, new Set([0]));
  assert.equal(out[0], 0);
});

test('lightReach keeps the original range formula', () => {
  assert.equal(lightReach(300), 660);
  assert.equal(lightReach(10), 160);
});

test('addMapLights keeps a fixed pool and relights as the camera moves and turns', () => {
  const scene = new THREE.Scene();
  const group = addMapLights(scene, ring(60), { pool: 8 });
  assert.ok(POOL_DESKTOP > 8);
  const lamps = group.children.filter(c => c.isPointLight);
  assert.equal(lamps.length, 8);
  const cam = camera();
  group.userData.updateLights(cam, 1000);
  const first = lamps.map(l => l.position.toArray().join());
  assert.ok(lamps.every(l => l.intensity > 0));
  // Same view straight away: nothing to recompute.
  group.userData.updateLights(cam, 1010);
  assert.deepEqual(lamps.map(l => l.position.toArray().join()), first);
  // Turn round: lights are reassigned, still exactly 8 lamps.
  const behind = camera(0, 0, 0, Math.PI);
  group.userData.updateLights(behind, 2000);
  assert.notDeepEqual(lamps.map(l => l.position.toArray().join()), first);
  assert.equal(group.children.filter(c => c.isPointLight).length, 8);
});

test('windingSide tells front-facing from back-facing triangles', () => {
  const up = [0, 0, 1];
  assert.equal(windingSide([0, 0, 0], [1, 0, 0], [0, 1, 0], up), 1);
  assert.equal(windingSide([0, 0, 0], [0, 1, 0], [1, 0, 0], up), -1);
  assert.equal(windingSide([0, 0, 0], [0, 1, 0], [1, 0, 0], up, true), 1);
  assert.equal(windingSide([0, 0, 0], [1, 0, 0], [2, 0, 0], up), 0);
});
