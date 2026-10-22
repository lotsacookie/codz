import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { ExplosionFx } from '../export/web/assets/js/explosion-fx.js';

const web = new URL('../export/web/assets/', import.meta.url);

function texture(width = 256, height = 256) {
  const t = new THREE.Texture();
  t.image = { width, height };
  return t;
}

function sheets() {
  return {
    fire: texture(512, 512),
    glow: texture(256, 256),
    smoke: texture(512, 256),
    plume: texture(256, 512),
    ember: texture(256, 256)
  };
}

function fx() {
  return new ExplosionFx(new THREE.Scene(), { textures: sheets() });
}

test('fire and smoke sheets are cut into their reference frames', () => {
  const e = fx();
  assert.equal(e.frames.fire.length, 4);
  assert.equal(e.frames.smoke.length, 2);
  assert.equal(e.frames.plume.length, 2);
  assert.equal(e.frames.glow.length, 1);
  assert.deepEqual([e.frames.fire[3].repeat.x, e.frames.fire[3].repeat.y], [0.5, 0.5]);
  assert.deepEqual([e.frames.fire[3].offset.x, e.frames.fire[3].offset.y], [0.5, 0]);
  assert.equal(e.aspects.fire, 1);
  assert.equal(e.aspects.plume, 0.25);
  e.dispose();
});

test('nothing blasts until the fire and smoke sheets have loaded', () => {
  const e = new ExplosionFx(new THREE.Scene(), { textures: {} });
  assert.equal(e.ready(), false);
  assert.equal(e.blast(new THREE.Vector3()), false);
  assert.equal(e.items.length, 0);
});

test('a grenade blast adds flash, fireball, smoke, plume and embers with the right blending', () => {
  const e = fx();
  assert.equal(e.blast(new THREE.Vector3(0, 0, 0), { radius: 256, kind: 'grenade' }), true);
  const keys = new Set(e.items.map(item => item.key));
  for (const key of ['glow', 'fire', 'smoke', 'plume', 'ember']) assert.ok(keys.has(key), key);
  for (const item of e.items) {
    const additive = ['glow', 'fire', 'ember'].includes(item.key);
    assert.equal(item.material.blending, additive ? THREE.AdditiveBlending : THREE.NormalBlending, item.key);
  }
  assert.ok(e.items.filter(item => item.key === 'fire').length >= 4);
  e.dispose();
});

test('bigger radii and rockets make bigger blasts', () => {
  const small = fx(), big = fx(), rocket = fx();
  small.blast(new THREE.Vector3(), { radius: 128 });
  big.blast(new THREE.Vector3(), { radius: 512 });
  rocket.blast(new THREE.Vector3(), { radius: 256, kind: 'explosion' });
  const core = list => list.items.find(item => item.key === 'fire').size;
  assert.ok(core(big) > core(small) * 2);
  const grenade = fx();
  grenade.blast(new THREE.Vector3(), { radius: 256 });
  assert.ok(core(rocket) > core(grenade));
  assert.ok(rocket.items.length > grenade.items.length);
});

test('effects delay, fade out and return to the pool', () => {
  const e = fx();
  e.blast(new THREE.Vector3(0, 0, 0));
  const delayed = e.items.find(item => item.age < 0);
  assert.ok(delayed);
  assert.equal(delayed.sprite.visible, false);
  const flash = e.items.find(item => item.key === 'glow');
  e.update(0.05);
  assert.ok(flash.material.opacity > 0.5);
  e.update(0.05);
  assert.equal(delayed.sprite.visible, true);
  for (let t = 0; t < 4; t += 0.05) e.update(0.05);
  assert.equal(e.items.length, 0);
  assert.ok(e.pools.add.length > 0 && e.pools.norm.length > 0);
  const pooled = e.pools.add.length + e.pools.norm.length;
  e.blast(new THREE.Vector3());
  assert.ok(e.pools.add.length + e.pools.norm.length < pooled);
  e.dispose();
});

test('embers fall under gravity and smoke rises', () => {
  const e = fx();
  e.blast(new THREE.Vector3(0, 0, 0));
  const ember = e.items.find(item => item.key === 'ember');
  const smoke = e.items.find(item => item.key === 'smoke');
  const emberVy = ember.velocity.y, smokeY = smoke.sprite.position.y;
  for (let i = 0; i < 20; i++) e.update(0.03);
  assert.ok(ember.velocity.y < emberVy);
  assert.ok(smoke.sprite.position.y > smokeY);
  e.dispose();
});

test('the sprite count stays capped and clear empties it', () => {
  const e = fx();
  for (let i = 0; i < 12; i++) e.blast(new THREE.Vector3(i * 10, 0, 0), { kind: 'explosion' });
  assert.ok(e.items.length <= 96);
  e.clear();
  assert.equal(e.items.length, 0);
  assert.ok(e.group.children.every(sprite => !sprite.visible));
  e.dispose();
});

test('the reference explosion sheets ship for desktop and mobile', () => {
  for (const dir of ['textures', 'textures-mobile']) {
    for (const name of ['fxt_exp_fire', 'fxt_exp_glow', 'fxt_exp_ember_omni', 'fxt_smk_def_1', 'fxt_debris_plume_dirt']) {
      assert.ok(existsSync(new URL(`${dir}/${name}.png`, web)), `${dir}/${name}.png`);
    }
  }
});
