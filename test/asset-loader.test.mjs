import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { AssetLoader, LfsPointerError, fetchBytes, parseLfsPointer, defaultBases } from '../export/web/assets/js/asset-loader.js';

const BASE = 'https://game.example/play/';
const FALLBACK = 'https://lfs.example/media/';
const enc = s => new TextEncoder().encode(s);
const pointer = size => enc(`version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize ${size}\n`);
const payload = n => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);

// Minimal fake network: routes maps absolute URL -> { body, status, chunk, stall, failTimes, encoding }.
function network(routes) {
  const log = [];
  const impl = async (url, init = {}) => {
    const route = routes[url];
    log.push(`${init.method ?? 'GET'} ${url}`);
    if (!route) return new Response('nope', { status: 404 });
    if (route.failTimes > 0) { route.failTimes--; throw new Error('network reset'); }
    const body = route.body, headers = { 'content-length': String(body.byteLength) };
    if (route.encoding) headers['content-encoding'] = route.encoding;
    if (init.method === 'HEAD') return new Response(null, { status: 200, headers });
    const chunk = route.chunk ?? body.byteLength;
    let pos = 0;
    const stream = new ReadableStream({
      pull(controller) {
        return new Promise((resolve, reject) => {
          const onAbort = () => reject(init.signal.reason ?? new Error('aborted'));
          if (route.stall && pos >= (route.stallAfter ?? 0)) { init.signal?.addEventListener('abort', onAbort, { once: true }); return; }
          if (pos >= body.byteLength) { controller.close(); return resolve(); }
          controller.enqueue(body.slice(pos, pos + chunk)); pos += chunk; resolve();
        });
      },
    });
    return new Response(stream, { status: route.status ?? 200, headers });
  };
  impl.log = log;
  return impl;
}
const memoryCaches = () => {
  const store = new Map();
  return { store, open: async () => ({ match: async u => store.has(u) ? new Response(store.get(u).slice()) : undefined, put: async (u, r) => { store.set(u, new Uint8Array(await r.arrayBuffer())); } }) };
};
const make = (routes, extra = {}) => new AssetLoader({ baseURI: BASE, fetchImpl: network(routes), cachesImpl: null, backoffMs: 1, ...extra });

test('recognises git-lfs pointers and rejects real data', () => {
  assert.deepEqual(parseLfsPointer(pointer(57751488)), { oid: 'a'.repeat(64), size: 57751488 });
  assert.equal(parseLfsPointer(payload(300)), null);
  assert.equal(parseLfsPointer(payload(5000)), null);
});

test('fetchBytes streams, reports progress and returns every byte', async () => {
  const data = payload(10000), seen = [];
  const { bytes } = await fetchBytes(BASE + 'a.bin', { fetchImpl: network({ [BASE + 'a.bin']: { body: data, chunk: 1500 } }), onProgress: (g, t) => seen.push([g, t]) });
  assert.deepEqual(bytes, data);
  assert.equal(seen.at(-1)[0], 10000);
  assert.ok(seen.length >= 6, 'progress is incremental');
});

test('fetchBytes retries transient failures', async () => {
  const data = payload(2048), net = network({ [BASE + 'a.bin']: { body: data, failTimes: 2 } });
  const { bytes } = await fetchBytes(BASE + 'a.bin', { fetchImpl: net, backoffMs: 1 });
  assert.deepEqual(bytes, data);
  assert.equal(net.log.length, 3);
});

test('fetchBytes does not retry a 404', async () => {
  const net = network({});
  await assert.rejects(fetchBytes(BASE + 'missing.bin', { fetchImpl: net, backoffMs: 1 }), /404/);
  assert.equal(net.log.length, 1);
});

test('a stalled download is aborted instead of hanging forever', async () => {
  const net = network({ [BASE + 'a.bin']: { body: payload(4000), chunk: 1000, stall: true, stallAfter: 2000 } });
  const started = Date.now();
  await assert.rejects(fetchBytes(BASE + 'a.bin', { fetchImpl: net, stallMs: 40, retries: 1, backoffMs: 1 }), /no data/);
  assert.ok(Date.now() - started < 2000);
  assert.equal(net.log.length, 2);
});

test('falls back to another host when the primary serves an LFS pointer', async () => {
  const data = payload(5000);
  const l = make({ [BASE + 'kino.bin']: { body: pointer(5000) }, [FALLBACK + 'kino.bin']: { body: data } }, { bases: [FALLBACK] });
  const res = await l.fetch('kino.bin');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), data);
  assert.equal(res.url, FALLBACK + 'kino.bin');
});

test('reports a clear error when every host serves a pointer', async () => {
  const l = make({ [BASE + 'kino.bin']: { body: pointer(57751488) } });
  await assert.rejects(l.fetch('kino.bin'), e => e instanceof LfsPointerError && /57\.1 MB|55\.1 MB|\d+\.\d MB/.test(e.message) && e.size === 57751488);
  assert.equal(l.snapshot().files[0].total, 57751488);
});

test('aggregate progress spans several files', async () => {
  const l = make({ [BASE + 'a.bin']: { body: payload(3000), chunk: 1000 }, [BASE + 'b.bin']: { body: payload(1000), chunk: 500 } });
  await Promise.all([l.buffer('a.bin'), l.buffer('b.bin')]);
  const s = l.snapshot();
  assert.equal(s.loaded, 4000); assert.equal(s.total, 4000); assert.equal(s.fraction, 1);
});

test('second load comes from Cache Storage without downloading again', async () => {
  const data = payload(9000), routes = { [BASE + 'big.bin']: { body: data } }, caches = memoryCaches(), net = network(routes);
  const mk = () => new AssetLoader({ baseURI: BASE, fetchImpl: net, cachesImpl: caches, minCacheBytes: 1000, backoffMs: 1 });
  await mk().buffer('big.bin');
  net.log.length = 0;
  const again = new Uint8Array(await mk().buffer('big.bin'));
  assert.deepEqual(again, data);
  assert.deepEqual(net.log, ['HEAD ' + BASE + 'big.bin']);
});

test('a cached file is refetched when the server reports a different size', async () => {
  const caches = memoryCaches(), routes = { [BASE + 'big.bin']: { body: payload(9000) } }, net = network(routes);
  const mk = () => new AssetLoader({ baseURI: BASE, fetchImpl: net, cachesImpl: caches, minCacheBytes: 1000, backoffMs: 1 });
  await mk().buffer('big.bin');
  routes[BASE + 'big.bin'].body = payload(12000);
  assert.equal((await mk().buffer('big.bin')).byteLength, 12000);
});

test('a cached LFS pointer is never trusted', async () => {
  const caches = memoryCaches(); caches.store.set(BASE + 'big.bin', pointer(9000));
  const data = payload(9000);
  const l = new AssetLoader({ baseURI: BASE, fetchImpl: network({ [BASE + 'big.bin']: { body: data } }), cachesImpl: caches, minCacheBytes: 1000, backoffMs: 1 });
  assert.deepEqual(new Uint8Array(await l.buffer('big.bin')), data);
});

test('downloads and unpacks the gzip variant listed in the manifest', async () => {
  const data = payload(20000), gz = gzipSync(data);
  const l = make({ [BASE + 'collision.bin.gz']: { body: gz, chunk: 700 }, [BASE + 'collision.bin']: { body: pointer(20000) } }, { manifest: { 'collision.bin': { gz: 'collision.bin.gz' } } });
  assert.deepEqual(new Uint8Array(await l.buffer('collision.bin')), data);
  assert.ok(l.snapshot().total < data.length, 'progress counts compressed bytes');
});

test('works from any sub-path and passes range/HEAD requests through', async () => {
  const sub = 'https://user.github.io/some/where/';
  const net = network({ [sub + 'game-data.json']: { body: enc('{"ok":1}') } });
  const l = new AssetLoader({ baseURI: sub + 'index.html', fetchImpl: net, cachesImpl: null });
  assert.deepEqual(await (await l.fetch('game-data.json')).json(), { ok: 1 });
  await l.fetch('game-data.json', { headers: { Range: 'bytes=0-9' } });
  assert.match(net.log.at(-1), /^GET/);
});

test('alternate host order: query string, global, then GitHub media', () => {
  const bases = defaultBases({ search: '?assets=https://a.example/x', hostname: 'me.github.io', pathname: '/proj/' }, { KINO_ASSET_BASES: ['https://b.example/'] });
  assert.deepEqual(bases, ['https://a.example/x/', 'https://b.example/', 'https://media.githubusercontent.com/media/me/proj/main/export/web/assets/']);
});

test('writes straight into a caller-provided buffer and rejects oversize data', async () => {
  const data = payload(7000), l = make({ [BASE + 'p1']: { body: data.slice(0, 4000), chunk: 900 }, [BASE + 'p2']: { body: data.slice(4000), chunk: 900 }, [BASE + 'big']: { body: payload(9000) } });
  const out = new Uint8Array(7000);
  const a = await l.getBytes(BASE + 'p1', undefined, { buffer: out, offset: 0 });
  const b = await l.getBytes(BASE + 'p2', undefined, { buffer: out, offset: a.bytes.byteLength });
  assert.deepEqual(out, data);
  assert.equal(a.bytes.buffer, out.buffer, 'no intermediate copy');
  await assert.rejects(l.getBytes(BASE + 'big', undefined, { buffer: new Uint8Array(100), offset: 0 }), /size mismatch/);
});

test('survives a wrong content-length (transfer encoding) by growing the buffer', async () => {
  const data = payload(5000), net = async () => new Response(new Blob([data]).stream(), { headers: { 'content-length': '100' } });
  const { bytes } = await fetchBytes(BASE + 'x', { fetchImpl: net });
  assert.deepEqual(bytes, data);
});

test('a stale cached copy of the wrong size is replaced instead of failing with a size error', async () => {
  const url = BASE + 'collision.bin', fresh = payload(3000), stale = payload(4500);
  const caches = memoryCaches();
  caches.store.set(url, stale);
  // gzip-encoded HEAD answers hide the length, so the old freshness probe could not catch this.
  const net = network({ [url]: { body: fresh } });
  const loader = new AssetLoader({ baseURI: BASE, fetchImpl: net, cachesImpl: caches, backoffMs: 1, minCacheBytes: 1 });
  const into = { buffer: new Uint8Array(3000), offset: 0 };
  const { bytes } = await loader.getBytes(url, undefined, into, { expected: 3000 });
  assert.equal(bytes.byteLength, 3000);
  assert.deepEqual(bytes, fresh);
  assert.deepEqual(caches.store.get(url), fresh, 'the cache now holds the right file');
});

test('a mirror serving another bake of the file is skipped when the expected size is known', async () => {
  const url = BASE + 'collision.bin', good = payload(2000);
  const net = network({ [url]: { body: payload(2600) }, [FALLBACK + 'collision.bin']: { body: good } });
  const loader = new AssetLoader({ baseURI: BASE, fetchImpl: net, cachesImpl: null, backoffMs: 1, bases: [FALLBACK] });
  const { bytes } = await loader.getBytes(url, undefined, { buffer: new Uint8Array(2000), offset: 0 }, { expected: 2000 });
  assert.deepEqual(bytes, good);
});

test('invalidate forgets a cached file so the next read downloads it again', async () => {
  const url = BASE + 'a.bin', caches = memoryCaches();
  caches.store.set(url, payload(900));
  const loader = new AssetLoader({ baseURI: BASE, fetchImpl: network({ [url]: { body: payload(1200) } }), cachesImpl: caches, backoffMs: 1, minCacheBytes: 1 });
  await loader.openCache();
  const cache = await loader.openCache();
  cache.delete = async u => { caches.store.delete(u); };
  await loader.invalidate(url);
  assert.equal(caches.store.has(url), false);
});
