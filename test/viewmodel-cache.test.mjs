import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewmodelCache, prefetchOtherSlots } from '../export/web/assets/js/viewmodel-cache.js';

test('the least recently used entry is evicted first', () => {
  const evicted = [];
  const cache = new ViewmodelCache(2, (value, key) => evicted.push(key));
  cache.set('a', 1); cache.set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  assert.deepEqual(evicted, ['b']);
  assert.ok(cache.has('a') && cache.has('c') && !cache.has('b'));
});

test('kept entries (the gun in hand) are never evicted', () => {
  const evicted = [];
  const cache = new ViewmodelCache(2, (value, key) => evicted.push(key));
  cache.set('a', 1); cache.set('b', 2);
  cache.set('c', 3, new Set(['a']));
  assert.deepEqual(evicted, ['b']);
  assert.ok(cache.has('a'));
});

test('clear evicts everything once', () => {
  const evicted = [];
  const cache = new ViewmodelCache(4, (value, key) => evicted.push(key));
  cache.set('a', 1); cache.set('b', 2);
  cache.clear();
  assert.deepEqual(evicted.sort(), ['a', 'b']);
  assert.equal(cache.has('a'), false);
});

test('prefetch builds only the guns not in hand and restores the slot', async () => {
  const session = {
    inventory: [{ id: 'm1911' }, { id: 'ak74u' }, { id: 'ray' }], slot: 1,
    get def() { return { id: this.inventory[this.slot].id }; },
  };
  const prepared = [];
  const view = { prepare: def => { prepared.push(def.id + ':' + def.handsModel); return Promise.resolve({ root: def.id }); } };
  const built = [];
  const count = prefetchOtherSlots(session, view, { adjust: d => ({ ...d, handsModel: 'suit' }), onBuilt: entry => built.push(entry.root) });
  assert.equal(count, 2);
  assert.equal(session.slot, 1);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(prepared, ['m1911:suit', 'ray:suit']);
  assert.deepEqual(built, ['m1911', 'ray']);
});

test('a failing prefetch does not stop the others or throw', async () => {
  const session = { inventory: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], slot: 0, get def() { return { id: this.inventory[this.slot].id }; } };
  const seen = [];
  const view = { prepare: def => { seen.push(def.id); return def.id === 'b' ? Promise.reject(new Error('x')) : Promise.resolve({}); } };
  prefetchOtherSlots(session, view);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(seen, ['b', 'c']);
});
