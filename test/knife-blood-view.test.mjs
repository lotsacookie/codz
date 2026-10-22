import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { KnifeBlood, tipToView, viewEmitter } from '../export/web/knife-blood.js';
import { BloodFx } from '../export/web/blood.js';

function texture(width = 256, height = 256) {
  const t = new THREE.Texture();
  t.image = { width, height };
  return t;
}

function blood() {
  const t = texture();
  return new BloodFx(new THREE.Scene(), { textures: { burst: t, drops: texture(), gush: texture(), burstTall: t, cloud: texture(64, 64), splat: texture(), trail: texture(512, 128) } });
}

function lookedCamera(yaw) {
  const camera = new THREE.PerspectiveCamera();
  camera.rotation.y = yaw;
  camera.position.set(10, 5, -3);
  camera.updateMatrixWorld(true);
  return camera;
}

test('tip motion is measured in view space so turning the camera adds no blood motion', () => {
  const kb = new KnifeBlood({ random: () => 0.5 });
  kb.soak();
  const out = [];
  for (let i = 0; i < 30; i++) {
    const camera = lookedCamera(i * 0.2);
    const tip = new THREE.Vector3(0, 0, -26).applyMatrix4(camera.matrixWorld);
    kb.update(1 / 60, tipToView(camera, tip), (p, v, k, speed) => out.push(speed));
  }
  assert.ok(out.every(speed => speed < 1e-6), `camera turning counted as blade speed: ${Math.max(...out)}`);
});

test('streaks follow the blade swing on screen whatever way the camera faces', () => {
  for (const yaw of [0, 1.1, -2.4]) {
    const camera = lookedCamera(yaw);
    const fx = blood();
    const kb = new KnifeBlood({ random: () => 0.5 });
    kb.soak();
    const emit = viewEmitter(camera, (p, v, k, speed, heading) => fx.fling(p, v, k, camera, speed, heading));
    for (let i = 0; i < 12; i++) kb.update(1 / 60, { x: i * 8, y: 0, z: -26 }, emit);
    const streaks = fx.items.filter(item => item.aspect === 4);
    assert.ok(streaks.length > 0, `yaw ${yaw}`);
    for (const streak of streaks) assert.ok(Math.abs(Math.abs(streak.material.rotation) - Math.PI) < 1e-6, `yaw ${yaw}: ${streak.material.rotation}`);
  }
});

test('a vertical swing streaks vertically and a still blade only drips', () => {
  const camera = lookedCamera(0.7);
  const fx = blood();
  const kb = new KnifeBlood({ random: () => 0.5 });
  kb.soak();
  const emit = viewEmitter(camera, (p, v, k, speed, heading) => fx.fling(p, v, k, camera, speed, heading));
  for (let i = 0; i < 12; i++) kb.update(1 / 60, { x: 0, y: i * 8, z: -26 }, emit);
  const streaks = fx.items.filter(item => item.aspect === 4);
  assert.ok(streaks.length > 0);
  for (const streak of streaks) assert.ok(Math.abs(streak.material.rotation + Math.PI / 2) < 1e-6, `${streak.material.rotation}`);
  fx.clear();
  const still = new KnifeBlood({ random: () => 0.5 });
  still.soak();
  for (let i = 0; i < 30; i++) still.update(1 / 60, { x: 0, y: 0, z: -26 }, emit);
  assert.equal(fx.items.filter(item => item.aspect === 4).length, 0);
  assert.ok(fx.items.length > 0);
});

test('the trail sheet is anchored with its thick end on the blade', () => {
  const camera = lookedCamera(0);
  camera.position.set(0, 0, 0);
  camera.updateMatrixWorld(true);
  const fx = blood();
  fx.fling({ x: 0, y: 0, z: -26 }, { x: -20, y: 0, z: 0 }, 1, camera, 400, { x: -1, y: 0, z: 0 });
  const streak = fx.items.find(item => item.aspect === 4);
  assert.ok(streak.sprite.position.x < 0);
  assert.ok(Math.abs(streak.velocity.x + 14) < 1e-6);
});
