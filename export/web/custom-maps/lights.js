import * as THREE from 'three';

// NZ:P maps place `light` / `light_spot` entities (and props with a `_light` key). They emit light
// only (no visible dots, since many hang in mid air on purpose); the nearest few to the camera cast
// real light, because hundreds of dynamic lights would be far too expensive.
const POOL = 8;
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

export function addMapLights(scene, lights) {
  if (!lights?.length) return null;
  const group = new THREE.Group();
  group.name = 'nzp_lights';

  // No visible glow sprites: lights only illuminate. This single invisible point just gives the scene a
  // per-frame callback so the real lights can follow the nearest light entities to the camera.
  const hook = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
    new THREE.PointsMaterial({ size: 1, transparent: true, opacity: 0, depthWrite: false }),
  );
  hook.frustumCulled = false;
  group.add(hook);

  const pool = Array.from({ length: Math.min(POOL, lights.length) }, () => {
    const light = new THREE.PointLight(0xffffff, 0, 1, 2);
    group.add(light);
    return light;
  });
  const last = new THREE.Vector3(Infinity, Infinity, Infinity), at = new THREE.Vector3();
  const order = lights.map((_, k) => k);
  hook.onBeforeRender = (renderer, _scene, camera) => {
    camera.getWorldPosition(at);
    if (at.distanceToSquared(last) < 400) return;
    last.copy(at);
    const distance = k => {
      const p = lights[k].point, dx = p[0] - at.x, dy = p[1] - at.y, dz = p[2] - at.z;
      return dx * dx + dy * dy + dz * dz;
    };
    order.sort((a, b) => distance(a) - distance(b));
    pool.forEach((lamp, slot) => {
      const source = lights[order[slot]];
      lamp.color.setRGB(...source.color);
      lamp.position.set(...source.point);
      lamp.distance = Math.max(160, source.intensity * 2.2);
      lamp.intensity = source.intensity / 200 * 38000;
    });
  };
  scene.add(group);
  return group;
}
