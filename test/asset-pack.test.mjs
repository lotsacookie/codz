import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodePack, parsePack } from '../export/web/assets/js/asset-pack.js';
import { AssetLoader } from '../export/web/assets/js/asset-loader.js';
import { buildEntries, collectAssets, isPointer, packName, profilePath, verifyPacks, writePacks } from '../.tools/build-asset-pack.mjs';

const BASE = 'https://game.example/play/';
const bytesOf = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);
const pointerText = size => `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize ${size}\n`;

function glb(json) {
  const body = Buffer.from(JSON.stringify(json));
  const chunk = Buffer.concat([body, Buffer.alloc((4 - body.length % 4) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + chunk.length, 8);
  head.writeUInt32LE(chunk.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, chunk]);
}

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'asset-pack-'));
  const put = (rel, data) => {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, data);
  };
  put('kino.gltf', JSON.stringify({ images: [{ uri: 'textures/wall%20one.png' }, { uri: 'textures/~$x&y.png' }, { uri: 'data:image/png;base64,AAAA' }] }));
  put('textures/wall one.png', bytesOf(40, 2));
  put('textures/~$x&y.png', bytesOf(30, 3));
  put('textures-mobile/wall one.png', bytesOf(10, 4));
  put('textures-mobile/~$x&y.png', bytesOf(8, 5));
  put('models/gun.glb', glb({ images: [{ uri: '../textures/game/gun_c.webp' }] }));
  put('textures/game/gun_c.webp', bytesOf(25, 6));
  put('textures-mobile/game/gun_c.webp', bytesOf(9, 7));
  put('game-data.json', JSON.stringify({ icon: 'textures/game/icon.webp' }));
  put('textures/game/icon.webp', bytesOf(12, 8));
  put('textures-mobile/game/icon.webp', bytesOf(6, 9));
  put('animations/a.json', JSON.stringify({ name: 'a' }));
  return { root, put };
}

test('a pack round-trips every entry byte for byte', () => {
  const entries = [{ path: 'a.bin', bytes: bytesOf(100, 1) }, { path: 'dir/b.glb', bytes: bytesOf(7, 2) }, { path: 'empty.json', bytes: new Uint8Array(0) }];
  const pack = parsePack(encodePack(entries));
  assert.equal(pack.count, 3);
  for (const e of entries) assert.deepEqual([...pack.get(e.path)], [...e.bytes]);
  assert.equal(pack.get('nope'), undefined);
  assert.equal(pack.get(null), undefined);
  assert.equal(pack.has('a.bin'), true);
});

test('a pack rejects duplicates, bad signatures, truncation and out-of-range entries', () => {
  assert.throws(() => encodePack([{ path: 'a', bytes: bytesOf(1) }, { path: 'a', bytes: bytesOf(1) }]), /duplicate/);
  const good = encodePack([{ path: 'a', bytes: bytesOf(50) }]);
  assert.throws(() => parsePack(good.subarray(0, good.length - 1)), /truncated/);
  assert.throws(() => parsePack(new Uint8Array(4)), /too small/);
  const bad = good.slice();
  bad[0] = 0;
  assert.throws(() => parsePack(bad), /signature/);
  const index = new TextEncoder().encode(JSON.stringify({ files: { a: [0, 999] } }));
  const forged = new Uint8Array(16 + index.length + 4);
  forged.set([0x4b, 0x50, 0x41, 0x4b], 0);
  const view = new DataView(forged.buffer);
  view.setUint32(4, 1, true);
  view.setUint32(8, index.length, true);
  view.setUint32(12, 4, true);
  forged.set(index, 16);
  assert.throws(() => parsePack(forged), /out of range/);
});

test('a loaded pack answers requests without touching the network, including percent-encoded names', async () => {
  const loader = new AssetLoader({ baseURI: BASE, fetchImpl: async () => { throw new Error('network must not be used'); }, cachesImpl: null });
  const wall = bytesOf(33, 4);
  const odd = bytesOf(21, 5);
  loader.pack = parsePack(encodePack([{ path: 'textures/wall one.png', bytes: wall }, { path: 'textures/~$x&y.png', bytes: odd }]));
  const a = await loader.getBytes(`${BASE}textures/wall%20one.png`);
  assert.deepEqual([...a.bytes], [...wall]);
  const b = await loader.getBytes(`${BASE}textures/~$x&y.png?v=2`);
  assert.deepEqual([...b.bytes], [...odd]);
  const target = new Uint8Array(100);
  const c = await loader.getBytes(`${BASE}textures/wall%20one.png`, undefined, { buffer: target, offset: 10 });
  assert.deepEqual([...c.bytes], [...wall]);
  assert.deepEqual([...target.subarray(10, 10 + wall.length)], [...wall]);
  assert.equal(loader.snapshot().files.length, 0);
  await assert.rejects(() => loader.getBytes(`${BASE}textures/wall%20one.png`, undefined, { buffer: new Uint8Array(5), offset: 0 }), /size mismatch/);
});

test('files missing from the pack fall back to the network', async () => {
  const seen = [];
  const loader = new AssetLoader({ baseURI: BASE, retries: 0, cachesImpl: null, fetchImpl: async url => { seen.push(url); return new Response(bytesOf(5), { status: 200, headers: { 'content-length': '5' } }); } });
  loader.pack = parsePack(encodePack([{ path: 'a.bin', bytes: bytesOf(3) }]));
  const result = await loader.getBytes(`${BASE}other.png`);
  assert.equal(result.bytes.byteLength, 5);
  assert.deepEqual(seen, [`${BASE}other.png`]);
});

test('loadPack installs a valid pack and reports false for a missing, pointer or damaged one', async () => {
  const good = encodePack([{ path: 'models/x.glb', bytes: bytesOf(64, 3) }]);
  const routes = {
    [`${BASE}asset-pack/ok.pack`]: good,
    [`${BASE}asset-pack/pointer.pack`]: new TextEncoder().encode(pointerText(1000)),
    [`${BASE}asset-pack/cut.pack`]: good.subarray(0, good.length - 5),
  };
  const fetchImpl = async url => (routes[url] ? new Response(routes[url], { status: 200, headers: { 'content-length': String(routes[url].byteLength) } }) : new Response('nope', { status: 404 }));
  const warn = console.warn;
  console.warn = () => {};
  try {
    const ok = new AssetLoader({ baseURI: BASE, fetchImpl, retries: 0, cachesImpl: null });
    assert.equal(await ok.loadPack('asset-pack/ok.pack'), true);
    assert.deepEqual([...(await ok.getBytes(`${BASE}models/x.glb`)).bytes], [...bytesOf(64, 3)]);
    for (const name of ['missing.pack', 'pointer.pack', 'cut.pack']) {
      const loader = new AssetLoader({ baseURI: BASE, fetchImpl, retries: 0, cachesImpl: null });
      assert.equal(await loader.loadPack(`asset-pack/${name}`), false, name);
      assert.equal(loader.pack, null);
      assert.equal(loader.snapshot().files.length, 0, name);
    }
  } finally {
    console.warn = warn;
  }
});

test('the collector finds map textures, model textures, game-data textures and animations', () => {
  const { root } = makeRoot();
  try {
    assert.deepEqual(collectAssets(root), [
      'animations/a.json',
      'models/gun.glb',
      'textures/game/gun_c.webp',
      'textures/game/icon.webp',
      'textures/wall one.png',
      'textures/~$x&y.png',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the mobile pack carries the mobile texture variants under the paths the loader requests', () => {
  assert.equal(profilePath('textures/game/a.webp', 'mobile'), 'textures-mobile/game/a.webp');
  assert.equal(profilePath('textures/game/a.webp', 'desktop'), 'textures/game/a.webp');
  assert.equal(profilePath('models/a.glb', 'mobile'), 'models/a.glb');
  const { root } = makeRoot();
  const out = path.join(root, 'asset-pack');
  try {
    const results = writePacks({ root, outDir: out });
    assert.deepEqual(results.map(r => r.profile), ['desktop', 'mobile']);
    const desktop = parsePack(readFileSync(path.join(out, packName('desktop'))));
    const mobile = parsePack(readFileSync(path.join(out, packName('mobile'))));
    assert.equal(desktop.has('textures/wall one.png'), true);
    assert.equal(desktop.has('textures-mobile/wall one.png'), false);
    assert.equal(mobile.has('textures-mobile/wall one.png'), true);
    assert.equal(mobile.has('textures/wall one.png'), false);
    assert.equal(mobile.get('textures-mobile/game/gun_c.webp').byteLength, 9);
    assert.equal(desktop.get('textures/game/gun_c.webp').byteLength, 25);
    assert.deepEqual(verifyPacks({ root, outDir: out }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the builder refuses Git LFS pointers and missing files instead of packing them', () => {
  const { root, put } = makeRoot();
  try {
    put('textures/game/icon.webp', pointerText(5000));
    assert.equal(isPointer(readFileSync(path.join(root, 'textures/game/icon.webp'))), true);
    assert.throws(() => writePacks({ root, outDir: path.join(root, 'out'), profiles: ['desktop'] }), /Git LFS pointer/);
    put('textures/game/icon.webp', bytesOf(12, 8));
    rmSync(path.join(root, 'textures/wall one.png'));
    assert.throws(() => writePacks({ root, outDir: path.join(root, 'out'), profiles: ['desktop'] }), /missing/);
    put('models/gun.glb', pointerText(900));
    assert.throws(() => collectAssets(root), /Git LFS pointer/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verification reports stale and unused pack contents', () => {
  const { root, put } = makeRoot();
  const out = path.join(root, 'asset-pack');
  try {
    writePacks({ root, outDir: out, profiles: ['desktop'] });
    assert.deepEqual(verifyPacks({ root, outDir: out, profiles: ['desktop'] }), []);
    put('textures/game/gun_c.webp', bytesOf(25, 99));
    assert.match(verifyPacks({ root, outDir: out, profiles: ['desktop'] }).join('\n'), /stale/);
    put('textures/game/gun_c.webp', bytesOf(25, 6));
    put('game-data.json', JSON.stringify({}));
    assert.match(verifyPacks({ root, outDir: out, profiles: ['desktop'] }).join('\n'), /no longer used/);
    assert.match(verifyPacks({ root, outDir: out, profiles: ['mobile'] }).join('\n'), /does not exist/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('buildEntries rejects a path that would leave the web root', () => {
  const { root } = makeRoot();
  try {
    assert.throws(() => buildEntries(root, 'desktop', ['../outside.png']), /escapes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
