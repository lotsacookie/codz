import assert from 'node:assert/strict';
import { register } from 'node:module';
// Resolve 'three' to the vendored copy so the test runs with plain node and no npm install.
const vendor = new URL('../export/web/assets/js/vendor/three.module.js', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(vendor)}, shortCircuit: true } : n(s, c); }`));
const THREE = await import(vendor);
const { windowStandPoint, groundStand, WINDOW_CLOSER } = await import('../export/web/assets/js/window-stand.js');
const outside = new THREE.Vector3(100, 106, 0), inside = new THREE.Vector3(0, 100, 0);
const stand = windowStandPoint(outside, inside);
assert.ok(Math.abs(stand.x - (100 - WINDOW_CLOSER)) < 1e-6 && stand.z === 0 && stand.y === 106);
assert.equal(groundStand(stand, null), false);
assert.equal(groundStand(stand, new THREE.Vector3(500, 0, 0)), false);
assert.equal(stand.y, 106);
assert.equal(groundStand(stand, new THREE.Vector3(80, 66, 3)), true);
assert.equal(stand.y, 66); assert.ok(Math.abs(stand.x - 84) < 1e-6);
console.log('window stand ok');
