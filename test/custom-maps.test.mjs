import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import * as THREE from 'three';
import { unzip } from '../export/web/custom-maps/zip.js';
import { appendBoxes, fitModel } from '../export/web/custom-maps/geometry.js';
import { createProbe, planLevel } from '../export/web/custom-maps/analyze.js';
import { createGridNavigation } from '../export/web/custom-maps/runtime.js';
import { khronos, sketchfab, isModelUrl } from '../export/web/custom-maps/providers.js';

const box = (min, max) => ({ min: new THREE.Vector3(...min), max: new THREE.Vector3(...max) });

function zipOf(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data, deflate] of entries) {
    const raw = Buffer.from(data), body = deflate ? deflateRawSync(raw) : raw, label = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(label.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(label.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, label, body);
    centrals.push(central, label);
    offset += 30 + label.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('zip archives with stored and deflated entries are read', async () => {
  const files = await unzip(zipOf([['scene.gltf', '{"asset":{}}', false], ['textures/a.bin', 'abcabcabcabc'.repeat(20), true]]));
  assert.equal(new TextDecoder().decode(files.get('scene.gltf')), '{"asset":{}}');
  assert.equal(new TextDecoder().decode(files.get('textures/a.bin')), 'abcabcabcabc'.repeat(20));
});

test('models are scaled into a playable size and sat on the floor', () => {
  const small = fitModel(new THREE.Box3(new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 3, 1)));
  assert.ok(Math.abs(small.scale - 900) < 1e-6);
  const room = fitModel(new THREE.Box3(new THREE.Vector3(-15, 5, -15), new THREE.Vector3(15, 9, 15)));
  assert.ok(Math.abs(room.scale - 39.3701) < 1e-6);
  assert.ok(Math.abs(room.offset.y + 5 * 39.3701) < 1e-6);
});

test('a walled level gets a window at its doorway, wall spots for every role and a working route', async () => {
  const solids = [
    box([-724, -20, -424], [724, 0, 424]),
    box([-724, 0, -424], [724, 220, -400]), box([-724, 0, 400], [724, 220, 424]),
    box([-724, 0, -424], [-700, 220, 424]), box([700, 0, -424], [724, 220, 424]),
    box([-312, 0, -400], [-288, 220, -60]), box([-312, 0, 60], [-288, 220, 400]),
  ];
  const flat = appendBoxes({ positions: new Float32Array(0), index: new Uint32Array(0) }, solids);
  const probe = createProbe(flat.positions, flat.index);
  const roles = ['a', 'b', 'c', 'd', 'e', 'f'];
  const plan = await planLevel(probe, new THREE.Box3(new THREE.Vector3(-724, -20, -424), new THREE.Vector3(724, 220, 424)), { roles });
  assert.ok(!plan.failed);
  assert.ok(plan.windows.length >= 1);
  const door = plan.windows[0];
  assert.deepEqual(door.n, [1, 0]);
  assert.ok(Math.abs(door.x + 300) < 30 && Math.abs(door.z) < 40);
  assert.ok(door.outside[0] < door.inside[0]);
  assert.equal(plan.sites.length, roles.length);
  for (const site of plan.sites) assert.ok(plan.grid.comp[plan.grid.nearest(site.anchor[0] + site.normal[0] * 60, site.y, site.anchor[1] + site.normal[1] * 60, 3, 90)] === plan.main);
  const Navigation = createGridNavigation(() => ({ grid: plan.grid, spawn: plan.spawn, windows: plan.windows }));
  const nav = new Navigation('./x');
  await nav.load();
  const inside = new THREE.Vector3(...door.inside), spawn = new THREE.Vector3(...plan.spawn.position);
  const route = nav.path(inside, spawn);
  assert.ok(route.length >= 2 && route.at(-1).distanceTo(spawn) < 1);
  assert.equal(nav.canReach(new THREE.Vector3(...door.outside), spawn), false);
  assert.equal(nav.viable([{ id: 1, inside }, { id: 2, inside: new THREE.Vector3(...door.outside) }]).length, 1);
});

test('providers turn Sketchfab and Khronos responses into pages of named maps', async () => {
  const fetchImpl = async url => ({
    ok: true,
    json: async () => String(url).includes('sketchfab')
      ? { results: [{ uid: 'u1', name: 'Bunker', user: { displayName: 'Ann' }, thumbnails: { images: [{ url: 'big', width: 800 }, { url: 'small', width: 200 }] }, faceCount: 52000 }], cursors: { next: 'c2' } }
      : Array.from({ length: 30 }, (_, i) => ({ name: `Model${i}`, screenshot: 'screenshot/screenshot.jpg', tags: [], variants: { 'glTF-Binary': `Model${i}.glb` } })),
  });
  const first = await sketchfab.search({ query: 'bunker', fetchImpl });
  assert.deepEqual([first.items[0].name, first.items[0].author, first.items[0].thumb, first.next], ['Bunker', 'Ann', 'small', 'c2']);
  assert.equal(first.items[0].art, 'big');
  const page = await khronos.search({ cursor: '12', fetchImpl });
  assert.equal(page.items.length, 12);
  assert.equal(page.next, '24');
  assert.match(page.items[0].url, /glTF-Binary\/Model\d+\.glb$/);
  assert.ok(isModelUrl('https://x.test/a/b.glb?v=1') && !isModelUrl('bunker'));
});

test('BSP maps load as textured geometry and the index lists them', async () => {
  const { readFileSync } = await import('node:fs');
  const { loadBspBuffer } = await import('../export/web/custom-maps/bsp.js');
  const index = JSON.parse(readFileSync(new URL('../export/web/maps/bsp/maps.json', import.meta.url), 'utf8'));
  assert(index.maps.length > 0);
  for (const map of index.maps) assert(readFileSync(new URL(`../export/web/maps/bsp/${map.file}`, import.meta.url)).length === map.size);
  const scene = loadBspBuffer(readFileSync(new URL('../export/web/maps/bsp/boxxer.bsp', import.meta.url)));
  assert(scene.triangles > 100 && scene.root.children.length > 0);
  assert(!scene.root.children.some(mesh => /trigger|sky/i.test(mesh.name)));
  const box = new THREE.Box3().setFromObject(scene.root);
  assert(box.max.y - box.min.y > 50);
});

test('BSP maps are laid out from their NZ:P entities', async () => {
  const { readFileSync } = await import('node:fs');
  const { loadBspBuffer } = await import('../export/web/custom-maps/bsp.js');
  const { createCustomWorld } = await import('../export/web/custom-maps/world.js');
  const root = loadBspBuffer(readFileSync(new URL('../export/web/maps/bsp/4all.bsp', import.meta.url))).root;
  const world = await createCustomWorld(root, { scale: 1, loadModel: null });
  assert.equal(world.layout.windows.length, 17);
  assert.equal(world.layout.doors.length, 12);
  assert(world.layout.sites.some(site => site.role === 'pack') && world.layout.sites.some(site => site.role === 'chest'));
  const triggers = world.data.entities.filter(e => e.targetname === 'zombie_door');
  assert.equal(triggers.length, 12);
  assert(triggers.every(e => Number(e.zombie_cost) > 0));
});
