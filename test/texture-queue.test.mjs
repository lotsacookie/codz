import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextureQueue, placeholderColor, canUseImageBitmap } from '../export/web/texture-queue.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('the same texture is loaded once however many models ask for it', async () => {
  let loads = 0;
  const queue = createTextureQueue({ load: async key => { loads++; return { key }; } });
  const results = await Promise.all([queue.request('a.png'), queue.request('a.png'), queue.request('b.png'), queue.request('a.png')]);
  assert.equal(loads, 2);
  assert.equal(results[0], results[1]);
  assert.equal(queue.stats().sources, 2);
});

test('never runs more loads at once than the limit', async () => {
  let active = 0, peak = 0;
  const gates = [];
  const queue = createTextureQueue({
    limit: 3,
    load: key => new Promise(resolve => {
      active++; peak = Math.max(peak, active);
      gates.push(() => { active--; resolve(key); });
    }),
  });
  const all = Array.from({ length: 10 }, (_, i) => queue.request(`t${i}.png`));
  await tick();
  assert.equal(active, 3);
  assert.deepEqual(queue.stats(), { sources: 10, loading: 3, queued: 7 });
  while (gates.length) { gates.shift()(); await tick(); }
  await Promise.all(all);
  assert.equal(peak, 3);
  assert.equal(queue.stats().queued, 0);
});

test('the limit can depend on the device profile and is read at run time', async () => {
  let mobile = true, active = 0, peak = 0;
  const queue = createTextureQueue({
    limit: () => (mobile ? 2 : 6),
    load: async key => { active++; peak = Math.max(peak, active); await tick(); active--; return key; },
  });
  await Promise.all(Array.from({ length: 8 }, (_, i) => queue.request(`m${i}`)));
  assert.equal(peak, 2);
  mobile = false; peak = 0;
  await Promise.all(Array.from({ length: 12 }, (_, i) => queue.request(`d${i}`)));
  assert.equal(peak, 6);
});

test('a failed texture can be requested again instead of failing forever', async () => {
  let attempts = 0;
  const queue = createTextureQueue({ load: async key => { if (++attempts === 1) throw new Error('boom'); return key; } });
  await assert.rejects(queue.request('x.png'), /boom/);
  await tick();
  assert.equal(await queue.request('x.png'), 'x.png');
  assert.equal(attempts, 2);
});

test('loads wait while paused and resume on pump', async () => {
  let allowed = false, loads = 0;
  const queue = createTextureQueue({ canRun: () => allowed, load: async key => { loads++; return key; } });
  const pending = queue.request('p.png');
  await tick();
  assert.equal(loads, 0);
  assert.equal(queue.stats().queued, 1);
  allowed = true;
  queue.pump();
  assert.equal(await pending, 'p.png');
  assert.equal(loads, 1);
});

test('placeholders are flat grey for colour maps and flat blue for normal maps', () => {
  assert.deepEqual(placeholderColor('https://x/textures/c_ger_zombie_head1_c.png'), [200, 200, 200, 255]);
  assert.deepEqual(placeholderColor('https://x/textures/c_ger_zombie_head1_n.png?v=2'), [128, 128, 255, 255]);
  assert.deepEqual(placeholderColor('https://x/textures/limbs_n.webp'), [128, 128, 255, 255]);
});

test('ImageBitmap is used on Chrome and Edge but not Safari or Firefox', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const edge = chrome + ' Edg/130.0';
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';
  assert.equal(canUseImageBitmap(chrome, true), true);
  assert.equal(canUseImageBitmap(edge, true), true);
  assert.equal(canUseImageBitmap(safari, true), false);
  assert.equal(canUseImageBitmap(firefox, true), false);
  assert.equal(canUseImageBitmap(chrome, false), false);
});
