// Walking bob for the first-person weapon. Each footstep drops the gun and rolls it a little,
// the sway side to side happens once per two steps, so the path is a figure of eight.
// Amplitude eases in and out so stopping settles the gun instead of freezing it mid-step.

const TAU = Math.PI * 2;
const damp = (from, to, rate, dt) => to + (from - to) * Math.exp(-rate * dt);

export const BOB = {
  walk: { rate: 1.9, x: 0.028, y: 0.022, z: 0.01, roll: 0.018, pitch: 0.012, yaw: 0.008 },
  sprint: { rate: 2.7, x: 0.05, y: 0.04, z: 0.02, roll: 0.035, pitch: 0.024, yaw: 0.016 }
};

export class ViewmodelBob {
  constructor() {
    this.phase = 0; // one cycle = two steps
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

  // moving: walking input, sprint: running, aim: 0..1 ADS blend, scale: overall strength.
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
    const side = Math.sin(this.phase); // once per two steps
    const step = Math.sin(this.phase * 2); // once per step
    // The gun is lowest right after each footfall and sharpens there, like a real heel strike.
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
