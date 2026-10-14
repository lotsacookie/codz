import * as THREE from 'three';

export const SHADOW_BACKOFF = 900;

const LEVELS = {
  dump: { sun: 3.2, ambient: 0.55, hemi: 0.6, fill: 0.2 },
  classic: { sun: 1.2, ambient: 0.9, hemi: 1.25, fill: 0.5 }
};

export function pickLightLevels(search = '') {
  return /[?&]lighting=classic\b/.test(search) ? LEVELS.classic : LEVELS.dump;
}

const SHAFTS = {
  lg: { width: 96, reach: 430, opacity: 0.2 },
  sm: { width: 50, reach: 270, opacity: 0.15 }
};

const MOTES = {
  md: { count: 44, radius: 150, size: 5.5 },
  sm: { count: 26, radius: 95, size: 4.5 }
};

function shaftTexture() {
  const w = 64, h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    const along = Math.pow(Math.sin(Math.PI * v), 0.85);
    for (let x = 0; x < w; x++) {
      const u = ((x + 0.5) / w) * 2 - 1;
      const across = Math.pow(Math.max(0, 1 - u * u), 1.7);
      const i = (y * w + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(255 * across * along);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function moteFallback() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

function distanceToSegment(point, a, b, scratch) {
  scratch.copy(b).sub(a);
  const lengthSq = scratch.lengthSq();
  const t = lengthSq > 0 ? THREE.MathUtils.clamp(point.clone().sub(a).dot(scratch) / lengthSq, 0, 1) : 0;
  return point.distanceTo(scratch.multiplyScalar(t).add(a));
}

export class TheaterLighting {
  constructor({ scene, world, sunColor, fxData }) {
    this.scene = scene;
    this.time = 0;
    this.shafts = [];
    this.motes = null;
    this.scratch = new THREE.Vector3();
    this.group = new THREE.Group();
    this.group.name = 'theater-light-fx';
    scene.add(this.group);
    if (fxData?.ray?.length) this.buildShafts(world, fxData.ray, sunColor);
    if (fxData?.mote?.length) this.buildMotes(fxData.mote);
  }

  buildShafts(world, entries, sunColor) {
    const texture = shaftTexture();
    const color = new THREE.Color(...sunColor).lerp(new THREE.Color(1, 1, 1), 0.35);
    const up = new THREE.Vector3(0, 1, 0);
    entries.forEach((entry, index) => {
      const spec = SHAFTS[entry.s] ?? SHAFTS.sm;
      const origin = new THREE.Vector3(...entry.p);
      const forward = new THREE.Vector3(...entry.d).normalize();
      const reachUp = this.reach(world, origin, forward, spec.reach);
      const reachDown = this.reach(world, origin, forward.clone().negate(), spec.reach);
      const length = reachUp + reachDown;
      if (length < 70) return;
      const start = origin.clone().addScaledVector(forward, -reachDown);
      const end = origin.clone().addScaledVector(forward, reachUp);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color,
        transparent: true,
        opacity: spec.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true
      });
      const beam = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, length), material);
        plane.rotation.y = (i * Math.PI) / 3;
        beam.add(plane);
      }
      beam.position.copy(start).add(end).multiplyScalar(0.5);
      beam.quaternion.setFromUnitVectors(up, forward);
      beam.renderOrder = 4;
      this.group.add(beam);
      this.shafts.push({ material, base: spec.opacity, phase: index * 1.7, start, end });
    });
  }

  reach(world, origin, direction, max) {
    const hit = world.raycast(new THREE.Ray(origin.clone(), direction), 0, max);
    return hit ? Math.max(0, hit.distance - 2) : max;
  }

  buildMotes(entries) {
    const clouds = [];
    let total = 0;
    for (const entry of entries) {
      const spec = MOTES[entry.s] ?? MOTES.sm;
      clouds.push({ center: new THREE.Vector3(...entry.p), spec, offset: total });
      total += spec.count;
    }
    const positions = new Float32Array(total * 3);
    const seeds = new Float32Array(total * 4);
    for (const cloud of clouds) {
      for (let i = 0; i < cloud.spec.count; i++) {
        const n = (cloud.offset + i) * 4;
        seeds[n] = (Math.random() * 2 - 1) * cloud.spec.radius;
        seeds[n + 1] = (Math.random() * 2 - 1) * cloud.spec.radius * 0.7;
        seeds[n + 2] = (Math.random() * 2 - 1) * cloud.spec.radius;
        seeds[n + 3] = Math.random() * Math.PI * 2;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      map: moteFallback(),
      size: 5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      color: 0xf2e8d0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true
    });
    new THREE.TextureLoader().load('textures/fxt_env_dust_mote.png', texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture;
      material.needsUpdate = true;
    }, undefined, () => {});
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 5;
    this.group.add(points);
    this.motes = { clouds, seeds, positions, geometry, material };
    this.updateMotes();
  }

  updateMotes() {
    const { clouds, seeds, positions, geometry } = this.motes;
    const t = this.time;
    for (const cloud of clouds) {
      for (let i = 0; i < cloud.spec.count; i++) {
        const n = (cloud.offset + i) * 4, p = (cloud.offset + i) * 3, phase = seeds[n + 3];
        positions[p] = cloud.center.x + seeds[n] + Math.sin(t * 0.21 + phase) * 14;
        positions[p + 1] = cloud.center.y + seeds[n + 1] + Math.sin(t * 0.33 + phase * 1.7) * 12;
        positions[p + 2] = cloud.center.z + seeds[n + 2] + Math.cos(t * 0.17 + phase) * 14;
      }
    }
    geometry.attributes.position.needsUpdate = true;
  }

  update(dt, camera) {
    this.time += dt;
    for (const shaft of this.shafts) {
      const near = distanceToSegment(camera.position, shaft.start, shaft.end, this.scratch);
      const fade = THREE.MathUtils.smoothstep(near, 40, 170);
      const flicker = 0.88 + 0.12 * Math.sin(this.time * 0.55 + shaft.phase);
      shaft.material.opacity = shaft.base * fade * flicker;
    }
    if (this.motes) this.updateMotes();
  }
}
