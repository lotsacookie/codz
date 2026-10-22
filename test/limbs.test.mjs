import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { limbBurstPower, findArmHit, amputate, popLimb, boneOf } from '../export/web/assets/js/gore.js';
import { LimbDebris } from '../export/web/assets/js/limbs.js';
import { BloodFx } from '../export/web/assets/js/blood.js';

const gun = (damage, extra = {}) => ({ damage, headMultiplier: 4, pellets: 1, explosionRadius: 0, projectileSpeed: 0, ...extra });

// A zombie whose left arm reaches out along +z: shoulder z=0, elbow z=12, wrist z=24 (x=-14, height 50).
function zombie() {
  const root = new THREE.Group();
  const add = (name, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); root.add(b); return b; };
  add('j_shoulder_le', -14, 50, 0); add('j_elbow_le', -14, 50, 12); add('j_wrist_le', -14, 50, 24);
  add('j_shoulder_ri', 14, 50, 0); add('j_elbow_ri', 14, 50, 12); add('j_wrist_ri', 14, 50, 24);
  root.updateMatrixWorld(true);
  return { kind: 'zombie', root };
}
const rayAlongZ = (x, from, dir) => new THREE.Ray(new THREE.Vector3(x, 50, from), new THREE.Vector3(0, 0, dir));
const fakeBlood = () => { const t = { image: { width: 8, height: 8 } }; return new BloodFx(new THREE.Scene(), { textures: { burst: t, drops: t, gush: t, burstTall: t, cloud: t, splat: t, trail: t } }); };

test('arms come off for strong guns only', () => {
  assert.equal(limbBurstPower(gun(20)), 0, 'M1911');
  assert.equal(limbBurstPower(gun(105)), 0, 'M14');
  assert.equal(limbBurstPower(gun(100)), 0, 'M16');
  assert.ok(limbBurstPower(gun(150)) > 0, 'Galil');
  assert.ok(limbBurstPower(gun(500)) > limbBurstPower(gun(150)));
  assert.equal(limbBurstPower(gun(160, { pellets: 8 }), 100) > 0, true);
  assert.equal(limbBurstPower(gun(160, { pellets: 8 }), 900), 0);
  assert.equal(limbBurstPower(gun(1000, { explosionRadius: 64, projectileSpeed: 3000 })), 0);
});

test('a ray finds the arm and says whether it hit the upper arm or the forearm', () => {
  const z = zombie();
  const upper = findArmHit(rayAlongZ(-14, -100, 1), z);
  assert.equal(upper.limb, 'arm_le');
  assert.equal(upper.cut, 'shoulder');
  const fore = findArmHit(rayAlongZ(-14, 100, -1), z);
  assert.equal(fore.cut, 'elbow');
  assert.equal(findArmHit(rayAlongZ(0, -100, 1), z), null, 'down the middle misses both arms');
  assert.equal(findArmHit(rayAlongZ(-14, 400, 1), z), null, 'ray pointing away');
  assert.equal(findArmHit(rayAlongZ(-14, -100, 1), { ...z, kind: 'dog' }), null);
});

test('bones are looked up once and cached', () => {
  const z = zombie();
  let calls = 0;
  const original = z.root.getObjectByName.bind(z.root);
  z.root.getObjectByName = n => { calls++; return original(n); };
  for (let i = 0; i < 50; i++) boneOf(z, 'j_elbow_le');
  boneOf(z, 'j_nothing'); boneOf(z, 'j_nothing');
  assert.equal(calls, 2);
});

test('amputating at the shoulder removes the whole arm, at the elbow only the forearm, never twice', () => {
  const z = zombie();
  const fore = amputate(z, 'arm_le', 'elbow');
  assert.ok(fore && Math.abs(fore.length - 12) < 0.01);
  assert.ok(boneBy(z, 'j_elbow_le').scale.x < 0.01);
  assert.equal(boneBy(z, 'j_shoulder_le').scale.x, 1);
  assert.equal(z.limbs.arm_le, 'forearm');
  assert.equal(amputate(z, 'arm_le', 'elbow'), null);
  const rest = amputate(z, 'arm_le', 'shoulder');
  assert.ok(rest && Math.abs(rest.length - 12) < 0.01, 'only the upper arm is left to fly off');
  assert.equal(z.limbs.arm_le, 'off');
  assert.equal(amputate(z, 'arm_le', 'shoulder'), null);
  assert.equal(findArmHit(rayAlongZ(-14, -100, 1), z), null, 'a gone arm cannot be hit again');
  assert.ok(findArmHit(rayAlongZ(14, -100, 1), z), 'the other arm still can');
  assert.equal(amputate(z, 'arm_xx', 'elbow'), null);
});
const boneBy = (z, n) => z.root.getObjectByName(n);

test('popLimb throws a stump spray and a flying arm, but not for weak guns or the same arm twice', () => {
  const blood = fakeBlood();
  const debris = new LimbDebris(new THREE.Scene());
  const z = zombie();
  const args = { blood, enemies: {}, debris, zombie: z, limb: 'arm_le', cut: 'shoulder', distance: 100, awayFrom: new THREE.Vector3(0, 50, -200) };
  assert.equal(popLimb({ ...args, def: gun(100) }), false);
  assert.equal(debris.items.length, 0);
  assert.equal(popLimb({ ...args, def: gun(300) }), true);
  assert.equal(debris.items.length, 1);
  assert.ok(blood.items.length > 80, 'lots of blood');
  assert.ok(blood.fountains.length >= 2, 'stump keeps pumping and the arm drips');
  assert.equal(popLimb({ ...args, def: gun(300) }), false);
  assert.equal(debris.items.length, 1);
});

test('flying arms fall, land on the floor, and shrink away; the pool never grows past its cap', () => {
  const scene = new THREE.Scene();
  const debris = new LimbDebris(scene, { max: 3 });
  const item = debris.spawn({ x: 0, y: 50, z: 0 }, { x: 40, y: 100, z: 0 }, 20, 0);
  let peak = item.mesh.position.y;
  for (let t = 0; t < 3; t += 1 / 60) { debris.update(1 / 60); peak = Math.max(peak, item.mesh.position.y); }
  assert.ok(peak > 50, 'thrown upward first');
  assert.ok(Math.abs(item.mesh.position.y - 1.5) < 0.01, 'resting on the floor');
  assert.equal(item.rest, true);
  for (let i = 0; i < 20; i++) debris.spawn({ x: i, y: 5, z: 0 }, { x: 0, y: 0, z: 0 }, 10, 0);
  assert.equal(debris.items.length, 3);
  assert.equal(debris.group.children.length, 3, 'meshes are reused');
  for (let t = 0; t < 9; t += 0.1) debris.update(0.1);
  assert.equal(debris.items.length, 0);
  debris.dispose();
});

test('blood sprites are pooled: no new sprites or materials after warm-up', () => {
  const realRandom = Math.random;
  Math.random = () => 0.5; // identical bursts, so any growth would be a leak
  try {
    const blood = fakeBlood();
    const warm = () => { blood.headBurst(new THREE.Vector3(0, 60, 0), { power: 3 }); for (let t = 0; t < 3; t += 0.05) blood.update(0.05); };
    warm();
    const sprites = blood.group.children.length;
    for (let i = 0; i < 10; i++) warm();
    assert.equal(blood.group.children.length, sprites);
    assert.equal(blood.items.length, 0);
    assert.equal(blood.pool.length, sprites);
  } finally {
    Math.random = realRandom;
  }
});

test('with real randomness the pool stays bounded and fully returns when idle', () => {
  const blood = fakeBlood();
  for (let i = 0; i < 40; i++) {
    blood.headBurst(new THREE.Vector3(0, 60, 0), { power: 1 + Math.random() * 2 });
    for (let t = 0; t < 3; t += 0.05) blood.update(0.05);
  }
  assert.ok(blood.group.children.length <= 400);
  assert.equal(blood.items.length, 0);
  assert.equal(blood.pool.length, blood.group.children.length);
});

test('the sprite cap holds under a pile-up of bursts', () => {
  const blood = fakeBlood();
  for (let i = 0; i < 30; i++) blood.headBurst(new THREE.Vector3(0, 60, 0), { power: 3 });
  blood.update(0.016);
  assert.ok(blood.items.length <= 400);
  assert.ok(blood.group.children.length <= 401);
});
