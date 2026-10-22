import * as THREE from 'three';

export const DOG_SPAWN_DELAY = 1.5;
const STRIKE_TIME = 0.4;
const SEGMENTS = 16;
const ARCS = 7;
const BRANCHES = 3;
const SKY = 760;

let glowTexture = null;

function glow() {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(170,215,255,0.75)');
  grad.addColorStop(1, 'rgba(90,150,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

function line(color, width = 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEGMENTS * 3), 3));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, linewidth: width });
  const mesh = new THREE.Line(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 999;
  return mesh;
}

function trace(mesh, ax, ay, az, bx, by, bz, spread) {
  const p = mesh.geometry.attributes.position.array;
  for (let i = 0; i < SEGMENTS; i++) {
    const t = i / (SEGMENTS - 1);
    const edge = i === 0 || i === SEGMENTS - 1 ? 0 : Math.sin(t * Math.PI) * 0.5 + 0.5;
    p[i * 3] = ax + (bx - ax) * t + (Math.random() - 0.5) * spread * edge;
    p[i * 3 + 1] = ay + (by - ay) * t + (Math.random() - 0.5) * spread * 0.25 * edge;
    p[i * 3 + 2] = az + (bz - az) * t + (Math.random() - 0.5) * spread * edge;
  }
  mesh.geometry.attributes.position.needsUpdate = true;
}

export class DogSpawnFx {
  constructor(scene, { shake = null, camera = null } = {}) {
    this.scene = scene;
    this.shake = shake;
    this.camera = camera;
    this.list = [];
  }

  begin(position) {
    const group = new THREE.Group();
    group.position.copy(position);
    const arcs = [];
    for (let i = 0; i < ARCS; i++) { const m = line(0x9fd2ff); group.add(m); arcs.push(m); }
    const bolt = line(0xffffff);
    const branches = [];
    for (let i = 0; i < BRANCHES; i++) { const m = line(0xbfe0ff); group.add(m); branches.push(m); }
    group.add(bolt);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0xaed8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    sprite.position.y = 28;
    sprite.renderOrder = 998;
    group.add(sprite);
    const light = new THREE.PointLight(0x8ec8ff, 0, 460, 2);
    light.position.y = 50;
    group.add(light);
    this.scene.add(group);
    this.list.push({ group, arcs, bolt, branches, sprite, light, age: 0, tick: 0, struck: false });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.age += dt;
      f.tick -= dt;
      const flicker = f.tick <= 0;
      if (flicker) f.tick = 0.045;
      if (f.age < DOG_SPAWN_DELAY) {
        const t = f.age / DOG_SPAWN_DELAY;
        const strength = 0.25 + t * 0.75;
        if (flicker) {
          for (const arc of f.arcs) {
            const reach = 18 + t * 46;
            const a = Math.random() * Math.PI * 2;
            const h = Math.random() * (30 + t * 70);
            trace(arc, 0, 0, 0, Math.cos(a) * reach, h, Math.sin(a) * reach, 14 + t * 16);
            arc.material.opacity = Math.random() < 0.35 + t * 0.4 ? strength * (0.5 + Math.random() * 0.5) : 0;
          }
        }
        f.sprite.scale.setScalar(36 + t * 120 + Math.random() * 14);
        f.sprite.material.opacity = (0.12 + t * 0.5) * (0.7 + Math.random() * 0.3);
        f.light.intensity = (0.4 + t * 2.4) * (0.6 + Math.random() * 0.4);
      } else {
        const s = f.age - DOG_SPAWN_DELAY;
        if (!f.struck) {
          f.struck = true;
          for (const arc of f.arcs) arc.material.opacity = 0;
          this.shake?.();
        }
        if (s >= STRIKE_TIME) {
          this.scene.remove(f.group);
          f.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
          f.light.dispose?.();
          this.list.splice(i, 1);
          continue;
        }
        const fade = 1 - s / STRIKE_TIME;
        if (flicker || s < 0.02) {
          trace(f.bolt, (Math.random() - 0.5) * 20, SKY, (Math.random() - 0.5) * 20, 0, 0, 0, 60);
          f.bolt.material.opacity = fade > 0.3 || Math.random() < 0.6 ? 1 : 0.35;
          for (const b of f.branches) {
            const y = 120 + Math.random() * (SKY - 220);
            const a = Math.random() * Math.PI * 2;
            const r = 40 + Math.random() * 90;
            const x0 = (Math.random() - 0.5) * 20;
            trace(b, x0, y, x0, Math.cos(a) * r, y - 90 - Math.random() * 120, Math.sin(a) * r, 26);
            b.material.opacity = Math.random() < 0.7 ? fade : 0;
          }
        }
        f.sprite.scale.setScalar(150 + fade * 260);
        f.sprite.material.opacity = Math.min(1, fade * 1.2);
        f.light.intensity = 14 * fade * fade + Math.random() * 2;
      }
    }
  }

  clear() {
    for (const f of this.list) {
      this.scene.remove(f.group);
      f.group.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    }
    this.list.length = 0;
  }
}
