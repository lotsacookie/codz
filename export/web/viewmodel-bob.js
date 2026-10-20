const TAU = Math.PI * 2;
const damp = (from, to, rate, dt) => to + (from - to) * Math.exp(-rate * dt);

export const BOB = {
  walk: { rate: 1.05, x: 0.07, y: 0.05, z: 0.014, roll: 0.032, pitch: 0.018, yaw: 0.016 },
  sprint: { rate: 1.6, x: 0.11, y: 0.075, z: 0.03, roll: 0.055, pitch: 0.03, yaw: 0.026 }
};

export class ViewmodelBob {
  constructor() {
    this.phase = 0;
    this.amount = 0;
    this.sprint = 0;
    this.out = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  }

  reset() {
    this.phase = 0;
    this.amount = 0;
    this.sprint = 0;
    this.out = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  }

  update(dt, { moving = false, sprint = false, aim = 0, scale = 1 } = {}) {
    const target = moving ? 1 - aim * 0.9 : 0;
    this.amount = damp(this.amount, target, moving ? 9 : 7, dt);
    this.sprint = damp(this.sprint, sprint ? 1 : 0, 6, dt);
    if (this.amount < 0.002) {
      this.amount = 0;
      this.out = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
      return this.out;
    }
    const rate = BOB.walk.rate + (BOB.sprint.rate - BOB.walk.rate) * this.sprint;
    this.phase = (this.phase + dt * rate * TAU * (0.35 + 0.65 * this.amount)) % TAU;
    const mix = key => BOB.walk[key] + (BOB.sprint[key] - BOB.walk[key]) * this.sprint;
    const a = this.amount * scale;
    const side = Math.sin(this.phase);
    const step = Math.sin(this.phase * 2);
    const drop = -Math.abs(Math.sin(this.phase)) * 2 + 1;
    this.out = {
      x: side * mix('x') * a,
      y: (drop * 0.5 + step * 0.15) * mix('y') * a,
      z: Math.cos(this.phase * 2) * mix('z') * a,
      rx: -drop * mix('pitch') * a * 0.6 + step * mix('pitch') * a * 0.3,
      ry: -side * mix('yaw') * a,
      rz: -side * mix('roll') * a
    };
    return this.out;
  }
}
