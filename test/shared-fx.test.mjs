import assert from 'node:assert/strict';
import { register } from 'node:module';
// Resolve 'three' to the vendored copy so the test runs with plain node and no npm install.
const vendor = new URL('../export/web/assets/js/vendor/three.module.js', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(vendor)}, shortCircuit: true } : n(s, c); }`));
const { quakeAt, installSharedFx } = await import('../export/web/assets/js/shared-fx.js');
const at = (x) => ({ x, distanceTo(o) { return Math.abs(this.x - o.x); }, clone() { return at(this.x); } });
const builds = [], view = { cameraFx: { build: s => builds.push(s) } }, camera = { position: at(0) };
assert.equal(quakeAt(camera, view, at(2000)), false);
assert.equal(quakeAt(camera, view, at(100)), true);
assert.ok(builds.length === 1 && builds[0] > .15 && builds[0] <= 1.4);
const log = [], spawned = [];
class FakeDog { begin() { log.push('begin'); } update() {} clear() {} }
const combat = { scene: {}, camera, view, explosions: {}, data: { powerups: { nuke: 1 } }, session: {}, pickups: { spawn: (t) => spawned.push(t) } };
installSharedFx(combat, { DogFx: FakeDog, delay: 5 });
combat.explosions.onBlast(at(50), 300);
assert.equal(builds.length, 2);
combat.dropPowerup('nope', at(10)); combat.dropPowerup('nuke', at(10));
assert.deepEqual(log, ['begin']);
await new Promise(r => setTimeout(r, 30));
assert.deepEqual(spawned, ['nuke']);
console.log('shared fx ok');
