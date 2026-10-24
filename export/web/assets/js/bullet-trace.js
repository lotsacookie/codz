import * as THREE from 'three';

// Bullets use the same collision mesh as the player, and that mesh is baked from every render triangle. So bullets stop
// on things you cannot see: the invisible collision helpers that keep the player out of windows and corners, and the
// fully transparent pixels of alpha-cut materials (fences, grates, signs, decals). They also stop on paper-thin slabs.
// This filter lets a shot continue through all three, and leaves the player's own movement collision untouched.

const _raycaster = new THREE.Raycaster();
const _entry = new THREE.Vector3();
const _normalA = new THREE.Vector3();
const _normalB = new THREE.Vector3();
const _uv = new THREE.Vector2();
const alphaTables = new Map();

// Alpha channel of a texture, downscaled and cached. Null when the pixels cannot be read, which counts as solid.
function alphaTable(texture) {
  if (alphaTables.has(texture)) return alphaTables.get(texture);
  let table = null;
  try {
    const image = texture.image;
    if (image && image.width && image.height && typeof document !== 'undefined') {
      const scale = Math.min(1, 512 / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      g.drawImage(image, 0, 0, width, height);
      const data = g.getImageData(0, 0, width, height).data;
      const alpha = new Uint8Array(width * height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
      table = { width, height, alpha };
    }
  } catch { table = null; }
  alphaTables.set(texture, table);
  return table;
}

export function alphaAt(texture, uv) {
  const table = alphaTable(texture);
  if (!table) return 1;
  _uv.copy(uv);
  texture.updateMatrix?.();
  if (texture.matrix) _uv.applyMatrix3(texture.matrix);
  const u = _uv.x - Math.floor(_uv.x), v = _uv.y - Math.floor(_uv.y);
  const x = Math.min(table.width - 1, Math.floor(u * table.width));
  const y = Math.min(table.height - 1, Math.floor((texture.flipY ? 1 - v : v) * table.height));
  return table.alpha[y * table.width + x] / 255;
}

const materialsOf = mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material];

export function createBulletFilter({ tolerance = .75, thin = 3, maxSkips = 8 } = {}) {
  const items = [];
  const stats = { helpers: 0, cutouts: 0 };

  // Call before the scene is optimised or chunked, while the original meshes still exist.
  function add(root) {
    if (!root) return api;
    root.updateMatrixWorld(true);
    root.traverse(object => {
      if (!object.isMesh || !object.geometry) return;
      const always = !!object.userData?.collisionOnly;
      const cutout = !always && materialsOf(object).some(m => m?.alphaTest > 0 && m.map);
      if (!always && !cutout) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      items.push({ mesh: object, always, box: object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld).expandByScalar(tolerance) });
      stats[always ? 'helpers' : 'cutouts']++;
    });
    return api;
  }

  // True when the surface at hit.distance is invisible: a collision helper, or an alpha-cut pixel that is cut away.
  function seeThrough(hit, ray) {
    const d = hit.distance;
    for (const item of items) {
      if (!ray.intersectsBox(item.box, _entry) || _entry.distanceTo(ray.origin) > d + tolerance) continue;
      _raycaster.ray.copy(ray);
      _raycaster.near = Math.max(0, d - tolerance);
      _raycaster.far = d + tolerance;
      const found = [], materials = materialsOf(item.mesh), sides = materials.map(m => m.side);
      materials.forEach(m => { m.side = THREE.DoubleSide; });
      try { item.mesh.raycast(_raycaster, found); } finally { materials.forEach((m, i) => { m.side = sides[i]; }); }
      for (const f of found) {
        if (item.always) return true;
        const material = materials[f.face?.materialIndex ?? 0] ?? materials[0];
        if (!(material?.alphaTest > 0) || !material.map || !f.uv) continue;
        if (alphaAt(material.map, f.uv) * (material.opacity ?? 1) < material.alphaTest) return true;
      }
    }
    return false;
  }

  // A surface with a parallel surface right behind it is a thin slab; returns the distance to the far side, or 0.
  function thickness(cast, hit, ray) {
    if (!hit.triangle || hit.dynamic) return 0;
    const probe = cast(new THREE.Ray(ray.origin.clone().addScaledVector(ray.direction, hit.distance + .05), ray.direction), 0, thin);
    if (!probe || !probe.triangle || probe.dynamic) return 0;
    hit.triangle.getNormal(_normalA);
    probe.triangle.getNormal(_normalB);
    return Math.abs(_normalA.dot(_normalB)) > .85 ? .05 + probe.distance : 0;
  }

  // `cast(ray, near, far)` is the map's normal raycast. Returns the first hit that actually stops a bullet.
  function trace(cast, ray, near = 0, far = Infinity) {
    let from = near, last = null;
    for (let skips = 0; skips <= maxSkips; skips++) {
      const hit = cast(ray, from, far);
      if (!hit) return skips ? null : hit;
      last = hit;
      if (seeThrough(hit, ray)) { from = hit.distance + .5; continue; }
      const slab = thickness(cast, hit, ray);
      if (slab) { from = hit.distance + slab + .1; continue; }
      return hit;
    }
    return last;
  }

  const api = { add, trace, stats, items };
  return api;
}
