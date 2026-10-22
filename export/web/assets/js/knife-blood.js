import * as THREE from 'three';

const scratch = new THREE.Vector3();
const scratchVelocity = new THREE.Vector3();
const scratchHeading = new THREE.Vector3();
const inverse = new THREE.Matrix4();
const rotation = new THREE.Matrix4();

export function tipToView(camera, tip) {
  if (!tip || !camera) return tip ?? null;
  camera.updateMatrixWorld();
  inverse.copy(camera.matrixWorld).invert();
  scratch.set(tip.x, tip.y, tip.z).applyMatrix4(inverse);
  return { x: scratch.x, y: scratch.y, z: scratch.z };
}

export function viewEmitter(camera, emit) {
  return (position, velocity, level, speed, heading) => {
    camera.updateMatrixWorld();
    rotation.extractRotation(camera.matrixWorld);
    const p = scratch.set(position.x, position.y, position.z).applyMatrix4(camera.matrixWorld);
    const v = scratchVelocity.set(velocity.x, velocity.y, velocity.z).applyMatrix4(rotation);
    const h = heading ? scratchHeading.set(heading.x, heading.y, heading.z).applyMatrix4(rotation) : null;
    emit({ x: p.x, y: p.y, z: p.z }, { x: v.x, y: v.y, z: v.z }, level, speed, h ? { x: h.x, y: h.y, z: h.z } : null);
  };
}

export class KnifeBlood {
  constructor({ duration = 1.4, baseRate = 70, flingRate = 0.9, maxPerFrame = 10, random = Math.random } = {}) {
    this.duration = duration;
    this.baseRate = baseRate;
    this.flingRate = flingRate;
    this.maxPerFrame = maxPerFrame;
    this.random = random;
    this.level = 0;
    this.last = null;
    this.carry = 0;
  }

  get active() {
    return this.level > 0.001;
  }

  soak(amount = 1) {
    this.level = Math.min(1, Math.max(this.level, 0.65) + amount * 0.35);
    this.last = null;
  }

  reset() {
    this.level = 0;
    this.last = null;
    this.carry = 0;
  }

  update(dt, tip, emit) {
    if (!this.active) return 0;
    if (!tip) {
      this.reset();
      return 0;
    }
    const prev = this.last;
    this.last = { x: tip.x, y: tip.y, z: tip.z };
    this.level = Math.max(0, this.level - dt / this.duration);
    if (!prev || dt <= 0) return 0;
    const dx = tip.x - prev.x, dy = tip.y - prev.y, dz = tip.z - prev.z;
    const distance = Math.hypot(dx, dy, dz);
    const speed = distance / dt;
    this.carry += (this.baseRate + speed * this.flingRate) * this.level * dt;
    const count = Math.min(this.maxPerFrame, Math.floor(this.carry));
    this.carry -= Math.floor(this.carry);
    const inv = distance > 1e-6 ? -1 / distance : 0;
    const heading = distance > 1e-6 ? { x: dx * inv, y: dy * inv, z: dz * inv } : null;
    for (let i = 0; i < count; i++) {
      const t = (i + this.random()) / count;
      const position = { x: prev.x + dx * t, y: prev.y + dy * t, z: prev.z + dz * t };
      const fling = 10 + this.random() * 26;
      const velocity = {
        x: dx * inv * fling + (this.random() - 0.5) * 14,
        y: dy * inv * fling + this.random() * 12 - 3,
        z: dz * inv * fling + (this.random() - 0.5) * 14
      };
      emit(position, velocity, this.level, speed, heading);
    }
    return count;
  }
}
