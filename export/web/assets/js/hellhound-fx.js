import * as THREE from 'three';
import { DOG_FX, emitDue, puffState } from './hellhound-fx-data.js';

let glowTexture = null, started = false;
function glow() {
  if (!started && typeof document !== 'undefined') {
    started = true;
    new THREE.TextureLoader().load(DOG_FX.glowUrl, texture => { texture.colorSpace = THREE.SRGBColorSpace; glowTexture = texture; });
  }
  return glowTexture;
}

const UP = new THREE.Vector3(0, 1, 0);

// Glowing eyes, fire and ash trails while a Hellhound runs, and a fire burst when it dies.
export class HellhoundFx {
  constructor(scene) {
    this.scene = scene;
    this.puffs = [];
    this.pool = { add: [], norm: [] };
    this.dogs = new Map();
  }
  puff(position, { life, size, color, rise, additive, velocity = null }) {
    const texture = glow();
    if (!texture) return;
    const key = additive ? 'add' : 'norm';
    const sprite = this.pool[key].pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, transparent: true, depthWrite: false, toneMapped: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    sprite.material.color.setHex(color);
    sprite.position.copy(position);
    sprite.scale.setScalar(size * 0.6);
    this.scene.add(sprite);
    this.puffs.push({ sprite, key, life, size, rise, additive, age: 0, velocity });
  }
  #eyes(state) {
    const texture = glow();
    if (!texture || state.eyes) return;
    state.eyes = [0, 1].map(() => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: DOG_FX.eye.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
      sprite.scale.setScalar(DOG_FX.eye.size);
      this.scene.add(sprite);
      return sprite;
    });
  }
  #dropEyes(state) {
    for (const eye of state.eyes ?? []) { this.scene.remove(eye); eye.material.dispose(); }
    state.eyes = null;
  }
  update(dt, enemies = []) {
    const seen = new Set();
    for (const z of enemies) {
      if (z.kind !== 'dog' || z.state === 'dead') continue;
      seen.add(z);
      let state = this.dogs.get(z);
      if (!state) { state = { last: z.root.position.clone(), forward: new THREE.Vector3(0, 0, 1), fire: 0, ash: 0, eyes: null }; this.dogs.set(z, state); }
      this.#eyes(state);
      const position = z.root.position, moved = position.clone().sub(state.last), speed = moved.length() / Math.max(dt, 1e-4);
      if (speed > DOG_FX.minSpeed) { moved.y = 0; if (moved.lengthSq() > 1e-6) state.forward.copy(moved.normalize()); }
      state.last.copy(position);
      if (state.eyes) {
        z.root.updateMatrixWorld(true);
        const bone = z.root.getObjectByName('j_head'), head = bone ? bone.getWorldPosition(new THREE.Vector3()) : position.clone().add(new THREE.Vector3(0, 28, 0));
        const side = new THREE.Vector3().crossVectors(UP, state.forward).normalize();
        state.eyes.forEach((eye, i) => eye.position.copy(head).addScaledVector(side, (i ? 1 : -1) * DOG_FX.eye.spacing).addScaledVector(state.forward, 4));
      }
      if (speed > DOG_FX.minSpeed) {
        for (const [name, additive] of [['fire', true], ['ash', false]]) {
          const cfg = DOG_FX[name], due = emitDue(state[name], dt, cfg.rate);
          state[name] = due.carry;
          for (let i = 0; i < due.count; i++) {
            const at = position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, 8 + Math.random() * 14, (Math.random() - 0.5) * 10)).addScaledVector(state.forward, -10);
            this.puff(at, { life: cfg.life, size: cfg.size, color: cfg.color, rise: cfg.rise, additive });
          }
        }
      }
    }
    for (const [z, state] of this.dogs) if (!seen.has(z)) { this.#dropEyes(state); this.dogs.delete(z); }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      const state = puffState(p.age, p.life, p.additive);
      if (state.done) { this.scene.remove(p.sprite); this.pool[p.key].push(p.sprite); this.puffs.splice(i, 1); continue; }
      p.sprite.position.y += p.rise * dt;
      if (p.velocity) p.sprite.position.addScaledVector(p.velocity, dt);
      p.sprite.scale.setScalar(p.size * state.scale);
      p.sprite.material.opacity = state.opacity;
    }
  }
  event(type, z) {
    if (z?.kind !== 'dog' || type !== 'death') return;
    const state = this.dogs.get(z);
    if (state) { this.#dropEyes(state); this.dogs.delete(z); }
    const cfg = DOG_FX.explosion, center = z.root.position.clone().add(new THREE.Vector3(0, 24, 0));
    for (let i = 0; i < cfg.puffs; i++) {
      const angle = Math.random() * Math.PI * 2, speed = cfg.spread * (0.3 + Math.random() * 0.7);
      this.puff(center, { life: cfg.life, size: cfg.size, color: cfg.color, rise: 30, additive: true, velocity: new THREE.Vector3(Math.cos(angle) * speed, Math.random() * 40, Math.sin(angle) * speed) });
    }
    this.puff(center, { life: cfg.life * 1.6, size: cfg.size * 1.4, color: DOG_FX.ash.color, rise: 18, additive: false });
  }
  clear() {
    for (const state of this.dogs.values()) this.#dropEyes(state);
    this.dogs.clear();
    for (const p of this.puffs) this.scene.remove(p.sprite);
    this.puffs.length = 0;
  }
}
