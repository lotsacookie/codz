import assert from 'node:assert/strict';
import { register } from 'node:module';
// Resolve 'three' to the vendored copy so the test runs with plain node and no npm install.
const vendor = new URL('../export/web/assets/js/vendor/three.module.js', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(vendor)}, shortCircuit: true } : n(s, c); }`));
const THREE = await import(vendor);
const { placeKinoBoards, boardGeometry } = await import('../export/web/assets/js/window-boards.js');
const template = JSON.parse((await import('node:fs')).readFileSync(new URL('../export/web/assets/custom-maps/window-boards.json', import.meta.url), 'utf8'));
const material = new THREE.MeshStandardMaterial();
const kino = { ...template, material };
assert.equal(kino.boards.length, 6);
const entities = [], scene = new THREE.Group();
const add = e => { const r = { id: entities.length, ...e }; entities.push(r); return r; };
// The One Window Challenge window: opening 120 wide on the -X wall, room towards +X, sill 36, top 120.
const ids = placeKinoBoards(kino, { add, scene, name: 'owc_window', x: -512, y: 0, z: 0, t: [0, 1], n: [1, 0], width: 120, sill: 36, top: 120 });
assert.equal(ids.length, 6); assert.equal(scene.children.length, 6);
assert.ok(entities.every(e => e.script_parameters === 'board' && e.targetname === 'owc_window'));
assert.deepEqual(entities.map(e => e.script_noteworthy), ['1', '2', '3', '4', '5', '6']);
scene.children.forEach((m, i) => {
  assert.equal(m.userData.entityId, ids[i]); assert.equal(m.material, material);
  assert.ok(m.position.y > 36 && m.position.y < 120, 'plank sits inside the opening height');
  assert.ok(Math.abs(m.position.z) < 70 && Math.abs(m.position.x + 512) < 12, 'plank sits in the wall opening');
});
const g = boardGeometry([10, 4, 2]); assert.ok(g.attributes.uv.count > 0);
console.log('window boards ok');
