import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTextureQueue, createTextureRegistry, looksComplete, placeholderColor, canUseImageBitmap } from '../export/web/assets/js/texture-queue.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const texturesDir = new URL('../export/web/assets/textures/', import.meta.url).pathname;
const isPointer = bytes => Buffer.from(bytes.subarray(0, 23)).toString() === 'version https://git-lfs';

test('registry reports pending, ready and failed textures and says when all are ready', () => {
  const registry = createTextureRegistry();
  assert.equal(registry.report().allReady, false);
  registry.begin('a.png'); registry.begin('b.png'); registry.begin('c.png');
  assert.deepEqual(registry.report(), { total: 3, ready: 0, pending: 3, failed: 0, failedList: [], allReady: false });
  registry.ready('a.png');
  registry.fail('b.png', new Error('HTTP 502'));
  const mid = registry.report();
  assert.equal(mid.ready, 1); assert.equal(mid.pending, 1); assert.equal(mid.failed, 1);
  assert.deepEqual(mid.failedList, [{ url: 'b.png', error: 'HTTP 502', attempts: 1 }]);
  registry.ready('c.png');
  assert.equal(registry.report().allReady, false);
  registry.begin('b.png');
  assert.equal(registry.report().pending, 1);
  registry.ready('b.png');
  const done = registry.report();
  assert.equal(done.allReady, true);
  assert.equal(done.failed, 0);
});

test('settled() waits for every pending texture, including ones that fail', async () => {
  const registry = createTextureRegistry();
  registry.begin('a.png'); registry.begin('b.png');
  let settled = false;
  const waiting = registry.settled().then(() => { settled = true; });
  registry.ready('a.png');
  await tick();
  assert.equal(settled, false);
  registry.fail('b.png', 'boom');
  await waiting;
  assert.equal(settled, true);
  assert.deepEqual(registry.failedKeys(), ['b.png']);
});

test('a retried texture counts its attempts and a ready texture stays ready when asked for again', () => {
  const registry = createTextureRegistry();
  registry.begin('a.png'); registry.fail('a.png', 'x');
  registry.begin('a.png'); registry.fail('a.png', 'y');
  assert.equal(registry.report().failedList[0].attempts, 2);
  registry.begin('a.png'); registry.ready('a.png');
  registry.begin('a.png');
  assert.equal(registry.report().ready, 1);
  assert.equal(registry.report().pending, 0);
});

test('looksComplete accepts whole images and rejects ones cut off by a chunking proxy', () => {
  const name = readdirSync(texturesDir).find(file => file.endsWith('.png') && !isPointer(readFileSync(join(texturesDir, file)).subarray(0, 23)));
  const whole = new Uint8Array(readFileSync(join(texturesDir, name)));
  assert.equal(looksComplete(whole, name), true);
  assert.equal(looksComplete(whole.subarray(0, whole.length - 1), name), false);
  assert.equal(looksComplete(whole.subarray(0, Math.floor(whole.length / 2)), name), false);
  assert.equal(looksComplete(new Uint8Array(0), name), false);
  const jpeg = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xff, 0xd9]);
  assert.equal(looksComplete(jpeg, 'a.jpg'), true);
  assert.equal(looksComplete(jpeg.subarray(0, 10), 'a.jpg'), false);
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
  assert.equal(looksComplete(webp, 'a.webp'), true);
  assert.equal(looksComplete(webp.subarray(0, 12), 'a.webp'), false);
});

test('looksComplete has no false positives on any real texture in the repo', () => {
  let checked = 0;
  const bad = [];
  for (const file of readdirSync(texturesDir)) {
    if (!/\.(?:png|webp|jpe?g)$/i.test(file)) continue;
    const bytes = new Uint8Array(readFileSync(join(texturesDir, file)));
    if (isPointer(bytes)) continue;
    checked++;
    if (!looksComplete(bytes, file)) bad.push(file);
  }
  assert.ok(checked > 100);
  assert.deepEqual(bad, []);
});

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
