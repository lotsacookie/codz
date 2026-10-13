# Kino update: loading, smoothing, quality (code by file path)

Everything below is **code only**; no game assets. Apply in this order. Each *new file* is the complete file.
Each *edit* is a **Find** block (text that exists now, including one unchanged line of context on each side) and a
**Replace with** block. Find the text, replace it with the second block.

**Step 0.** Git LFS: your `.bin`, `.glb` and texture files must be real files, not 130-byte pointers (`git lfs pull`).
The new loader tells you if they are not.

**Contents**

1. New files (5): `asset-loader.js`, `quality.js`, `steering.js`, `camera-smoothing.js`, `compress-assets.mjs`
2. Edits to existing files (10)
3. Switches: `?perf=1` fps overlay, `?smooth=0` turn off all smoothing, `?adaptive=0` no dynamic resolution, `?fx=0` no vignette
4. Optional: tests and `LOADING.md`

---

## 1. New files

### `export/web/asset-loader.js`

````js
// Resilient asset loading for the browser build.
//
// Why this exists: Kino needs ~150 MB of binary data (geometry, collision BVH,
// navmesh) before it can start. The old loader fetched it with no byte-level
// progress, no stall detection and no error reporting, so a slow connection, a
// host that serves Git LFS *pointer* files instead of the real data, or a
// dropped request all looked like a game stuck on "Loading the theater".
//
// What it does:
//  * streams every request and reports aggregate bytes loaded / total
//  * aborts and retries requests that stop receiving data (stall detection)
//  * recognises Git LFS pointer files and falls back to alternate hosts
//  * optionally downloads gzip variants listed in asset-manifest.json
//  * keeps large files in Cache Storage so later visits start almost instantly
//  * resolves every URL against the page's base, so the game works from any
//    folder or sub-path (GitHub Pages project sites, CDNs, local servers)

const POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\noid sha256:([0-9a-f]{64})\r?\nsize (\d+)/;
const MAX_POINTER_BYTES = 512;

export class LfsPointerError extends Error {
  constructor(url, size) {
    const mb = size ? ` (the real file is ${(size / 1048576).toFixed(1)} MB)` : '';
    super(`${url} is a Git LFS pointer, not the real file${mb}. Deploy with the LFS files pulled (git lfs pull), or add a host that has them with ?assets=https://host/path/`);
    this.name = 'LfsPointerError';
    this.size = size;
  }
}

export function parseLfsPointer(bytes) {
  if (!bytes || bytes.byteLength > MAX_POINTER_BYTES) return null;
  const m = POINTER.exec(new TextDecoder().decode(bytes));
  return m ? { oid: m[1], size: Number(m[2]) } : null;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const TYPES = { json: 'application/json', bin: 'application/octet-stream', gltf: 'model/gltf+json', wasm: 'application/wasm', png: 'image/png', webp: 'image/webp', ogg: 'audio/ogg', wav: 'audio/wav' };
const typeOf = url => TYPES[/\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase()] ?? 'application/octet-stream';

// Download one URL as bytes, reporting progress and surviving flaky networks.
export async function fetchBytes(url, { fetchImpl = (...a) => globalThis.fetch(...a), retries = 3, stallMs = 20000, backoffMs = 400, signal, onProgress, into } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const relay = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', relay, { once: true });
    let timer;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error(`no data for ${stallMs / 1000}s`)), stallMs); };
    try {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted');
      arm();
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for ${url}`), { status: response.status });
      const total = Number(response.headers.get('content-length')) || 0;
      onProgress?.(0, total);
      // Write straight into the caller's buffer when given one; otherwise preallocate from
      // content-length and grow only if the server's length was wrong (e.g. transfer encoding).
      let out = into ? into.buffer : new Uint8Array(total || 65536);
      const base = into?.offset ?? 0;
      let got = 0;
      const write = chunk => {
        const need = base + got + chunk.byteLength;
        if (need > out.byteLength) {
          if (into) throw new Error(`size mismatch: ${url} is larger than expected`);
          const grown = new Uint8Array(Math.max(need, Math.ceil(out.byteLength * 1.5)));
          grown.set(out.subarray(0, got)); out = grown;
        }
        out.set(chunk, base + got); got += chunk.byteLength;
        onProgress?.(got, total);
      };
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        for (;;) { const { done, value } = await reader.read(); if (done) break; arm(); write(value); }
      } else write(new Uint8Array(await response.arrayBuffer()));
      return { bytes: out.subarray(base, base + got), total: total || got };
    } catch (error) {
      lastError = error;
      onProgress?.(0, 0);
      // A missing or forbidden file will not appear on retry; a stall or reset might.
      if (signal?.aborted || error.status === 404 || error.status === 403 || /size mismatch/.test(error.message)) break;
      if (attempt < retries) await sleep(backoffMs * 2 ** attempt);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', relay);
    }
  }
  throw lastError;
}

async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress gzip assets');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Alternate asset hosts, in priority order: ?assets=a,b  >  window.KINO_ASSET_BASES  >  guessed GitHub LFS host.
export function defaultBases(location = globalThis.location, scope = globalThis) {
  const out = [];
  const add = value => { if (value) out.push(value.endsWith('/') ? value : value + '/'); };
  try { for (const v of new URLSearchParams(location.search).get('assets')?.split(',') ?? []) add(v.trim()); } catch {}
  for (const v of scope.KINO_ASSET_BASES ?? []) add(v);
  const m = /^([^.]+)\.github\.io$/.exec(location.hostname ?? '');
  const repo = (location.pathname ?? '').split('/').filter(Boolean)[0];
  if (m && repo) add(`https://media.githubusercontent.com/media/${m[1]}/${repo}/main/export/web/`);
  return out;
}

export class AssetLoader {
  constructor(options = {}) {
    this.baseURI = options.baseURI ?? globalThis.document?.baseURI ?? 'http://localhost/';
    this.bases = options.bases ?? [];
    this.fetchImpl = options.fetchImpl ?? ((...a) => globalThis.fetch(...a));
    this.cachesImpl = options.cachesImpl ?? globalThis.caches;
    this.cacheName = options.cacheName ?? 'kino-assets-v1';
    this.minCacheBytes = options.minCacheBytes ?? 256 * 1024;
    this.retries = options.retries ?? 3;
    this.stallMs = options.stallMs ?? 20000;
    this.backoffMs = options.backoffMs ?? 400;
    this.manifest = options.manifest ?? null;
    this.files = new Map();
    this.listeners = new Set();
    this.blobUrls = new Map();
    this.lastEmit = 0;
    this._cache = undefined;
    // For THREE.LoadingManager.setURLModifier: serve prefetched files from memory.
    this.urlModifier = url => this.blobUrls.get(this.abs(url)) ?? url;
  }

  abs(url) { return new URL(String(url), this.baseURI).href; }
  root() { return new URL('.', this.baseURI).href; }
  rel(url) { const root = this.root(); return url.startsWith(root) ? url.slice(root.length).split(/[?#]/)[0] : null; }
  rebase(url, base) { const rel = this.rel(url); return rel == null ? null : new URL(rel, base).href; }

  onProgress(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  snapshot() {
    let loaded = 0, total = 0;
    const files = [];
    for (const [url, f] of this.files) { loaded += f.got; total += f.total; files.push({ url, got: f.got, total: f.total, done: f.done }); }
    return { loaded, total, fraction: total ? Math.min(1, loaded / total) : 0, files };
  }
  emit(force = false) {
    const now = Date.now();
    if (!force && now - this.lastEmit < 100) return;
    this.lastEmit = now;
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }
  track(url) {
    const entry = { got: 0, total: 0, done: false };
    this.files.set(url, entry);
    return entry;
  }

  async openCache() {
    if (this._cache !== undefined) return this._cache;
    try { this._cache = this.cachesImpl ? await this.cachesImpl.open(this.cacheName) : null; } catch { this._cache = null; }
    return this._cache;
  }
  async cacheGet(url) {
    const cache = await this.openCache();
    if (!cache) return null;
    try {
      const hit = await cache.match(url);
      if (!hit) return null;
      const bytes = new Uint8Array(await hit.arrayBuffer());
      return parseLfsPointer(bytes) ? null : bytes;
    } catch { return null; }
  }
  async cachePut(url, bytes) {
    if (bytes.byteLength < this.minCacheBytes) return;
    try {
      const cache = await this.openCache();
      if (!cache) return;
      // Stream slices of the existing buffer so a 90 MB file is not duplicated just to be stored.
      let pos = 0;
      const body = new ReadableStream({ pull(c) { if (pos >= bytes.byteLength) return c.close(); c.enqueue(bytes.subarray(pos, pos += 1 << 20)); } });
      await cache.put(url, new Response(body, { headers: { 'content-length': String(bytes.byteLength) } }));
    } catch { /* quota or private mode: caching is optional */ }
  }
  // A cached file is stale if the server now reports a different size. If the server
  // cannot tell us (offline, compressed transfer, LFS pointer), trust the cache.
  async stillFresh(url, length) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 4000);
      const r = await this.fetchImpl(url, { method: 'HEAD', signal: ctl.signal }).finally(() => clearTimeout(timer));
      if (!r.ok || r.headers.get('content-encoding')) return true;
      const n = Number(r.headers.get('content-length'));
      return !(n > MAX_POINTER_BYTES && n !== length);
    } catch { return true; }
  }

  // Core: resolve a URL to its real bytes.
  async getBytes(url, signal, into) {
    const entry = this.files.get(url) ?? this.track(url);
    // Only large binaries are worth a cache lookup; hundreds of small JSON files are not.
    const bulk = /\.(bin|gz|glb|gltf|wasm)(?:[?#].*)?$/i.test(url);
    const cached = bulk ? await this.cacheGet(url) : null;
    if (cached && await this.stillFresh(url, cached.byteLength)) {
      entry.got = entry.total = cached.byteLength; entry.done = true; entry.cached = true;
      this.emit(true);
      if (into) { if (into.offset + cached.byteLength > into.buffer.byteLength) throw new Error(`size mismatch: ${url} is larger than expected`); into.buffer.set(cached, into.offset); return { bytes: into.buffer.subarray(into.offset, into.offset + cached.byteLength), finalUrl: url }; }
      return { bytes: cached, finalUrl: url };
    }
    const gzPath = this.manifest?.[this.rel(url)]?.gz;
    const candidates = [{ url, root: this.root() }, ...this.bases.map(b => ({ url: this.rebase(url, b), root: b })).filter(c => c.url)];
    let pointer = null, lastError;
    for (const { url: candidate, root } of candidates) {
      const variants = [gzPath && new URL(gzPath, root).href, candidate].filter(Boolean);
      for (const variant of variants) {
        const isGz = variant !== candidate;
        try {
          const { bytes, total } = await fetchBytes(variant, {
            fetchImpl: this.fetchImpl, retries: this.retries, stallMs: this.stallMs, backoffMs: this.backoffMs, signal, into: isGz ? undefined : into,
            onProgress: (got, t) => { entry.got = got; entry.total = t || got; this.emit(); },
          });
          const ptr = parseLfsPointer(bytes);
          if (ptr) { pointer = ptr; entry.got = 0; entry.total = ptr.size; continue; }
          let out = isGz ? await gunzip(bytes) : bytes;
          if (isGz && into) { if (into.offset + out.byteLength > into.buffer.byteLength) throw new Error(`size mismatch: ${url} is larger than expected`); into.buffer.set(out, into.offset); out = into.buffer.subarray(into.offset, into.offset + out.byteLength); }
          entry.got = entry.total = bytes.byteLength; entry.done = true;
          this.emit(true);
          if (bulk) await this.cachePut(url, out);
          return { bytes: out, finalUrl: candidate };
        } catch (error) {
          lastError = error;
          if (signal?.aborted) throw error;
        }
      }
    }
    entry.failed = true;
    this.emit(true);
    if (pointer) throw new LfsPointerError(url, pointer.size);
    throw lastError ?? new Error(`Could not load ${url}`);
  }

  // Drop-in replacement for fetch() for plain GET requests.
  async fetch(input, init = {}) {
    const method = String(init.method ?? input?.method ?? 'GET').toUpperCase();
    const headers = init.headers ?? input?.headers;
    const hasRange = headers && (typeof headers.get === 'function' ? headers.get('range') : headers.Range ?? headers.range);
    if (method !== 'GET' || hasRange) return this.fetchImpl(input, init);
    const url = this.abs(typeof input === 'string' || input instanceof URL ? input : input.url);
    const { bytes, finalUrl } = await this.getBytes(url, init.signal);
    const response = new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength), 'content-type': typeOf(url) } });
    Object.defineProperty(response, 'url', { value: finalUrl });
    return response;
  }

  async buffer(path) {
    const { bytes } = await this.getBytes(this.abs(path));
    return bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  // Fetch now, serve later: GLTFLoader requests `path` through a URL modifier backed by this blob.
  async prefetchBlob(path, type) {
    const url = this.abs(path);
    if (this.blobUrls.has(url)) return this.blobUrls.get(url);
    const { bytes } = await this.getBytes(url);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: type ?? typeOf(url) }));
    this.blobUrls.set(url, blobUrl);
    return blobUrl;
  }
  release(path) {
    const url = this.abs(path), blobUrl = this.blobUrls.get(url);
    if (blobUrl) { URL.revokeObjectURL(blobUrl); this.blobUrls.delete(url); }
  }
  async loadManifest(path = 'asset-manifest.json') {
    try {
      const r = await this.fetchImpl(this.abs(path));
      if (r.ok) this.manifest = await r.json();
    } catch { /* the manifest is optional */ }
    return this.manifest;
  }
}

// Shared instance for the game. Replace with configureAssets() before first use.
export let assets = new AssetLoader({ bases: typeof location === 'undefined' ? [] : defaultBases() });
export function configureAssets(options) { assets = new AssetLoader(options); return assets; }
export const rfetch = (input, init) => assets.fetch(input, init);
````

### `export/web/quality.js`

````js
// Rendering-quality helpers that cost (almost) nothing, or pay for themselves.

// Dynamic resolution: lower the render scale when frames run long, probe back up when stable.
// Pixel count is the cheapest knob on fill-rate-bound scenes, so this keeps frame rate steady
// on weak GPUs while strong ones stay at full resolution.
export class AdaptiveResolution {
  constructor({ min = .65, max = 1, step = .1, targetMs = 1000 / 60, windowFrames = 40, hitchMs = 100, enabled = true } = {}) {
    Object.assign(this, { min, max, step, targetMs, windowFrames, hitchMs, enabled });
    this.scale = max; this.sum = 0; this.n = 0; this.stable = 0; this.holdWindows = 4; this.probed = false;
  }
  // Feed one frame time in ms. Returns the new scale when it changed, otherwise null.
  sample(ms) {
    if (!this.enabled || !(ms > 0) || ms >= this.hitchMs) return null; // ignore pauses, tab switches and load hitches
    this.sum += ms; this.n++;
    if (this.n < this.windowFrames) return null;
    const avg = this.sum / this.n; this.sum = 0; this.n = 0;
    if (avg > this.targetMs * 1.15 && this.scale > this.min) {
      // A failed upward probe means this scale is too high: wait twice as long before trying again.
      if (this.probed) this.holdWindows = Math.min(64, this.holdWindows * 2);
      this.probed = false; this.stable = 0;
      this.scale = Math.max(this.min, +(this.scale - this.step).toFixed(3));
      return this.scale;
    }
    if (avg <= this.targetMs * 1.05 && this.scale < this.max) {
      this.probed = false;
      if (++this.stable >= this.holdWindows) {
        this.stable = 0; this.probed = true;
        this.scale = Math.min(this.max, +(this.scale + this.step / 2).toFixed(3));
        return this.scale;
      }
    } else if (this.scale >= this.max) this.stable = 0;
    return null;
  }
}

const TEXTURE_SLOTS = ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'lightMap'];
// Sharper textures at grazing angles (floors, long walls). Must run before the first render of
// the object: changing it after upload would force a re-upload and a visible hitch.
export function applyAnisotropy(root, level) {
  const seen = new Set();
  if (!(level > 1)) return 0;
  root.traverse(object => {
    for (const material of [].concat(object.material ?? [])) {
      for (const slot of TEXTURE_SLOTS) {
        const texture = material?.[slot];
        if (texture && !seen.has(texture)) { seen.add(texture); texture.anisotropy = Math.max(texture.anisotropy || 1, level); }
      }
    }
  });
  return seen.size;
}

// ?perf=1 shows fps, render scale, draw calls and triangles so changes can be compared on a device.
export function createPerfOverlay(search = globalThis.location?.search ?? '', doc = globalThis.document) {
  if (!/[?&]perf=1\b/.test(search) || !doc) return null;
  const el = doc.createElement('div');
  el.style.cssText = 'position:fixed;left:6px;top:6px;z-index:99;font:11px/1.3 monospace;color:#9f9;background:#0008;padding:3px 6px;pointer-events:none;white-space:pre';
  doc.body.appendChild(el);
  return (fps, scale, calls, triangles) => { el.textContent = `${fps} fps  scale ${scale.toFixed(2)}\n${calls} calls  ${(triangles / 1000).toFixed(0)}k tris`; };
}
````

### `export/web/steering.js`

````js
// Smooth turning for enemies. Snapping a zombie's heading to the current path node every frame
// made them jitter at corners; this turns toward the target with eased, rate-limited motion.
const TAU = Math.PI * 2;
export function shortestAngle(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return d;
}
// rate: easing strength (1/s). maxSpeed: hard cap in rad/s so large turns stay believable.
export function turnToward(current, target, dt, { rate = 10, maxSpeed = Math.PI * 2.4 } = {}) {
  const diff = shortestAngle(current, target);
  const eased = diff * (1 - Math.exp(-rate * dt));
  const cap = maxSpeed * dt;
  return current + Math.max(-cap, Math.min(cap, eased));
}

// Frame-rate independent exponential approach: the same result at 30, 60 or 144 fps.
export function damp(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt);
}

// Ease a movement direction (plain {x,y,z}, mutated) toward `desired`, keeping a horizontal
// length of 1 so speed stays the same while the path bends smoothly instead of kinking at nodes.
export function steerDirection(current, desired, dt, rate = 8) {
  const k = Number.isFinite(rate) ? 1 - Math.exp(-rate * dt) : 1;
  current.x += (desired.x - current.x) * k;
  current.y += (desired.y - current.y) * k;
  current.z += (desired.z - current.z) * k;
  const horizontal = Math.hypot(current.x, current.z);
  if (horizontal > 1e-6) { current.x /= horizontal; current.y /= horizontal; current.z /= horizontal; }
  else { current.x = desired.x; current.y = desired.y; current.z = desired.z; }
  return current;
}

// ?smooth=0 turns every smoothing feature off so before/after can be compared on a device.
export function smoothingEnabled(search = globalThis.location?.search ?? '') {
  return !/[?&]smooth=0\b/.test(search);
}
````

### `export/web/camera-smoothing.js`

````js
import { damp } from './steering.js';

// Visual-only camera easing. Physics keeps the exact collider position; only what the player
// SEES is smoothed, so collision, hit detection and movement are unchanged.
//  * eye height eases between standing and crouching instead of snapping
//  * stairs/ledges: a sudden rise or drop while grounded is absorbed and decays, so the view glides
//  * landing: a small damped spring dips the view in proportion to fall speed
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class CameraSmoother {
  constructor({ eyeRate = 18, stepRate = 12, stepSpeed = 450, maxStep = 26, landStiffness = 220, landDamping = 24, landScale = .2, landMaxImpulse = 110, maxDip = 3.5, minFallSpeed = 150 } = {}) {
    Object.assign(this, { eyeRate, stepRate, stepSpeed, maxStep, landStiffness, landDamping, landScale, landMaxImpulse, maxDip, minFallSpeed });
    this.reset();
  }
  reset() {
    this.ready = false; this.eye = 0; this.offset = 0; this.land = 0; this.landV = 0;
    this.prevFeet = 0; this.prevFloor = false; this.prevVy = 0;
  }
  // Returns { eye, offset }: camera Y = feetY + eye + offset.
  update(dt, { feetY, eyeHeight, onFloor, velocityY = 0 }) {
    if (!this.ready) { this.reset(); this.ready = true; this.eye = eyeHeight; this.prevFeet = feetY; this.prevFloor = onFloor; }
    dt = clamp(dt, 0, .05);
    this.eye = damp(this.eye, eyeHeight, this.eyeRate, dt);

    const dy = feetY - this.prevFeet;
    if (Math.abs(dy) > this.maxStep * 2) this.offset = 0;                       // teleport or respawn
    else if (dt > 0 && onFloor && this.prevFloor && Math.abs(dy) / dt > this.stepSpeed && Math.abs(dy) <= this.maxStep) this.offset -= dy;
    this.offset = clamp(damp(this.offset, 0, this.stepRate, dt), -this.maxStep, this.maxStep);

    if (onFloor && !this.prevFloor && this.prevVy < -this.minFallSpeed) {
      this.landV = -Math.min(this.landMaxImpulse, -this.prevVy * this.landScale);
    }
    // semi-implicit spring; dt is capped so it stays stable
    this.landV += (-this.landStiffness * this.land - this.landDamping * this.landV) * dt;
    this.land = clamp(this.land + this.landV * dt, -this.maxDip, .5);

    this.prevFeet = feetY; this.prevFloor = onFloor; this.prevVy = velocityY;
    return { eye: this.eye, offset: this.offset + this.land };
  }
}
````

### `.tools/compress-assets.mjs`

````js
#!/usr/bin/env node
// Optional: pre-compress the big binaries so the browser downloads far less.
//   node .tools/compress-assets.mjs [webRoot]
// Writes <file>.gz next to each large .bin and an asset-manifest.json. To enable it, add
//   <meta name="kino-asset-manifest" content="asset-manifest.json">
// to index.html. The loader then fetches the .gz, unpacks it in the browser (DecompressionStream)
// and falls back to the raw file if the .gz is missing. The saving depends on the data, so check
// the ratios printed below; many static hosts do not compress application/octet-stream themselves.
import { createReadStream, createWriteStream, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createGzip, constants } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? join(import.meta.dirname, '..', 'export', 'web'));
const MIN = 1 << 20;
const manifest = {};
for (const name of readdirSync(root)) {
  const file = join(root, name);
  if (!name.endsWith('.bin') || statSync(file).size < MIN) continue;
  const head = Buffer.alloc(40); const fd = (await import('node:fs')).openSync(file, 'r'); (await import('node:fs')).readSync(fd, head, 0, 40, 0); (await import('node:fs')).closeSync(fd);
  if (head.toString().startsWith('version https://git-lfs')) { console.error(`skip ${name}: Git LFS pointer (run git lfs pull first)`); continue; }
  await pipeline(createReadStream(file), createGzip({ level: constants.Z_BEST_COMPRESSION }), createWriteStream(file + '.gz'));
  const raw = statSync(file).size, gz = statSync(file + '.gz').size;
  manifest[name] = { gz: name + '.gz', size: raw, gzSize: gz };
  console.log(`${name}: ${(raw / 1048576).toFixed(1)} MB -> ${(gz / 1048576).toFixed(1)} MB (${(100 * gz / raw).toFixed(0)}%)`);
}
writeFileSync(join(root, 'asset-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`wrote asset-manifest.json (${Object.keys(manifest).length} files)`);
````

---

## 2. Edits to existing files

### `export/web/animation.js`  (1 edit)

**Edit 1: Find**

````js
import { assetManager, disposeSkeletons } from './runtime-assets.js';

const loader=new GLTFLoader(assetManager), models=new Map(), clips=new Map();
export async function loadModel(url){if(!url)return null;if(!models.has(url))models.set(url,loader.loadAsync(url).then(gltf=>gltf.scene));return clone(await models.get(url));}
export async function loadAnimation(url){if(!clips.has(url))clips.set(url,fetch(url).then(r=>{if(!r.ok)throw new Error('Animation '+url+': '+r.status);return r.json();}));return clips.get(url);}
export function makeClip(root, data, locomotion=false){
````

**Replace with**

````js
import { assetManager, disposeSkeletons } from './runtime-assets.js';
import { assets, rfetch } from './asset-loader.js';

const loader=new GLTFLoader(assetManager), models=new Map(), clips=new Map();
export async function loadModel(url){if(!url)return null;if(!models.has(url))models.set(url,assets.buffer(url).then(bytes=>loader.parseAsync(bytes,THREE.LoaderUtils.extractUrlBase(assets.abs(url)))).then(gltf=>gltf.scene));return clone(await models.get(url));}
export async function loadAnimation(url){if(!clips.has(url))clips.set(url,rfetch(url).then(r=>{if(!r.ok)throw new Error('Animation '+url+': '+r.status);return r.json();}));return clips.get(url);}
export function makeClip(root, data, locomotion=false){
````

### `export/web/binary-parts.js`  (2 edits)

**Edit 1: Find**

````js
// joining them doubled the collision buffer at the busiest point of startup.
export async function loadBinaryParts(parts, { baseUrl, byteLength, onProgress } = {}) {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || !parts?.length) throw new Error('Invalid collision binary layout');
````

**Replace with**

````js
// joining them doubled the collision buffer at the busiest point of startup.
export async function loadBinaryParts(parts, { baseUrl, byteLength, onProgress, fetchPart } = {}) {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || !parts?.length) throw new Error('Invalid collision binary layout');
````

**Edit 2: Find**

````js
  for (const part of parts) {
    const response = await fetch(new URL(part.uri, baseUrl));
````

**Replace with**

````js
  for (const part of parts) {
    if (fetchPart) {
      // Resilient path: the loader writes straight into the final allocation, with retries,
      // stall detection and alternate hosts. Same size checks as the streaming path below.
      const start = offset, uri = new URL(part.uri, baseUrl).href;
      const { bytes } = await fetchPart(uri, { buffer: output, offset });
      offset += bytes.byteLength;
      onProgress?.({ loaded: offset, total: byteLength });
      if (part.byteLength != null && offset - start !== part.byteLength) throw new Error(`collision BVH size mismatch: ${part.uri}`);
      continue;
    }
    const response = await fetch(new URL(part.uri, baseUrl));
````

### `export/web/collision-world.js`  (3 edits)

**Edit 1: Find**

````js
import { loadBinaryParts } from './binary-parts.js';
````

**Replace with**

````js
import { loadBinaryParts } from './binary-parts.js';
import { assets, rfetch } from './asset-loader.js';
````

**Edit 2: Find**

````js
  const started = performance.now();
  const metadataResponse = await fetch(metadataUrl);
  if (!metadataResponse.ok) throw new Error(`collision metadata HTTP ${metadataResponse.status}`);
````

**Replace with**

````js
  const started = performance.now();
  const metadataResponse = await rfetch(metadataUrl);
  if (!metadataResponse.ok) throw new Error(`collision metadata HTTP ${metadataResponse.status}`);
````

**Edit 3: Find**

````js
  const parts = metadata.binaryParts ?? [{ uri: metadata.binary, byteLength: metadata.byteLength }];
  const binary = await loadBinaryParts(parts, { baseUrl: metadataResponse.url, byteLength: metadata.byteLength, onProgress });
  const world = deserializeCollisionWorld(metadata, binary);
````

**Replace with**

````js
  const parts = metadata.binaryParts ?? [{ uri: metadata.binary, byteLength: metadata.byteLength }];
  const binary = await loadBinaryParts(parts, {
    baseUrl: metadataResponse.url, byteLength: metadata.byteLength, onProgress,
    fetchPart: (url, into) => assets.getBytes(url, undefined, into),
  });
  const world = deserializeCollisionWorld(metadata, binary);
````

### `export/web/enemies.js`  (6 edits)

**Edit 1: Find**

````js
import { disposeSkeletons } from './runtime-assets.js';
````

**Replace with**

````js
import { disposeSkeletons } from './runtime-assets.js';
import { turnToward, steerDirection, smoothingEnabled } from './steering.js';

const BLEND = .18;                       // seconds to cross-fade walk/attack (was .1)
const STEER_RATE = smoothingEnabled() ? 8 : Infinity;   // path-direction easing; Infinity = old behaviour
````

**Edit 2: Find**

````js
      if(z.state==='barricade'){
        z.root.rotation.y=Math.atan2(-(z.barrier.inside.z-z.root.position.z),z.barrier.inside.x-z.root.position.x);
        z.tearLeft-=dt;
        if(z.barrier.count>0){z.rig.play('attack');if(z.tearLeft<=0){this.world.setBoards(z.barrier,z.barrier.count-1);z.tearLeft=1.1;this.onSound?.('board',z.root.position);}}
        else{z.state='entering';z.enterFrom=z.root.position.clone();z.enterTime=0;z.rig.play('walk');}
        continue;
````

**Replace with**

````js
      if(z.state==='barricade'){
        z.root.rotation.y=turnToward(z.root.rotation.y,Math.atan2(-(z.barrier.inside.z-z.root.position.z),z.barrier.inside.x-z.root.position.x),dt,{rate:12});
        z.tearLeft-=dt;
        if(z.barrier.count>0){z.rig.play('attack',true,1,BLEND);if(z.tearLeft<=0){this.world.setBoards(z.barrier,z.barrier.count-1);z.tearLeft=1.1;this.onSound?.('board',z.root.position);}}
        else{z.state='entering';z.enterFrom=z.root.position.clone();z.enterTime=0;z.rig.play('walk',true,1,BLEND);}
        continue;
````

**Edit 3: Find**

````js
      if(z.state==='entering'){
        z.enterTime+=dt;const t=Math.min(1,z.enterTime/1.2);z.root.position.lerpVectors(z.enterFrom,z.barrier.inside,t);z.root.position.y+=Math.sin(t*Math.PI)*12;
        if(t===1){z.state='chase';z.repath=0;}continue;
````

**Replace with**

````js
      if(z.state==='entering'){
        z.enterTime+=dt;const t=Math.min(1,z.enterTime/1.2);z.root.position.lerpVectors(z.enterFrom,z.barrier.inside,t*t*(3-2*t));z.root.position.y+=Math.sin(t*Math.PI)*12;
        if(t===1){z.state='chase';z.repath=0;}continue;
````

**Edit 4: Find**

````js
        if(!z.attackDealt&&z.attackLeft<.62){z.attackDealt=true;if(!lure&&dist<76&&this.world.lineClear(at,eye))this.onDamage(z.kind==='dog'?40:z.kind==='nova'?45:50);}
        if(z.attackLeft<=0){z.state='chase';z.rig.play('walk');}continue;
      }
      if(!lure&&dist<62&&Math.abs(z.root.position.y-player.y)<50&&s.phase!=='reviving'&&this.world.lineClear(at,eye)){
        z.state='attack';z.attackLeft=1.15;z.attackDealt=false;z.rig.play('attack',false);continue;
      }
````

**Replace with**

````js
        if(!z.attackDealt&&z.attackLeft<.62){z.attackDealt=true;if(!lure&&dist<76&&this.world.lineClear(at,eye))this.onDamage(z.kind==='dog'?40:z.kind==='nova'?45:50);}
        if(z.attackLeft<=0){z.state='chase';z.rig.play('walk',true,1,BLEND);}continue;
      }
      if(!lure&&dist<62&&Math.abs(z.root.position.y-player.y)<50&&s.phase!=='reviving'&&this.world.lineClear(at,eye)){
        z.state='attack';z.attackLeft=1.15;z.attackDealt=false;z.rig.play('attack',false,1,BLEND);continue;
      }
````

**Edit 5: Find**

````js
        else{
          const next=z.root.position.clone().addScaledVector(delta,Math.min(1,z.speed*dt/horizontal));
          for(const other of this.list){if(other===z||other.state==='barricade')continue;const sep=next.clone().sub(other.root.position);sep.y=0;const d=sep.length();if(d<29&&d>.01)next.addScaledVector(sep,(29-d)/d*dt*2);}
````

**Replace with**

````js
        else{
          const want={x:delta.x/horizontal,y:delta.y/horizontal,z:delta.z/horizontal};
          z.heading=z.heading?steerDirection(z.heading,want,dt,STEER_RATE):want;
          const next=z.root.position.clone().addScaledVector(new THREE.Vector3(z.heading.x,z.heading.y,z.heading.z),Math.min(z.speed*dt,horizontal));
          for(const other of this.list){if(other===z||other.state==='barricade')continue;const sep=next.clone().sub(other.root.position);sep.y=0;const d=sep.length();if(d<29&&d>.01)next.addScaledVector(sep,(29-d)/d*dt*2);}
````

**Edit 6: Find**

````js
          if(safe&&safe.distanceTo(next)<38)z.root.position.copy(safe);
          z.root.rotation.y=Math.atan2(-delta.z,delta.x);
        }
````

**Replace with**

````js
          if(safe&&safe.distanceTo(next)<38)z.root.position.copy(safe);
          z.root.rotation.y=turnToward(z.root.rotation.y,Math.atan2(-z.heading.z,z.heading.x),dt,{rate:14});
        }
````

### `export/web/game.js`  (6 edits)

**Edit 1: Find**

````js
import { configureKinoAssets, assetDiagnostics } from './runtime-assets.js';
````

**Replace with**

````js
import { configureKinoAssets, assetDiagnostics } from './runtime-assets.js';
import { assets, rfetch } from './asset-loader.js';
import { smoothingEnabled } from './steering.js';
import { AdaptiveResolution, createPerfOverlay } from './quality.js';
````

**Edit 2: Find**

````js
const renderer=new THREE.WebGLRenderer({antialias:!profile.mobile,powerPreference:profile.mobile?'default':'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,profile.mobile?1:1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
let previous=performance.now(),lastRendered=0,renderedFrames=0,contextLost=false,resizeTimer;
````

**Replace with**

````js
const renderer=new THREE.WebGLRenderer({antialias:!profile.mobile,powerPreference:profile.mobile?'default':'high-performance'});
const basePixelRatio=Math.min(devicePixelRatio,profile.mobile?1:1.5),adapt=new AdaptiveResolution({min:profile.mobile?.6:.65,targetMs:profile.mobile?1000/30:1000/60,enabled:!/[?&]adaptive=0\b/.test(location.search)}),perf=createPerfOverlay();
if(/[?&]fx=0\b/.test(location.search))document.body.classList.add('no-fx');
renderer.setPixelRatio(basePixelRatio);profile.anisotropy=Math.min(profile.mobile?2:8,renderer.capabilities.getMaxAnisotropy());renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
let previous=performance.now(),lastRendered=0,renderedFrames=0,contextLost=false,resizeTimer;
````

**Edit 3: Find**

````js
function progress(text,percent){$('load-label').textContent=text;$('load-progress').style.width=percent+'%';}
function toast(text,duration=2.5){$('toast').textContent=text;toastUntil=(session?.time??0)+duration;}
````

**Replace with**

````js
function progress(text,percent){$('load-label').textContent=text;$('load-progress').style.width=percent+'%';}
// Real byte progress for the big downloads, instead of a bar parked at 15%.
let byteProgress=false;
assets.onProgress(s=>{if(!byteProgress||!s.total)return;const mb=n=>(n/1048576).toFixed(0);$('load-label').textContent=`Loading the theater · ${mb(s.loaded)} / ${mb(s.total)} MB`;$('load-progress').style.width=(10+s.fraction*70)+'%';});
function showRetry(){if($('retry'))return;const b=document.createElement('button');b.id='retry';b.textContent='RETRY';b.onclick=()=>location.reload();$('loading').appendChild(b);}
function toast(text,duration=2.5){$('toast').textContent=text;toastUntil=(session?.time??0)+duration;}
````

**Edit 4: Find**

````js
try{
  progress('Loading game data',5);data=await fetch('game-data.json').then(r=>r.json());session=new Session(data);world=new World(scene,data);await world.load(progress);
  spawn=data.entities.find(e=>e.targetname==='initial_spawn_points'&&e.script_int==='1');
  player=new PlayerController(camera,world.physics,{spawn:vector(spawn.position),spawnIsEye:false,radius:14,height:70,eyeHeight:60,moveSpeed:190,sprintSpeed:285,crouchSpeed:95,gravity:800,jumpHeight:39,fallResetY:-800,maxSubSteps:12,groundSnapSpeed:10});
  camera.rotation.set(0,spawn.yaw-Math.PI/2,0);world.setDoors(session);
````

**Replace with**

````js
try{
  progress('Loading game data',5);{const m=document.querySelector('meta[name="kino-asset-manifest"]');if(m)await assets.loadManifest(m.content||'asset-manifest.json');}data=await rfetch('game-data.json').then(r=>r.json());session=new Session(data);world=new World(scene,data);byteProgress=true;await world.load(progress);byteProgress=false;
  spawn=data.entities.find(e=>e.targetname==='initial_spawn_points'&&e.script_int==='1');
  player=new PlayerController(camera,world.physics,{spawn:vector(spawn.position),spawnIsEye:false,radius:14,height:70,eyeHeight:60,moveSpeed:190,sprintSpeed:285,crouchSpeed:95,gravity:800,jumpHeight:39,fallResetY:-800,maxSubSteps:12,groundSnapSpeed:10,smoothCamera:smoothingEnabled()});
  camera.rotation.set(0,spawn.yaw-Math.PI/2,0);world.setDoors(session);
````

**Edit 5: Find**

````js
  progress('Ready',100);$('loading').hidden=true;$('start').disabled=contextLost;$('menu-status').textContent=contextLost?'Graphics paused. Waiting for Safari to restore the game…':touchControls.mode?'Tap to enter the theater':'Click to capture the mouse · Esc to pause';
}catch(error){console.error(error);errors.push(String(error));$('load-label').textContent='Unable to start: '+error.message;$('menu-status').textContent='See browser console for details';}
renderer.info.autoReset=false;
````

**Replace with**

````js
  progress('Ready',100);$('loading').hidden=true;$('start').disabled=contextLost;$('menu-status').textContent=contextLost?'Graphics paused. Waiting for Safari to restore the game…':touchControls.mode?'Tap to enter the theater':'Click to capture the mouse · Esc to pause';
}catch(error){console.error(error);errors.push(String(error));byteProgress=false;$('load-label').textContent='Unable to start: '+error.message;$('menu-status').textContent=error.name==='LfsPointerError'?'The game files were not deployed correctly. See the message above.':'Check your connection, then retry. Files that already finished downloading are kept.';showRetry();}
renderer.info.autoReset=false;
````

**Edit 6: Find**

````js
  if(lastRendered&&now-lastRendered<interval-1)return;
  lastRendered=now;const dt=Math.min((now-previous)/1000,.06);previous=now;frameTime+=dt;frameCount++;renderedFrames++;
  if(frameTime>.75){fps=Math.round(frameCount/frameTime);frameTime=0;frameCount=0;}
  update(dt);renderer.info.reset();renderer.clear();renderer.render(scene,camera);if(ready&&started){renderer.clearDepth();renderer.render(viewScene,viewCamera);}
````

**Replace with**

````js
  if(lastRendered&&now-lastRendered<interval-1)return;
  lastRendered=now;const dt=Math.min((now-previous)/1000,.06);previous=now;frameTime+=dt;
  if(ready&&started&&active){const scale=adapt.sample(dt*1000);if(scale!==null)renderer.setPixelRatio(basePixelRatio*scale);}frameCount++;renderedFrames++;
  if(frameTime>.75){fps=Math.round(frameCount/frameTime);frameTime=0;frameCount=0;perf?.(fps,adapt.scale,renderer.info.render.calls,renderer.info.render.triangles);}
  update(dt);renderer.info.reset();renderer.clear();renderer.render(scene,camera);if(ready&&started){renderer.clearDepth();renderer.render(viewScene,viewCamera);}
````

### `export/web/index.html`  (1 edit)

**Edit 1: Find**

````
<meta name="twitter:image:alt" content="Kino der Toten: Solo Survival. Zombies emerge from the shadows of a ruined theater with red curtains and twin staircases.">
<link rel="stylesheet" href="style.css"><link rel="icon" href="data:,"><link rel="stylesheet" href="touch-controls.css"></head><body class="menu-open">
<div id="vignette"></div><div id="hurt"></div><div id="flash"></div>
````

**Replace with**

````
<meta name="twitter:image:alt" content="Kino der Toten: Solo Survival. Zombies emerge from the shadows of a ruined theater with red curtains and twin staircases.">
<link rel="stylesheet" href="style.css"><link rel="icon" href="data:,"><link rel="stylesheet" href="touch-controls.css"></head><body class="menu-open"><div id="fx" aria-hidden="true"></div>
<div id="vignette"></div><div id="hurt"></div><div id="flash"></div>
````

### `export/web/player-controller.js`  (5 edits)

**Edit 1: Find**

````js
import { Octree } from 'three/addons/math/Octree.js';
````

**Replace with**

````js
import { Octree } from 'three/addons/math/Octree.js';
import { CameraSmoother } from './camera-smoothing.js';
````

**Edit 2: Find**

````js
    this.crouchSpeed = Math.max(0, numberOr(options.crouchSpeed, 190));
    this.groundAcceleration = Math.max(0, numberOr(options.groundAcceleration, 2600));
````

**Replace with**

````js
    this.crouchSpeed = Math.max(0, numberOr(options.crouchSpeed, 190));
    // Visual-only camera easing (crouch, stairs, landing). Off unless the game asks for it.
    this._smoother = options.smoothCamera ? new CameraSmoother() : null;
    this._lastDt = 0;
    this.groundAcceleration = Math.max(0, numberOr(options.groundAcceleration, 2600));
````

**Edit 3: Find**

````js
    this._ladderExitTimer = 0;
````

**Replace with**

````js
    this._ladderExitTimer = 0;
    this._smoother?.reset();
````

**Edit 4: Find**

````js
    const dt = clamp(numberOr(deltaSeconds, 0), 0, this.maxDelta);
    this._accumulator = Math.min(
````

**Replace with**

````js
    const dt = clamp(numberOr(deltaSeconds, 0), 0, this.maxDelta);
    this._lastDt = dt;
    this._accumulator = Math.min(
````

**Edit 5: Find**

````js
    const feetY = this.collider.start.y - this.radius;
    this.camera.position.set(this.collider.start.x, feetY + this._eyeHeight, this.collider.start.z);
  }
````

**Replace with**

````js
    const feetY = this.collider.start.y - this.radius;
    if (!this._smoother) { this.camera.position.set(this.collider.start.x, feetY + this._eyeHeight, this.collider.start.z); return; }
    const view = this._smoother.update(this._lastDt, { feetY, eyeHeight: this._eyeHeight, onFloor: this.onFloor, velocityY: this.velocity.y });
    this.camera.position.set(this.collider.start.x, feetY + view.eye + view.offset, this.collider.start.z);
  }
````

### `export/web/runtime-assets.js`  (1 edit)

**Edit 1: Find**

````js
export const assetManager = new THREE.LoadingManager();
export const runtimeProfile = { mobile: false };
const textures = new Map();
````

**Replace with**

````js
export const assetManager = new THREE.LoadingManager();
export const runtimeProfile = { mobile: false, anisotropy: 1 };
const textures = new Map();
````

### `export/web/style.css`  (1 edit)

**Edit 1: Find**

````
#objective{position:fixed;top:84px;left:36px;color:#c6b89a;font:11px/1.5 sans-serif;letter-spacing:1px;pointer-events:none;text-shadow:0 1px 3px #000;z-index:3}.menu-open #objective{display:none}#grenades{max-width:560px;line-height:1.7}
````

**Replace with**

````
#objective{position:fixed;top:84px;left:36px;color:#c6b89a;font:11px/1.5 sans-serif;letter-spacing:1px;pointer-events:none;text-shadow:0 1px 3px #000;z-index:3}.menu-open #objective{display:none}#grenades{max-width:560px;line-height:1.7}

/* Cheap atmosphere: a static vignette and faint grain composited above the canvas, below the HUD.
   No extra render passes. Disable with ?fx=0 (adds class no-fx). */
#fx{position:fixed;inset:0;z-index:1;pointer-events:none;background:radial-gradient(ellipse at 50% 46%,transparent 52%,rgba(0,0,0,.28) 82%,rgba(0,0,0,.5) 100%)}
#fx::after{content:"";position:absolute;inset:0;opacity:.045;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>")}
body.no-fx #fx{display:none}
#loading #retry{margin-top:14px}
````

### `export/web/world.js`  (2 edits)

**Edit 1: Find**

````js
import { assetManager, runtimeProfile } from './runtime-assets.js';
````

**Replace with**

````js
import { assetManager, runtimeProfile } from './runtime-assets.js';
import { assets } from './asset-loader.js';
import { applyAnisotropy } from './quality.js';
````

**Edit 2: Find**

````js
    progress('Loading the theater',15);
    const loadMap=()=>new GLTFLoader(assetManager).loadAsync('kino.gltf');
    const loadCollision=()=>loadCollisionWorld({metadataUrl:'collision.json'});
    const [gltf,collision,bytes]=runtimeProfile.mobile
      ? [await loadMap(),await loadCollision(),await fetch('navigation.bin').then(r=>r.arrayBuffer())]
      : await Promise.all([loadMap(),loadCollision(),fetch('navigation.bin').then(r=>r.arrayBuffer())]);
    await init();
    censorFlags(gltf.scene);
````

**Replace with**

````js
    progress('Loading the theater',15);
    // Every large download starts at once and goes through the resilient loader (byte progress,
    // retries, stall detection, LFS-pointer fallback, cache). Phones still parse one asset at a
    // time so peak memory is unchanged: the 91 MB collision download waits for the geometry.
    const early=p=>{p.catch(()=>{});return p;};   // a failure is reported where it is awaited
    const loadCollision=()=>early(loadCollisionWorld({metadataUrl:'collision.json'}));
    const geometry=early(assets.prefetchBlob('kino.bin'));
    const navigation=early(assets.buffer('navigation.bin'));
    const recast=early(init());
    let collisionLoad=runtimeProfile.mobile?null:loadCollision();
    await geometry;
    assetManager.setURLModifier(assets.urlModifier);
    const gltf=await new GLTFLoader(assetManager).loadAsync('kino.gltf');
    assets.release('kino.bin');
    applyAnisotropy(gltf.scene,runtimeProfile.anisotropy);
    collisionLoad??=loadCollision();
    const [collision,bytes]=await Promise.all([collisionLoad,navigation]);
    await recast;
    censorFlags(gltf.scene);
````

---

## 4. Optional: tests and notes

Run with `npm test`. Expected: all pass except one collision test that also fails on any checkout where `collision.bin` is an LFS pointer.

### `test/asset-loader.test.mjs`

````js
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { AssetLoader, LfsPointerError, fetchBytes, parseLfsPointer, defaultBases } from '../export/web/asset-loader.js';

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
  assert.deepEqual(bases, ['https://a.example/x/', 'https://b.example/', 'https://media.githubusercontent.com/media/me/proj/main/export/web/']);
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
````

### `test/quality.test.mjs`

````js
import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveResolution, applyAnisotropy, createPerfOverlay } from '../export/web/quality.js';
import { shortestAngle, turnToward } from '../export/web/steering.js';

const feed = (a, ms, frames) => { let last = null; for (let i = 0; i < frames; i++) { const r = a.sample(ms); if (r !== null) last = r; } return last; };

test('render scale drops when frames run long and never goes below the floor', () => {
  const a = new AdaptiveResolution({ min: .6, step: .1, windowFrames: 10 });
  assert.equal(feed(a, 25, 10), .9);
  feed(a, 25, 200);
  assert.equal(a.scale, .6);
});
test('a healthy frame rate keeps full resolution', () => {
  const a = new AdaptiveResolution({ windowFrames: 10 });
  assert.equal(feed(a, 16.5, 500), null);
  assert.equal(a.scale, 1);
});
test('hitches, pauses and disabled mode are ignored', () => {
  const a = new AdaptiveResolution({ windowFrames: 5 });
  assert.equal(feed(a, 500, 50), null);
  const off = new AdaptiveResolution({ windowFrames: 5, enabled: false });
  assert.equal(feed(off, 40, 50), null);
});
test('probes back up when stable, and backs off after a failed probe', () => {
  const a = new AdaptiveResolution({ windowFrames: 5, step: .1 });
  feed(a, 25, 5); assert.equal(a.scale, .9);
  const up = feed(a, 16, 5 * 4); assert.equal(up, .95, 'probe after 4 stable windows');
  assert.equal(feed(a, 25, 5), .85, 'failed probe drops again');
  assert.equal(a.holdWindows, 8, 'and waits longer before probing');
});
test('aim for the display cap: a 30 fps target tolerates 33 ms frames', () => {
  const a = new AdaptiveResolution({ targetMs: 1000 / 30, windowFrames: 10 });
  assert.equal(feed(a, 33.4, 200), null);
});

test('anisotropy is applied once per texture and never lowered', () => {
  const shared = { anisotropy: 1 }, sharp = { anisotropy: 16 };
  const root = { traverse(fn) { fn({ material: { map: shared, normalMap: sharp } }); fn({ material: [{ map: shared }, { emissiveMap: { anisotropy: 1 } }] }); fn({}); } };
  assert.equal(applyAnisotropy(root, 8), 3);
  assert.equal(shared.anisotropy, 8); assert.equal(sharp.anisotropy, 16);
  assert.equal(applyAnisotropy(root, 1), 0);
});
test('perf overlay only exists with ?perf=1', () => {
  assert.equal(createPerfOverlay('', {}), null);
  assert.equal(createPerfOverlay('?perf=0', {}), null);
});

test('shortestAngle takes the short way around', () => {
  assert.ok(Math.abs(shortestAngle(3.0, -3.0) - (2 * Math.PI - 6)) < 1e-9);
  assert.ok(Math.abs(shortestAngle(-3.0, 3.0) + (2 * Math.PI - 6)) < 1e-9);
});
test('turnToward eases, never overshoots and respects the speed cap', () => {
  let y = 0;
  const seen = [];
  for (let i = 0; i < 120; i++) { y = turnToward(y, 2, 1 / 60); seen.push(y); }
  assert.ok(seen.every((v, i) => !i || v >= seen[i - 1]), 'monotonic');
  assert.ok(seen.every(v => v <= 2 + 1e-9), 'no overshoot');
  assert.ok(Math.abs(seen.at(-1) - 2) < .01, 'arrives');
  assert.ok(seen[0] <= Math.PI * 2.4 / 60 + 1e-9, 'first step capped');
  assert.ok(Math.abs(turnToward(0, 2, 0) ) < 1e-12, 'zero dt does not move');
});
test('turnToward wraps across the +-pi seam instead of spinning the long way', () => {
  const y = turnToward(3.0, -3.0, 1 / 60);
  assert.ok(y > 3.0, 'continues increasing through pi, not back through zero');
});
````

### `test/smoothing.test.mjs`

````js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraSmoother } from '../export/web/camera-smoothing.js';
import { damp, steerDirection, smoothingEnabled } from '../export/web/steering.js';

const run = (s, frames, dt, state) => { let out; for (let i = 0; i < frames; i++) out = s.update(dt, typeof state === 'function' ? state(i) : state); return out; };
const stand = { feetY: 0, eyeHeight: 60, onFloor: true, velocityY: 0 };

test('damp is frame-rate independent', () => {
  let a = 0, b = 0;
  for (let i = 0; i < 60; i++) a = damp(a, 1, 10, 1 / 60);
  for (let i = 0; i < 120; i++) b = damp(b, 1, 10, 1 / 120);
  assert.ok(Math.abs(a - b) < 1e-9);
});

test('crouching eases the eye down instead of snapping, then settles exactly', () => {
  const s = new CameraSmoother();
  run(s, 5, 1 / 60, stand);
  const first = s.update(1 / 60, { ...stand, eyeHeight: 40 }).eye;
  assert.ok(first < 60 && first > 50, `first frame ${first} moves only part of the way`);
  const settled = run(s, 120, 1 / 60, { ...stand, eyeHeight: 40 }).eye;
  assert.ok(Math.abs(settled - 40) < .01);
  const up = [];
  for (let i = 0; i < 120; i++) up.push(s.update(1 / 60, stand).eye);
  assert.ok(up.every((v, i) => !i || v >= up[i - 1]), 'standing up is monotonic');
});

test('a stair step is absorbed: the view does not jump, then glides to the new height', () => {
  const s = new CameraSmoother();
  run(s, 5, 1 / 60, stand);
  const before = s.update(1 / 60, stand);
  const after = s.update(1 / 60, { ...stand, feetY: 12 });
  const viewJump = (12 + after.eye + after.offset) - (0 + before.eye + before.offset);
  assert.ok(Math.abs(viewJump) < 2.5, `view moved ${viewJump} instead of 12`);
  const end = run(s, 90, 1 / 60, { ...stand, feetY: 12 });
  assert.ok(Math.abs(end.offset) < .05, 'offset decays to zero');
});

test('walking up a gentle ramp is left alone', () => {
  const s = new CameraSmoother();
  const out = run(s, 120, 1 / 60, i => ({ ...stand, feetY: i * 1.2 }));  // 72 units/s
  assert.ok(Math.abs(out.offset) < 1e-6);
});

test('landing dips the view briefly and recovers; hard falls dip more but are capped', () => {
  const dip = vy => {
    const s = new CameraSmoother();
    run(s, 5, 1 / 60, { ...stand, onFloor: false, velocityY: vy });
    let min = 0, last;
    for (let i = 0; i < 180; i++) { last = s.update(1 / 60, { ...stand, onFloor: true }); min = Math.min(min, last.offset); }
    assert.ok(Math.abs(last.offset) < .05, 'recovers');
    return min;
  };
  const small = dip(-200), hard = dip(-700), extreme = dip(-5000);
  assert.ok(small < -.3 && small > -3.6);
  assert.ok(hard <= small);
  assert.ok(extreme >= -3.5 - 1e-9, 'capped');
  assert.equal(dip(-60), 0, 'tiny drops do nothing');
});

test('teleports and respawns do not glide across the map', () => {
  const s = new CameraSmoother();
  run(s, 5, 1 / 60, stand);
  const out = s.update(1 / 60, { ...stand, feetY: 900 });
  assert.equal(out.offset, 0);
});

test('steerDirection bends a path gradually and keeps horizontal speed constant', () => {
  const dir = { x: 1, y: 0, z: 0 };
  const want = { x: 0, y: 0, z: 1 };
  steerDirection(dir, want, 1 / 60, 8);
  assert.ok(dir.x > .9 && dir.z > 0 && dir.z < .5, 'first frame turns only a little');
  assert.ok(Math.abs(Math.hypot(dir.x, dir.z) - 1) < 1e-9);
  for (let i = 0; i < 120; i++) steerDirection(dir, want, 1 / 60, 8);
  assert.ok(dir.z > .999);
});
test('steerDirection with an infinite rate is the old instant behaviour', () => {
  const dir = { x: 1, y: 0, z: 0 };
  steerDirection(dir, { x: 0, y: .25, z: 1 }, 1 / 60, Infinity);
  assert.deepEqual([dir.x, dir.y, dir.z], [0, .25, 1]);
});
test('steerDirection survives an exact reversal', () => {
  const dir = { x: 1, y: 0, z: 0 };
  steerDirection(dir, { x: -1, y: 0, z: 0 }, 1 / 60, Infinity);
  assert.equal(dir.x, -1);
  const d2 = { x: 1, y: 0, z: 0 };
  for (let i = 0; i < 5; i++) steerDirection(d2, { x: -1, y: 0, z: 0 }, 1 / 60, 8);
  assert.ok(Number.isFinite(d2.x) && Number.isFinite(d2.z));
});

test('?smooth=0 disables smoothing', () => {
  assert.equal(smoothingEnabled(''), true);
  assert.equal(smoothingEnabled('?perf=1&smooth=0'), false);
  assert.equal(smoothingEnabled('?smooth=1'), true);
});
````

### `LOADING.md`

````md
# Loading, hosting and quality switches

## What changed
* **Real progress.** The loading bar reports bytes (`Loading the theater · 48 / 143 MB`) instead of sitting at 15%.
* **Resilient downloads.** Every large file streams through `asset-loader.js`: stalled requests (no data for 20 s)
  are aborted and retried with backoff, 404/403 fail fast, and failures show a message plus a **RETRY** button.
* **Git LFS pointers are detected.** If a host serves the 130-byte LFS pointer instead of the real file, the game says
  which file and how large it should be, and tries alternate hosts (below) before giving up.
* **Parallel and cached.** Geometry, collision, navmesh and the recast WASM download/initialise together (phones keep
  one-at-a-time *parsing* so peak memory is unchanged). Large files are kept in Cache Storage, so later visits skip the
  download; a changed file size on the server invalidates the cached copy.
* **Loads from anywhere.** All URLs resolve against the page, so any folder or sub-path works.

## Hosting
Serve `export/web` with the real files, not LFS pointers (`git lfs pull` before deploying). If you cannot, point the
game at a host that has them:
* `?assets=https://host/path/` (comma-separate several), or
* `window.KINO_ASSET_BASES=['https://host/path/']` before the module loads.
On `<user>.github.io/<repo>/` the loader also tries `media.githubusercontent.com/media/<user>/<repo>/main/export/web/`
(best effort; requires that host to allow cross-origin reads).

## Optional: smaller downloads
`node .tools/compress-assets.mjs` writes `*.bin.gz` plus `asset-manifest.json`. Add
`<meta name="kino-asset-manifest" content="asset-manifest.json">` to `index.html` to use them. Check the printed ratios first.

## Quality switches (all URL parameters)
| Parameter | Effect |
| --- | --- |
| `?perf=1` | overlay with fps, render scale, draw calls, triangles - use it to compare before/after |
| `?adaptive=0` | disable dynamic resolution |
| `?fx=0` | disable the vignette/grain overlay |

Dynamic resolution lowers the render scale (down to 65% desktop / 60% mobile) when frames run long and probes back up
when stable. Anisotropic filtering (8x desktop, 2x mobile) is applied to world textures before their first upload.
Zombies now turn with eased, rate-limited yaw instead of snapping to the next path node.

## Not verified here
The real Kino geometry could not be downloaded in the authoring environment, so frame rates and visual quality were
not measured. Loader behaviour was verified with unit tests and in headless Chromium against pointer and placeholder files.
````
