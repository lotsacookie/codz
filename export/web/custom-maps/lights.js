import * as THREE from 'three';

// NZ:P maps place `light` / `light_spot` entities (and props with a `_light` key). Every one is drawn
// as an additive glow, and the nearest few also cast real light, since hundreds of dynamic lights
// would be far too expensive.
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

function glowTexture() {
  const size = 64, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.25, 'rgba(255,255,255,.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function addMapLights(scene, lights) {
  if (!lights?.length) return null;
  const group = new THREE.Group();
  group.name = 'nzp_lights';

  const position = new Float32Array(lights.length * 3), color = new Float32Array(lights.length * 3);
  lights.forEach((light, k) => {
    position.set(light.point, k * 3);
    // Strong lights glow brighter; the colour is kept as-is so oranges and blues stay distinct.
    const boost = .55 + Math.min(1, light.intensity / 400) * .45;
    color.set(light.color.map(v => v * boost), k * 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  const glow = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 26, sizeAttenuation: true, map: glowTexture(), vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  glow.frustumCulled = false;
  group.add(glow);

  const pool = Array.from({ length: Math.min(POOL, lights.length) }, () => {
    const light = new THREE.PointLight(0xffffff, 0, 1, 2);
    group.add(light);
    return light;
  });
  const last = new THREE.Vector3(Infinity, Infinity, Infinity), at = new THREE.Vector3();
  const order = lights.map((_, k) => k);
  glow.onBeforeRender = (renderer, _scene, camera) => {
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
