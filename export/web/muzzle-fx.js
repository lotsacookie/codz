import * as THREE from 'three';
import { loadAtlas, randomFrame } from './fx-atlas.js';

let starMap = null;
let glowMap = null;
let smokeMap = null;

// Real T5 sheets (2 frames each); the procedural star/glow/smoke below stay as the fallback and as layers on top.
const FLASH_ATLAS = 'textures/fxt_fire_gas_flash.png';
const SMOKE_ATLAS = 'textures/fxt_smk_puff.png';

// Slightly larger flash; depth-tested so the gun model occludes it instead of it showing through.
const FLASH_SCALE = 1.25;

function paint(size, draw) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function flashStar() {
  return starMap ??= paint(128, (ctx, size) => {
    const c = size / 2;
    ctx.translate(c, c);
    const spikes = 7;
    for (let i = 0; i < spikes; i++) {
      const long = i % 2 === 0;
      const angle = (i / spikes) * Math.PI * 2 + (long ? -0.1 : 0.15);
      const length = c * (long ? 0.95 : 0.62);
      const width = c * (long ? 0.1 : 0.07);
      ctx.save();
      ctx.rotate(angle);
      const gradient = ctx.createLinearGradient(0, 0, length, 0);
      gradient.addColorStop(0, 'rgba(255,244,214,0.95)');
      gradient.addColorStop(0.45, 'rgba(255,170,70,0.65)');
      gradient.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(0, -width);
      ctx.lineTo(length, 0);
      ctx.lineTo(0, width);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.42);
    core.addColorStop(0, 'rgba(255,255,245,1)');
    core.addColorStop(0.35, 'rgba(255,232,170,0.95)');
    core.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, c * 0.42, 0, Math.PI * 2);
    ctx.fill();
  });
}

function flashGlow() {
  return glowMap ??= paint(128, (ctx, size) => {
    const c = size / 2;
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    gradient.addColorStop(0, 'rgba(255,225,160,0.9)');
    gradient.addColorStop(0.3, 'rgba(255,150,60,0.45)');
    gradient.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
}

function smokeTexture() {
  return smokeMap ??= paint(128, (ctx, size) => {
    for (let i = 0; i < 9; i++) {
      const x = size * (0.3 + Math.random() * 0.4);
      const y = size * (0.3 + Math.random() * 0.4);
      const r = size * (0.18 + Math.random() * 0.16);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, 'rgba(255,255,255,0.42)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }
    ctx.globalCompositeOperation = 'destination-in';
    const edge = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
    edge.addColorStop(0, 'rgba(0,0,0,1)');
    edge.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, size, size);
  });
}

export function createMuzzleFlash(tag) {
  const group = new THREE.Group();
  group.visible = false;
  const sprite = map => new THREE.Sprite(new THREE.SpriteMaterial({
    map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false, fog: false
  }));
  const star = sprite(flashStar());
  const glow = sprite(flashGlow());
  glow.material.color.setHex(0xff9a3c);
  star.renderOrder = glow.renderOrder = 10;
  group.add(glow, star);
  tag.add(group);
  const atlas = loadAtlas(FLASH_ATLAS, 2);
  let burst = null;
  const state = { life: 0, total: 0.06 };
  return {
    group,
    fire(profile, ads = false) {
      const size = profile.size * FLASH_SCALE * (ads ? 0.72 : 1) * (0.85 + Math.random() * 0.35);
      state.life = state.total = 0.045 + Math.random() * 0.03;
      star.scale.setScalar(size);
      star.material.rotation = Math.random() * Math.PI * 2;
      star.material.opacity = 1;
      glow.scale.setScalar(size * 2.3);
      glow.material.rotation = Math.random() * Math.PI * 2;
      glow.material.opacity = 0.55;
      const frame = randomFrame(atlas);
      if (frame) {
        if (!burst) {
          burst = sprite(frame);
          burst.renderOrder = 9;
          group.add(burst);
        }
        burst.material.map = frame;
        burst.scale.setScalar(size * 1.6);
        burst.material.rotation = (Math.random() - 0.5) * 0.9;
        burst.material.opacity = 0.9;
        burst.visible = true;
      }
      group.visible = true;
    },
    update(dt) {
      if (state.life <= 0) return;
      state.life -= dt;
      if (state.life <= 0) { group.visible = false; return; }
      const k = state.life / state.total;
      star.material.opacity = Math.min(1, k * 1.6);
      glow.material.opacity = k * 0.55;
      if (burst) burst.material.opacity = Math.min(1, k * 1.4) * 0.9;
    },
    ndc(viewCamera) {
      viewCamera.updateMatrixWorld();
      return tag.getWorldPosition(new THREE.Vector3()).project(viewCamera);
    },
    dispose() {
      group.removeFromParent();
      star.material.dispose();
      glow.material.dispose();
      burst?.material.dispose();
    }
  };
}

export class MuzzleSmoke {
  constructor(scene, limit = 56) {
    this.scene = scene;
    this.limit = limit;
    this.puffs = [];
    this.atlas = loadAtlas(SMOKE_ATLAS, 2);
  }

  emit(ndc, camera, profile, ads = false) {
    camera.updateMatrixWorld();
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const ray = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const origin = camera.position.clone().addScaledVector(ray, 22 + profile.size * 0.8);
    const count = Math.max(1, Math.round(profile.puffs * (ads ? 0.7 : 1)));
    for (let i = 0; i < count; i++) this.spawn(origin, forward, right, up, profile);
  }

  spawn(origin, forward, right, up, profile) {
    if (this.puffs.length >= this.limit) this.remove(this.puffs[0]);
    const material = new THREE.SpriteMaterial({ map: randomFrame(this.atlas) ?? smokeTexture(), color: 0xb9b9b9, transparent: true, depthWrite: false, opacity: 0 });
    const sprite = new THREE.Sprite(material);
    const size = profile.size * (0.5 + Math.random() * 0.35);
    sprite.position.copy(origin)
      .addScaledVector(forward, Math.random() * 5)
      .addScaledVector(right, (Math.random() - 0.5) * profile.size * 0.5)
      .addScaledVector(up, (Math.random() - 0.5) * profile.size * 0.4);
    sprite.scale.setScalar(size);
    material.rotation = Math.random() * Math.PI * 2;
    sprite.renderOrder = 5;
    const velocity = forward.clone().multiplyScalar(45 + Math.random() * profile.smokeSpeed)
      .addScaledVector(right, (Math.random() - 0.5) * 26)
      .addScaledVector(up, 8 + Math.random() * 20);
    this.scene.add(sprite);
    this.puffs.push({
      sprite, velocity, age: 0,
      life: profile.smokeLife * (0.75 + Math.random() * 0.6),
      size0: size, size1: size * (3 + Math.random() * 2),
      alpha: profile.smokeAlpha * (0.7 + Math.random() * 0.5),
      spin: (Math.random() - 0.5) * 0.8
    });
  }

  update(dt) {
    for (const puff of [...this.puffs]) {
      puff.age += dt;
      const t = puff.age / puff.life;
      if (t >= 1) { this.remove(puff); continue; }
      puff.velocity.multiplyScalar(Math.exp(-dt * 2.2));
      puff.velocity.y += 12 * dt;
      puff.sprite.position.addScaledVector(puff.velocity, dt);
      const grow = 1 - (1 - t) * (1 - t);
      puff.sprite.scale.setScalar(puff.size0 + (puff.size1 - puff.size0) * grow);
      puff.sprite.material.opacity = puff.alpha * Math.min(1, t / 0.1) * Math.pow(1 - t, 1.5);
      puff.sprite.material.rotation += puff.spin * dt;
    }
  }

  remove(puff) {
    puff.sprite.removeFromParent();
    puff.sprite.material.dispose();
    const index = this.puffs.indexOf(puff);
    if (index >= 0) this.puffs.splice(index, 1);
  }

  dispose() {
    for (const puff of [...this.puffs]) this.remove(puff);
  }
}
