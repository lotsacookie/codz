import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { BloodFx } from '../export/web/blood.js';
import { LimbDebris } from '../export/web/limbs.js';

const web = new URL('../export/web/', import.meta.url);

function texture(width = 256, height = 256) {
  const t = new THREE.Texture();
  t.image = { width, height };
  return t;
}

function blood() {
  const t = texture();
  return new BloodFx(new THREE.Scene(), { textures: { burst: t, drops: texture(), gush: texture(), burstTall: t, cloud: texture(64, 64), splat: texture(), trail: texture(256, 64) } });
}

test('sheet textures are cut into their reference frames and masks are tinted red', () => {
  const fx = blood();
  assert.equal(fx.frames.splat.length, 16);
  assert.equal(fx.frames.drops.length, 4);
  assert.equal(fx.frames.gush.length, 2);
  assert.deepEqual([fx.frames.splat[5].repeat.x, fx.frames.splat[5].repeat.y], [0.25, 0.25]);
  assert.equal(fx.aspects.splat, 1);
  const splat = fx.emit('splat', 0, 0, 0, 10, 1, 0, 0, 0);
  assert.equal(splat.material.color.getHex(), 0x7a1313);
  assert.ok(fx.frames.splat.includes(splat.material.map));
  const cloud = fx.emit('cloud', 0, 0, 0, 10, 1, 0, 0, 0);
  assert.equal(cloud.material.color.getHex(), 0xd01c1c);
  const drops = fx.emit('drops', 0, 0, 0, 3, 1, 0, 0, 0);
  assert.equal(drops.material.color.getHex(), 0xffffff);
  assert.ok(fx.frames.drops.includes(drops.material.map));
});

test('head burst adds the delayed neck spurt from the reference script', () => {
  const fx = blood();
  fx.headBurst(new THREE.Vector3(0, 60, 0), { power: 1 });
  const spurt = fx.fountains.find(f => f.delay > 0);
  assert.ok(spurt);
  assert.equal(spurt.delay, 0.3);
  const before = fx.items.length;
  fx.update(0.1);
  assert.equal(spurt.age, 0);
  for (let t = 0; t < 0.6; t += 0.05) fx.update(0.05);
  assert.ok(spurt.age > 0);
  assert.ok(before > 0);
});

test('knife blood leaves thick streaks aligned with the blade path', () => {
  const fx = blood();
  const camera = new THREE.PerspectiveCamera();
  camera.updateMatrixWorld(true);
  fx.fling({ x: 0, y: 0, z: -10 }, { x: -20, y: 0, z: 0 }, 1, camera);
  const streak = fx.items.find(item => item.aspect === 4);
  assert.ok(streak, 'a bloodtrail streak was emitted');
  assert.ok(streak.size >= 8, `thick streak: ${streak.size}`);
  assert.ok(Math.abs(Math.abs(streak.material.rotation) - Math.PI) < 1e-6);
  fx.clear();
  fx.slash({ x: 0, y: 0, z: -10 }, { x: 0, y: 1, z: 0 }, camera);
  const slashed = fx.items.filter(item => item.aspect === 4);
  assert.equal(slashed.length, 3);
  assert.ok(slashed.every(item => item.size >= 20));
  assert.ok(slashed.every(item => Math.abs(item.material.rotation - Math.PI / 2) < 1e-6));
});

test('flying limbs use the reference limbs texture region instead of flat colours', () => {
  const debris = new LimbDebris(new THREE.Scene());
  const uv = debris.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    assert.ok(uv.getX(i) >= 0.54 && uv.getX(i) <= 0.981, `u ${uv.getX(i)}`);
    assert.ok(uv.getY(i) >= 0.39 && uv.getY(i) <= 0.99, `v ${uv.getY(i)}`);
  }
  assert.equal(debris.geometry.attributes.color, undefined);
  for (const dir of ['textures', 'textures-mobile']) {
    assert.ok(existsSync(new URL(`${dir}/~-glimbs_c.png`, web)), `${dir}/~-glimbs_c.png`);
    assert.ok(existsSync(new URL(`${dir}/fxt_bio_bloodtrail.png`, web)), `${dir}/fxt_bio_bloodtrail.png`);
  }
  debris.dispose();
});
