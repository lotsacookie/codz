import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfferPrefetch, prefetchWeapon } from '../export/web/assets/js/viewmodel-cache.js';

const weapons = { ak74u_zm: { id: 'ak74u_zm', name: 'AK74u' }, ray_gun_zm: { id: 'ray_gun_zm', name: 'Ray Gun' } };

test('the offered gun is built and warmed off the current task', async () => {
  const order = [], warmed = [], audio = [];
  const view = { prepare: def => { order.push('prepare:' + def.id); return Promise.resolve({ root: def.id }); } };
  const prefetch = createOfferPrefetch({ weapons, view, onBuilt: entry => warmed.push(entry.root), warmAudio: def => audio.push(def.id) });
  const pending = prefetch('ak74u_zm');
  order.push('returned');
  assert.deepEqual(audio, ['ak74u_zm']);
  assert.deepEqual(order, ['returned']);
  assert.deepEqual(await pending, { root: 'ak74u_zm' });
  assert.deepEqual(order, ['returned', 'prepare:ak74u_zm']);
  assert.deepEqual(warmed, ['ak74u_zm']);
});

test('the def is adjusted the way equipping adjusts it and the source def is untouched', async () => {
  const seen = [];
  const view = { prepare: def => { seen.push(def); return Promise.resolve({}); } };
  const adjust = def => { def.handsModel = 'suit_arms'; return def; };
  await createOfferPrefetch({ weapons, view, adjust })('ray_gun_zm');
  assert.equal(seen[0].handsModel, 'suit_arms');
  assert.equal(seen[0].id, 'ray_gun_zm');
  assert.equal(weapons.ray_gun_zm.handsModel, undefined);
});

test('equipment, unknown ids and a missing view are ignored', () => {
  const view = { prepare: () => { throw new Error('must not be called'); } };
  assert.equal(createOfferPrefetch({ weapons, view })('zombie_cymbal_monkey'), null);
  assert.equal(createOfferPrefetch({ weapons, view })(undefined), null);
  assert.equal(createOfferPrefetch({ weapons, view: null })('ak74u_zm'), null);
});

test('a failing build or warm-up never throws into the game', async () => {
  const failing = { prepare: () => Promise.reject(new Error('missing model')) };
  assert.equal(await createOfferPrefetch({ weapons, view: failing })('ak74u_zm'), null);
  assert.equal(await prefetchWeapon({ id: 'x' }, { prepare: () => Promise.resolve({ root: 1 }) }, { onBuilt: () => { throw new Error('warm failed'); } }), null);
  const view = { prepare: () => Promise.resolve({}) };
  assert.ok(await createOfferPrefetch({ weapons, view, warmAudio: () => { throw new Error('audio'); } })('ak74u_zm'));
});

test('prefetching the same gun twice shares one build through the view cache', async () => {
  const builds = new Map();
  const view = { prepare: def => { if (!builds.has(def.id)) builds.set(def.id, Promise.resolve({ id: def.id })); return builds.get(def.id); } };
  const prefetch = createOfferPrefetch({ weapons, view });
  const [a, b] = await Promise.all([prefetch('ak74u_zm'), prefetch('ak74u_zm')]);
  assert.equal(a, b);
  assert.equal(builds.size, 1);
});
