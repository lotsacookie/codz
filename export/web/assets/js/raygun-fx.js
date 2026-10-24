import * as THREE from 'three';
import { RAYGUN_FX, ringsDue, ringState } from './raygun-fx-data.js';

const textures = { ring: null, glow: null, started: false };
function loadTextures() {
  if (textures.started || typeof document === 'undefined') return textures;
  textures.started = true;
  const loader = new THREE.TextureLoader();
  for (const [key, url] of [['ring', RAYGUN_FX.ringUrl], ['glow', RAYGUN_FX.glowUrl]]) {
    loader.load(url, texture => { texture.colorSpace = THREE.SRGBColorSpace; textures[key] = texture; });
  }
  return textures;
}

// Muzzle flash, projectile ring trail and impact burst for the Ray Gun, drawn with the
// reference ring and glow textures. Sprites are pooled per texture.
export class RaygunFx {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
    this.pool = { ring: [], glow: [] };
    this.carry = 0;
  }
  spawn(kind, position, { size, life, grow, upgraded }) {
    const texture = loadTextures()[kind];
    if (!texture) return;
    const sprite = this.pool[kind].pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
    }));
    sprite.material.color.setHex(upgraded ? RAYGUN_FX.upgradedTint : 0xffffff);
    sprite.position.copy(position);
    sprite.scale.setScalar(size);
    sprite.material.opacity = 1;
    this.scene.add(sprite);
    this.live.push({ sprite, kind, size, life, grow, age: 0 });
  }
  muzzle(position, upgraded = false) {
    const { size, life, grow } = RAYGUN_FX.muzzle;
    this.spawn('glow', position, { size, life, grow, upgraded });
    this.spawn('ring', position, { size: size * 0.8, life: life * 2, grow: grow * 2, upgraded });
  }
  trail(position, dt, upgraded = false) {
    const { rate, life, size, grow } = RAYGUN_FX.trail;
    const due = ringsDue(this.carry, dt, rate);
    this.carry = due.carry;
    for (let i = 0; i < due.count; i++) this.spawn('ring', position, { size, life, grow, upgraded });
  }
  impact(position, upgraded = false) {
    const { rings, ringLife, ringSize, ringGrow, glowLife, glowSize } = RAYGUN_FX.impact;
    this.spawn('glow', position, { size: glowSize, life: glowLife, grow: 0.8, upgraded });
    for (let i = 0; i < rings; i++) this.spawn('ring', position, { size: ringSize * (1 + i * 0.5), life: ringLife, grow: ringGrow, upgraded });
  }
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const fx = this.live[i];
      fx.age += dt;
      const state = ringState(fx.age, fx.life, fx.grow);
      if (state.done) {
        this.scene.remove(fx.sprite);
        this.pool[fx.kind].push(fx.sprite);
        this.live.splice(i, 1);
        continue;
      }
      fx.sprite.scale.setScalar(fx.size * state.scale);
      fx.sprite.material.opacity = state.opacity;
    }
  }
  dispose() {
    for (const fx of this.live) this.scene.remove(fx.sprite);
    this.live.length = 0;
  }
}
