import * as THREE from 'three';

// NZ:P maps place `light` / `light_spot` entities (and props with a `_light` key). They emit light
// only (no visible dots, since many hang in mid air on purpose). Hundreds of dynamic lights would be far
// too expensive, so a fixed pool of real lights is handed to the lights the camera can actually see
// (their reach overlaps the view frustum), nearest first; any spare slots go to the nearest lights
// outside the view so the area around and behind the player stays lit. The pool size never changes, so
// no shader recompiles happen while playing.
export const POOL_DESKTOP = 16;
export const POOL_COARSE = 8;
const MOVE_SQ = 12 * 12;
const TURN_COS = Math.cos(3 * Math.PI / 180);
const MIN_INTERVAL_MS = 80;
const RE_ENV = /environment/;

export function lightsFromEntities(entities, parseVector, toThree) {
  const lights = [];
  for (const entity of entities) {
    if (!entity.origin || RE_ENV.test(entity.classname)) continue;
    if (!/^light/.test(entity.classname) && !entity._light) continue;
    if (/^[\s0.-]+$/.test(entity.origin)) continue;
    const [r, g, b, i] = (entity._light ? entity._light.trim().split(/\s+/).map(Number) : [255, 255, 255, 300]);
    const intensity = Number.isFinite(i) && i > 0 ? i : 300;
    const color = [r, g, b].map(v => Number.isFinite(v) ? Math.min(255, Math.max(0, v)) / 255 : 1);
    lights.push({ point: toThree(parseVector(entity.origin)), color, intensity });
  }
  return lights;
}

export const lightReach = intensity => Math.max(160, intensity * 2.2);

// Packs the light list into flat arrays: x, y, z, reach.
export function packLights(lights) {
  const data = new Float32Array(lights.length * 4);
  lights.forEach((light, k) => {
    data[k * 4] = light.point[0];
    data[k * 4 + 1] = light.point[1];
    data[k * 4 + 2] = light.point[2];
    data[k * 4 + 3] = lightReach(light.intensity);
  });
  return data;
}

// Pure selection: fills `out` (length >= pool) with the indexes of the lights to use and returns how many.
// `planes` is a Float32Array(24) of the six frustum planes (nx, ny, nz, constant), normals pointing in.
// Lights whose reach touches the frustum rank before the rest; ties by distance to `at`. Lights that held a
// slot last time (`previous`, optional Set-like with .has) get a small distance bonus so near-equal
// lights do not swap back and forth while turning.
export function selectViewLights(packed, planes, at, pool, out, previous = null, scratch = null) {
  const total = packed.length / 4;
  const limit = Math.min(pool, total);
  const bestScore = scratch?.score ?? new Float64Array(limit);
  let count = 0;
  for (let k = 0; k < total; k++) {
    const x = packed[k * 4], y = packed[k * 4 + 1], z = packed[k * 4 + 2], reach = packed[k * 4 + 3];
    let inView = true;
    for (let p = 0; p < 24; p += 4) {
      if (planes[p] * x + planes[p + 1] * y + planes[p + 2] * z + planes[p + 3] < -reach) { inView = false; break; }
    }
    const dx = x - at.x, dy = y - at.y, dz = z - at.z;
    let score = dx * dx + dy * dy + dz * dz;
    if (previous?.has(k)) score *= 0.8;
    if (!inView) score += 1e12;
    if (count === limit && score >= bestScore[count - 1]) continue;
    let i = count < limit ? count++ : count - 1;
    while (i > 0 && bestScore[i - 1] > score) {
      bestScore[i] = bestScore[i - 1];
      out[i] = out[i - 1];
      i--;
    }
    bestScore[i] = score;
    out[i] = k;
  }
  return count;
}

export function addMapLights(scene, lights, { pool: poolSize = POOL_DESKTOP } = {}) {
  if (!lights?.length) return null;
  const group = new THREE.Group();
  group.name = 'nzp_lights';

  // No visible glow sprites: lights only illuminate. This single invisible point is a fallback per-frame
  // callback for hosts that do not call group.userData.updateLights(camera) themselves.
  const hook = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
    new THREE.PointsMaterial({ size: 1, transparent: true, opacity: 0, depthWrite: false }),
  );
  hook.frustumCulled = false;
  group.add(hook);

  const pool = Array.from({ length: Math.min(poolSize, lights.length) }, () => {
    const light = new THREE.PointLight(0xffffff, 0, 1, 2);
    group.add(light);
    return light;
  });
  const packed = packLights(lights);
  const planes = new Float32Array(24);
  const frustum = new THREE.Frustum();
  const matrix = new THREE.Matrix4();
  const at = new THREE.Vector3(), forward = new THREE.Vector3();
  const lastAt = new THREE.Vector3(Infinity, Infinity, Infinity), lastForward = new THREE.Vector3(0, 0, -1);
  const chosen = new Int32Array(pool.length);
  const scratch = { score: new Float64Array(pool.length) };
  const held = new Set();
  let lastTime = -Infinity, driven = false;

  function updateLights(camera, now = performance.now()) {
    camera.getWorldPosition(at);
    camera.getWorldDirection(forward);
    const moved = at.distanceToSquared(lastAt) >= MOVE_SQ;
    const turned = forward.dot(lastForward) < TURN_COS;
    if (!moved && !turned) return;
    if (now - lastTime < MIN_INTERVAL_MS && Number.isFinite(lastAt.x)) return;
    lastTime = now;
    lastAt.copy(at);
    lastForward.copy(forward);
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    for (let i = 0; i < 6; i++) {
      const plane = frustum.planes[i];
      planes[i * 4] = plane.normal.x;
      planes[i * 4 + 1] = plane.normal.y;
      planes[i * 4 + 2] = plane.normal.z;
      planes[i * 4 + 3] = plane.constant;
    }
    const count = selectViewLights(packed, planes, at, pool.length, chosen, held, scratch);
    held.clear();
    pool.forEach((lamp, slot) => {
      if (slot >= count) { lamp.intensity = 0; return; }
      const index = chosen[slot], source = lights[index];
      held.add(index);
      lamp.color.setRGB(...source.color);
      lamp.position.set(packed[index * 4], packed[index * 4 + 1], packed[index * 4 + 2]);
      lamp.distance = packed[index * 4 + 3];
      lamp.intensity = source.intensity / 200 * 38000;
    });
  }

  group.userData.updateLights = (camera, now) => { driven = true; updateLights(camera, now); };
  hook.onBeforeRender = (renderer, _scene, camera) => { if (!driven) updateLights(camera); };
  scene.add(group);
  return group;
}
