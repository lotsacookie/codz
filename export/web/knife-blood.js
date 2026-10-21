
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
    for (let i = 0; i < count; i++) {
      const t = (i + this.random()) / count;
      const position = { x: prev.x + dx * t, y: prev.y + dy * t, z: prev.z + dz * t };
      const inv = distance > 1e-6 ? -1 / distance : 0;
      const fling = 10 + this.random() * 26;
      const velocity = {
        x: dx * inv * fling + (this.random() - 0.5) * 14,
        y: dy * inv * fling + this.random() * 12 - 3,
        z: dz * inv * fling + (this.random() - 0.5) * 14
      };
      emit(position, velocity, this.level);
    }
    return count;
  }
}
