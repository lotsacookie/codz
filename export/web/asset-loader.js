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
      let pos = 0;
      const body = new ReadableStream({ pull(c) { if (pos >= bytes.byteLength) return c.close(); c.enqueue(bytes.subarray(pos, pos += 1 << 20)); } });
      await cache.put(url, new Response(body, { headers: { 'content-length': String(bytes.byteLength) } }));
    } catch { /* quota or private mode: caching is optional */ }
  }
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

  async getBytes(url, signal, into, { stallMs = this.stallMs, retries = this.retries } = {}) {
    const entry = this.files.get(url) ?? this.track(url);
    entry.failed = false;
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
            fetchImpl: this.fetchImpl, retries, stallMs, backoffMs: this.backoffMs, signal, into: isGz ? undefined : into,
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

export let assets = new AssetLoader({ bases: typeof location === 'undefined' ? [] : defaultBases() });
export function configureAssets(options) { assets = new AssetLoader(options); return assets; }
export const rfetch = (input, init) => assets.fetch(input, init);
