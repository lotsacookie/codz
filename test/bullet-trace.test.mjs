import assert from 'node:assert/strict';
import { register } from 'node:module';
// Resolve 'three' to the vendored copy so the test runs with plain node and no npm install.
const vendor = new URL('../export/web/assets/js/vendor/three.module.js', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(vendor)}, shortCircuit: true } : n(s, c); }`));
const THREE = await import(vendor);
const { createBulletFilter } = await import('../export/web/assets/js/bullet-trace.js');

const plane = (z, extra = {}) => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.z = z; mesh.userData = extra; mesh.updateMatrixWorld(true); return mesh;
};
// Stand-in for the map's collision raycast: every plane is solid, like the baked collision mesh.
const world = meshes => (ray, near = 0, far = Infinity) => {
  const rc = new THREE.Raycaster(); rc.ray.copy(ray); rc.near = near; rc.far = far;
  const [h] = rc.intersectObjects(meshes, false);
  return h ? { distance: h.distance, position: h.point, triangle: { getNormal: v => v.set(0, 0, 1) } } : false;
};
const ray = () => new THREE.Ray(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

// An invisible collision helper in front of a wall does not stop the shot.
let helper = plane(-10, { collisionOnly: true }), wall = plane(-60);
let group = new THREE.Group(); group.add(helper, wall); group.updateMatrixWorld(true);
let filter = createBulletFilter().add(group);
assert.equal(filter.stats.helpers, 1);
assert.equal(Math.round(filter.trace(world([helper, wall]), ray(), 1, 6000).distance), 60);

// Without the helper registered the same shot stops at it.
assert.equal(Math.round(world([helper, wall])(ray(), 1, 6000).distance), 10);

// A paper-thin slab (two parallel faces 1 unit apart) is shot through; a thick one is not.
let a = plane(-20), b = plane(-21), far = plane(-60);
filter = createBulletFilter();
assert.equal(Math.round(filter.trace(world([a, b, far]), ray(), 1, 6000).distance), 60);
let c = plane(-20), d = plane(-30);
assert.equal(Math.round(filter.trace(world([c, d]), ray(), 1, 6000).distance), 20);

// A lone solid wall still stops the shot, and a clear shot returns false.
assert.equal(Math.round(filter.trace(world([far]), ray(), 1, 6000).distance), 60);
assert.equal(filter.trace(world([]), ray(), 1, 6000), false);
console.log('bullet trace ok');
