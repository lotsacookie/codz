import * as THREE from 'three';
import { boneOf } from './gore.js';

const LIMBS = ['J_Elbow_LE', 'J_Wrist_LE', 'J_Elbow_RI', 'J_Wrist_RI', 'J_Knee_LE', 'J_Ankle_LE', 'J_Knee_RI', 'J_Ankle_RI'];
const TORSO = 'J_SpineLower';
const FLAMES_PER_TAG = 5;
const DEATH_TIME = 4.2;
const PAIN_TIME = 1;

let flameTexture = null;

function flame() {
  if (flameTexture) return flameTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(16, 40, 2, 16, 36, 28);
  grad.addColorStop(0, 'rgba(255,248,200,1)');
  grad.addColorStop(0.3, 'rgba(255,170,50,0.85)');
  grad.addColorStop(0.7, 'rgba(210,60,10,0.4)');
  grad.addColorStop(1, 'rgba(120,20,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 64);
  flameTexture = new THREE.CanvasTexture(canvas);
  return flameTexture;
}

const _p = new THREE.Vector3();

export class CharacterFire {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }

  ignite(z, { death = false } = {}) {
    if (!z?.root) return;
    const existing = this.list.find(f => f.z === z);
    const time = death ? DEATH_TIME : PAIN_TIME;
    if (existing) {
      existing.left = Math.max(existing.left, time);
      existing.total = Math.max(existing.total, existing.left);
      return;
    }
    const tags = [TORSO];
    if (death) tags.push(LIMBS[Math.floor(Math.random() * LIMBS.length)]);
    const group = new THREE.Group();
    const flames = [];
    for (const tag of tags) {
      for (let i = 0; i < FLAMES_PER_TAG; i++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flame(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        sprite.renderOrder = 20;
        group.add(sprite);
        flames.push({ sprite, tag, phase: Math.random(), speed: 1.3 + Math.random() * 0.9, ox: (Math.random() - 0.5) * 6, oz: (Math.random() - 0.5) * 6, size: tag === TORSO ? 15 : 9 });
      }
    }
    this.scene.add(group);
    this.list.push({ z, group, flames, left: time, total: time });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.left -= dt;
      const gone = f.left <= 0 || !f.z.root.parent;
      if (gone) {
        this.scene.remove(f.group);
        for (const fl of f.flames) fl.sprite.material.dispose();
        this.list.splice(i, 1);
        continue;
      }
      const fade = Math.min(1, f.left / 0.6);
      for (const fl of f.flames) {
        fl.phase = (fl.phase + dt * fl.speed) % 1;
        const bone = boneOf(f.z, fl.tag);
        if (bone) bone.getWorldPosition(_p);
        else _p.copy(f.z.root.position).y += 30;
        const t = fl.phase;
        fl.sprite.position.set(_p.x + fl.ox * (1 - t), _p.y + t * 16, _p.z + fl.oz * (1 - t));
        const s = fl.size * (0.5 + Math.sin(t * Math.PI) * 0.7);
        fl.sprite.scale.set(s * 0.7, s, 1);
        fl.sprite.material.opacity = Math.sin(t * Math.PI) * 0.9 * fade;
      }
    }
  }

  clear() {
    for (const f of this.list) {
      this.scene.remove(f.group);
      for (const fl of f.flames) fl.sprite.material.dispose();
    }
    this.list.length = 0;
  }
}
