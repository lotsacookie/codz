import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodePack, parsePack } from '../export/web/asset-pack.js';
import { AssetLoader } from '../export/web/asset-loader.js';
import { collectAssets, collectShared, sharedPackName, verifyPacks, writePacks } from '../.tools/build-asset-pack.mjs';

const bytesOf = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

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
  const root = mkdtempSync(path.join(tmpdir(), 'shared-pack-'));
  const put = (rel, data) => {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, data);
  };
  put('kino.gltf', JSON.stringify({ images: [{ uri: 'textures/wall.png' }] }));
  put('textures/wall.png', bytesOf(40, 2));
  put('textures-mobile/wall.png', bytesOf(10, 3));
  put('models/t5_weapon_gun_viewmodel.glb', glb({ images: [{ uri: '../textures/gun_c.png' }] }));
  put('models/viewhands_usmc.glb', glb({ images: [] }));
  put('models/c_ger_zombie.glb', glb({ images: [{ uri: '../textures/zombie_c.png' }] }));
  put('models/p_prop.glb', glb({ images: [] }));
  put('moon/models/t5_bh_bomb_viewmodel.glb', glb({ images: [{ uri: '../textures/bomb_c.png' }] }));
  put('moon/textures/bomb_c.png', bytesOf(20, 7));
  for (const name of ['gun_c', 'zombie_c']) {
    put(`textures/${name}.png`, bytesOf(20, 5));
    put(`textures-mobile/${name}.png`, bytesOf(6, 6));
  }
  put('animations/viewmodel_fire.json', '{"name":"fire"}');
  put('animations/ai_zombie_walk.json', '{"name":"walk"}');
  put('animations/prop_spin.json', '{"name":"spin"}');
  put('game-data.json', JSON.stringify({
    weapons: { gun: { model: 'models/t5_weapon_gun_viewmodel.glb', animations: { fire: 'animations/viewmodel_fire.json' } } },
    melee: {},
    equipment: {},
    characters: { zombie: 'models/c_ger_zombie.glb' },
    animations: { ai_zombie_walk: 'animations/ai_zombie_walk.json', prop_spin: 'animations/prop_spin.json' },
  }));
  put('moon/combat-data.json', JSON.stringify({
    weapons: {},
    melee: {},
    equipment: { bomb: { model: 'moon/models/t5_bh_bomb_viewmodel.glb' } },
    characters: {},
  }));
  return root;
}

test('weapons and enemies are split into their own sets with their textures', () => {
  const root = makeRoot();
  try {
    const shared = collectShared(root);
    assert.deepEqual(shared.weapons, [
      'animations/viewmodel_fire.json',
      'models/t5_weapon_gun_viewmodel.glb',
      'models/viewhands_usmc.glb',
      'moon/models/t5_bh_bomb_viewmodel.glb',
      'moon/textures/bomb_c.png',
      'textures/gun_c.png',
    ].sort());
    assert.deepEqual(shared.enemies, ['animations/ai_zombie_walk.json', 'models/c_ger_zombie.glb', 'textures/zombie_c.png']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the map pack no longer carries what the shared packs hold', () => {
  const root = makeRoot();
  try {
    const kino = collectAssets(root);
    const shared = new Set(Object.values(collectShared(root)).flat());
    assert.ok(kino.includes('textures/wall.png'));
    assert.ok(kino.includes('models/p_prop.glb'));
    assert.ok(kino.includes('animations/prop_spin.json'));
    for (const rel of kino) assert.ok(!shared.has(rel), `${rel} is in both the map pack and a shared pack`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writePacks builds desktop and mobile shared packs and verifyPacks accepts them', () => {
  const root = makeRoot();
  const out = path.join(root, 'asset-pack');
  try {
    const results = writePacks({ root, outDir: out, maps: [] });
    const names = results.map(r => path.basename(r.file)).sort();
    assert.deepEqual(names, ['enemies-mobile.pack', 'enemies.pack', 'kino-desktop.pack', 'kino-mobile.pack', 'weapons-mobile.pack', 'weapons.pack']);
    const desktop = parsePack(readFileSync(path.join(out, sharedPackName('weapons', 'desktop'))));
    const mobile = parsePack(readFileSync(path.join(out, sharedPackName('weapons', 'mobile'))));
    assert.ok(desktop.has('textures/gun_c.png'));
    assert.ok(mobile.has('textures-mobile/gun_c.png'));
    assert.ok(!mobile.has('textures/gun_c.png'));
    assert.deepEqual(verifyPacks({ root, outDir: out, maps: [] }), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the loader serves files from every loaded pack and keeps earlier packs', async () => {
  const requests = [];
  const files = {
    'https://game.example/asset-pack/weapons.pack': encodePack([{ path: 'models/gun.glb', bytes: bytesOf(12, 1) }]),
    'https://game.example/asset-pack/moon.pack': encodePack([{ path: 'moon/textures/a.png', bytes: bytesOf(8, 2) }]),
  };
  const fetchImpl = async (url) => {
    requests.push(String(url));
    const body = files[String(url)];
    if (!body) return new Response('missing', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-length': String(body.byteLength) } });
  };
  const loader = new AssetLoader({ baseURI: 'https://game.example/', fetchImpl, cachesImpl: null, retries: 0, backoffMs: 0 });
  assert.equal(await loader.loadPack('asset-pack/weapons.pack'), true);
  assert.equal(await loader.loadPack('asset-pack/moon.pack'), true);
  assert.equal(await loader.loadPack('asset-pack/moon.pack'), true);
  assert.equal(requests.filter(url => url.endsWith('moon.pack')).length, 1);
  const gun = await loader.getBytes('https://game.example/models/gun.glb');
  const tex = await loader.getBytes('https://game.example/moon/textures/a.png');
  assert.equal(gun.bytes.byteLength, 12);
  assert.equal(tex.bytes.byteLength, 8);
  assert.equal(requests.length, 2);
  assert.equal(await loader.loadPack('asset-pack/enemies.pack'), false);
  const again = await loader.getBytes('https://game.example/models/gun.glb');
  assert.equal(again.bytes.byteLength, 12);
});
