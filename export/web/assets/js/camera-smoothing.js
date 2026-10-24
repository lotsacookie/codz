import { clamp, damp } from './math-utils.js';

export class CameraSmoother {
  constructor({ eyeRate = 18, stepRate = 12, stepSpeed = 450, maxStep = 26, landStiffness = 220, landDamping = 24, landScale = .2, landMaxImpulse = 110, maxDip = 3.5, minFallSpeed = 150 } = {}) {
    Object.assign(this, { eyeRate, stepRate, stepSpeed, maxStep, landStiffness, landDamping, landScale, landMaxImpulse, maxDip, minFallSpeed });
    this.reset();
  }
  reset() {
    this.ready = false; this.eye = 0; this.offset = 0; this.land = 0; this.landV = 0;
    this.prevFeet = 0; this.prevFloor = false; this.prevVy = 0;
  }
  update(dt, { feetY, eyeHeight, onFloor, velocityY = 0 }) {
    if (!this.ready) { this.reset(); this.ready = true; this.eye = eyeHeight; this.prevFeet = feetY; this.prevFloor = onFloor; }
    dt = clamp(dt, 0, .05);
    this.eye = damp(this.eye, eyeHeight, this.eyeRate, dt);

    const dy = feetY - this.prevFeet;
    if (Math.abs(dy) > this.maxStep * 2) this.offset = 0;                       // teleport or respawn
    else if (dt > 0 && onFloor && this.prevFloor && Math.abs(dy) / dt > this.stepSpeed && Math.abs(dy) <= this.maxStep) this.offset -= dy;
    this.offset = clamp(damp(this.offset, 0, this.stepRate, dt), -this.maxStep, this.maxStep);

    if (onFloor && !this.prevFloor && this.prevVy < -this.minFallSpeed) {
      this.landV = -Math.min(this.landMaxImpulse, -this.prevVy * this.landScale);
    }
    this.landV += (-this.landStiffness * this.land - this.landDamping * this.landV) * dt;
    this.land = clamp(this.land + this.landV * dt, -this.maxDip, .5);

    this.prevFeet = feetY; this.prevFloor = onFloor; this.prevVy = velocityY;
    return { eye: this.eye, offset: this.offset + this.land };
  }
}
