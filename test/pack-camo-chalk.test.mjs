import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { loadAtlas } from '../export/web/fx-atlas.js';
import { createMuzzleFlash, MuzzleSmoke, flashTint } from '../export/web/muzzle-fx.js';
import { weaponFxProfile } from '../export/web/fx-profile.js';
import { applyPackCamo, isCamoTarget, patchPackCamo } from '../export/web/pack-camo.js';
import { chalkMarkup } from '../export/web/hud.js';

const web = new URL('../export/web/', import.meta.url);

test('chalk tally marks use the reference chalkmarks images that exist on disk', () => {
  for (let n = 1; n <= 5; n++) {
    assert.ok(existsSync(new URL(`textures/chalkmarks_${n}.png`, web)), `textures/chalkmarks_${n}.png`);
    assert.ok(existsSync(new URL(`textures-mobile/chalkmarks_${n}.png`, web)), `textures-mobile/chalkmarks_${n}.png`);
  }
  const marks = round => chalkMarkup(round).map(html => html.match(/chalkmarks_(\d)/)?.[1] ?? null);
  assert.deepEqual(marks(1), ['1', null]);
  assert.deepEqual(marks(4), ['4', null]);
  assert.deepEqual(marks(5), ['5', null]);
  assert.deepEqual(marks(6), ['5', '1']);
  assert.deepEqual(marks(10), ['5', '5']);
  assert.match(chalkMarkup(11)[0], /chalk-num/);
});

test('fx profile marks upgraded weapons', () => {
  assert.equal(weaponFxProfile({ id: 'm14_zm' }).upgraded, false);
  assert.equal(weaponFxProfile({ id: 'm14_zm', upgraded: true }).upgraded, true);
  assert.equal(flashTint({ upgraded: true }), 1);
  assert.equal(flashTint({ upgraded: false }), 0);
  assert.equal(flashTint(null), 0);
});

test('pack-a-punch muzzle flash turns purple and normal flash does not', () => {
  const atlas = loadAtlas('textures/fxt_fire_gas_flash.png', 2);
  atlas.frames.push(new THREE.Texture(), new THREE.Texture());
  const flash = createMuzzleFlash(new THREE.Object3D());
  flash.fire({ size: 6, upgraded: false });
  assert.equal(flash.group.visible, true);
  assert.equal(flash.burst.material.userData.uniforms.uPap.value, 0);
  flash.fire({ size: 6, upgraded: true });
  assert.equal(flash.burst.material.userData.uniforms.uPap.value, 1);
  flash.update(1);
  assert.equal(flash.group.visible, false);
  flash.dispose();
  atlas.frames.length = 0;
});

test('muzzle smoke only uses the reference smoke atlas', () => {
  const scene = new THREE.Scene();
  const smoke = new MuzzleSmoke(scene);
  const camera = new THREE.PerspectiveCamera();
  smoke.emit(new THREE.Vector3(0, 0, 0), camera, { size: 6, puffs: 2, smokeLife: 1, smokeSpeed: 70, smokeAlpha: 0.3 });
  assert.equal(smoke.puffs.length, 0);
  smoke.atlas.frames.push(new THREE.Texture(), new THREE.Texture());
  smoke.emit(new THREE.Vector3(0, 0, 0), camera, { size: 6, puffs: 2, smokeLife: 1, smokeSpeed: 70, smokeAlpha: 0.3 });
  assert.equal(smoke.puffs.length, 2);
  smoke.dispose();
  assert.equal(smoke.puffs.length, 0);
  smoke.atlas.frames.length = 0;
});

test('pack camo targets mapped opaque gun materials and patches the circuit board shader', () => {
  const mapped = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  assert.equal(isCamoTarget(mapped), true);
  assert.equal(isCamoTarget(new THREE.MeshStandardMaterial()), false);
  assert.equal(isCamoTarget(new THREE.MeshStandardMaterial({ map: new THREE.Texture(), name: 'scope_lens' })), false);
  assert.equal(isCamoTarget(new THREE.MeshStandardMaterial({ map: new THREE.Texture(), transparent: true, opacity: 0.4 })), false);
  const copy = patchPackCamo(mapped.clone(), new THREE.Texture());
  const shader = { uniforms: {}, fragmentShader: 'void main() {\n#include <map_fragment>\n#include <emissivemap_fragment>\n}' };
  copy.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /tPapCamo/);
  assert.match(shader.fragmentShader, /papTrace/);
  assert.ok(shader.uniforms.tPapCamo && shader.uniforms.uPapRepeat);
  assert.equal(mapped.onBeforeCompile === copy.onBeforeCompile, false);
  assert.equal(applyPackCamo(new THREE.Group()), 0);
  assert.ok(existsSync(new URL('textures/camo_packapunch_spec.png', web)));
  assert.ok(existsSync(new URL('textures-mobile/camo_packapunch_spec.png', web)));
});
