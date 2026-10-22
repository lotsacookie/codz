import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { MoonState, environmentAt } from '../export/web/assets/js/moon-rules.js';
import { deserializeCollisionWorld } from '../export/web/assets/js/collision-world.js';

const out = new URL('../export/web/assets/moon/', import.meta.url);
const data = JSON.parse(fs.readFileSync(new URL('map-data.json', out)));
const location = key => data.entities[data.landmarks[key].entity].position;

test('Moon atmosphere follows power and source player volumes, including Earth', () => {
  assert.equal(environmentAt(data, location('area51'), false, false).gravity, 800);
  assert.equal(environmentAt(data, location('receiving'), false, true).gravity, 136);
  assert.equal(environmentAt(data, location('receiving'), false, true).breathable, false);
  assert.equal(environmentAt(data, location('receiving'), true, true).breathable, true);
  assert.equal(environmentAt(data, location('power'), true, true).gravity, 136);
  assert.equal(environmentAt(data, location('biodome'), true, true).gravity, 800);
});
test('P.E.S. prevents the source 15-second suffocation deadline and resets exposure', () => {
  const state = new MoonState(data.rules), vacuum = {breathable: false};
  state.toggleSuit(); assert.equal(state.suit, false);
  assert.equal(state.update(14.9, vacuum).suffocated, undefined);
  state.equipSuit(); state.update(30, vacuum); assert.equal(state.exposure, 0);
  state.toggleSuit(); assert.equal(state.update(15, vacuum).suffocated, true);
  state.update(.1, {breathable: true}); assert.equal(state.exposure, 0);
});
test('Teleporter requires uninterrupted pad contact, then imposes a cooldown', () => {
  const state = new MoonState(data.rules), air = {breathable: true};
  state.update(0, air, 'nml_teleporter'); state.update(2, air, 'nml_teleporter');
  state.update(.1, air, null); assert.equal(state.teleport, null);
  state.update(0, air, 'nml_teleporter');
  assert.equal(state.update(2.5, air, 'nml_teleporter').teleport, 'nml_teleporter');
  state.update(.5, air, 'generator_teleporter'); assert.equal(state.teleport, null);
});
test('Every recovered Moon door resolves physical moving parts', () => {
  assert.equal(data.doors.length, 13);
  for (const door of data.doors) {
    assert.ok(door.parts.length > 0, door.name);
    for (const id of door.parts) assert.ok(data.entities[id].move, 'Missing slide vector: ' + id);
  }
});
test('Composed Moon includes all static placements and diffuse boulder textures', () => {
  const composition = JSON.parse(fs.readFileSync(new URL('composition.json', out)));
  assert.equal(composition.staticInstances, 5939);
  assert.deepEqual(composition.missingModels, ['tag_origin']);
  const doc = JSON.parse(fs.readFileSync(new URL('moon.gltf', out)));
  const boulders = doc.materials.filter(m => m.name.includes('mtl_p_zom_moon_boulder'));
  assert.ok(boulders.length >= 3);
  for (const m of boulders) {
    const texture = doc.textures[m.pbrMetallicRoughness.baseColorTexture.index];
    assert.match(doc.images[texture.source].uri, /p_zom_moon_boulders_c/);
  }
});
test('Baked collision supports the four native preview destinations', () => {
  const metadata = JSON.parse(fs.readFileSync(new URL('collision.json', out)));
  const binary = fs.readFileSync(new URL('collision.bin', out));
  const collision = deserializeCollisionWorld(metadata, binary.buffer.slice(binary.byteOffset, binary.byteOffset+binary.byteLength));
  for (const key of Object.keys(data.landmarks)) {
    const origin = new THREE.Vector3(...location(key)).add(new THREE.Vector3(0, 8, 0));
    const hit = collision.rayIntersect(new THREE.Ray(origin, new THREE.Vector3(0, -1, 0)), 0, 96);
    assert.ok(hit, 'No floor at ' + key);
    assert.ok(hit.triangle.getNormal(new THREE.Vector3()).y > .5, 'Non-walkable floor at ' + key);
  }
});
