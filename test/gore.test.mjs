import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { headBurstPower, decapitate, popHead } from '../export/web/gore.js';
import { BloodFx } from '../export/web/blood.js';

const gun = (damage, headMultiplier, extra = {}) => ({ damage, headMultiplier, pellets: 1, explosionRadius: 0, projectileSpeed: 0, ...extra });

test('low powered guns leave the head on, high powered guns blow it off', () => {
  assert.equal(headBurstPower(gun(20, 3.5)), 0, 'M1911');
  assert.equal(headBurstPower(gun(100, 4)), 0, 'M16');
  assert.ok(headBurstPower(gun(150, 4)) > 0, 'Galil');
  assert.ok(headBurstPower(gun(300, 10)) > 0, 'Dragunov');
  assert.ok(headBurstPower(gun(1000, 1.5)) > 0, 'Python');
});

test('bigger guns burst harder, capped at 3', () => {
  assert.ok(headBurstPower(gun(500, 10)) > headBurstPower(gun(150, 4)));
  assert.equal(headBurstPower(gun(500, 10)), 3);
});

test('shotguns only pop heads up close, rockets and rays never do', () => {
  const shotgun = gun(160, 1, { pellets: 8 });
  assert.ok(headBurstPower(shotgun, 100) > 0);
  assert.equal(headBurstPower(shotgun, 900), 0);
  assert.equal(headBurstPower(gun(80, 1, { pellets: 8 }), 100), 0, 'weak shotgun');
  assert.equal(headBurstPower(gun(1000, 4, { explosionRadius: 64, projectileSpeed: 3200 })), 0);
  assert.equal(headBurstPower(null), 0);
});

test('decapitating shrinks the head bone once', () => {
  const root = new THREE.Group();
  const head = new THREE.Bone();
  head.name = 'j_head';
  root.add(head);
  const z = { root };
  assert.equal(decapitate(z), true);
  assert.ok(head.scale.x < 0.01);
  assert.equal(decapitate(z), false);
  assert.equal(decapitate({ root: new THREE.Group() }), false, 'no head bone');
});

function fakeBlood() {
  const tex = { image: { width: 64, height: 64 } };
  return new BloodFx(new THREE.Scene(), { textures: { burst: tex, drops: tex, gush: tex, burstTall: tex, cloud: tex, splat: tex, trail: tex } });
}

test('a head burst throws a bunched column of blood upward and keeps pumping', () => {
  const blood = fakeBlood();
  blood.headBurst(() => new THREE.Vector3(0, 60, 0), { power: 2 });
  const initial = blood.items.length;
  assert.ok(initial > 40, `lots of blood: ${initial}`);
  const columns = blood.items.filter(i => i.velocity.y > 60);
  assert.ok(columns.length > initial * 0.7, 'mostly shooting up');
  const spread = Math.max(...columns.map(i => Math.hypot(i.velocity.x, i.velocity.z)));
  assert.ok(spread < 40, 'bunched tightly, not a wide spray');
  blood.update(0.1);
  assert.ok(blood.items.length > initial * 0.8);
  for (let t = 0; t < 2; t += 0.05) blood.update(0.05);
  assert.equal(blood.fountains.length, 0);
  assert.equal(blood.items.length, 0, 'everything fades out');
});

test('popHead only bursts for strong guns on a real head and clears with the blood', () => {
  const blood = fakeBlood();
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'j_head';
  root.add(bone);
  const enemies = { headPosition: () => new THREE.Vector3(0, 63, 0) };
  const weak = popHead({ blood, enemies, zombie: { root }, def: gun(100, 4) });
  assert.equal(weak, false);
  assert.equal(blood.items.length, 0);
  const strong = popHead({ blood, enemies, zombie: { root }, def: gun(300, 10) });
  assert.equal(strong, true);
  assert.ok(blood.items.length > 40);
  blood.clear();
  assert.equal(blood.fountains.length, 0);
});
