const smooth = t => t * t * (3 - 2 * t);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function sample(keys, time) {
  if (time <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (time <= t1) {
      const [t0, v0] = keys[i - 1];
      return v0 + (v1 - v0) * smooth((time - t0) / (t1 - t0 || 1));
    }
  }
  return keys[keys.length - 1][1];
}

export const TILT = {
  melee: -0.085,
  meleeFollow: -0.1,
  reloadGun: -0.055,
  reloadHold: -0.04,
  reloadLeftMin: 0.03,
  reloadLeftRange: 0.045,
  shake: 0.05,
  fireKick: 0.011
};

export class CameraEffects {
  constructor(random = Math.random) {
    this.random = random;
    this.tilts = [];
    this.events = [];
    this.time = 0;
    this.trauma = 0;
    this.kick = 0;
    this.roll = 0;
    this.seed = random() * 100;
  }

  tilt(kind, duration, keys) {
    this.cancel(kind);
    this.tilts.push({ kind, duration, age: 0, keys: keys.map(([t, v]) => [t * duration, v]) });
  }

  melee(duration = 0.8, delay = duration * 0.4) {
    const total = Math.max(0.2, duration);
    const hit = clamp(delay / total, 0.22, 0.7);
    this.cancel('reload');
    this.tilt('melee', total, [[0, 0], [0.16, TILT.melee], [hit, TILT.meleeFollow], [Math.min(0.92, hit + 0.2), TILT.melee * 0.45], [1, 0]]);
    this.events.push({ at: this.time + Math.max(0, delay), trauma: 0.62 });
    this.trauma = Math.max(this.trauma, 0.18);
  }

  reload(duration = 2, stage = 'magazine') {
    const total = Math.max(0.5, duration);
    const left = TILT.reloadLeftMin + this.random() * TILT.reloadLeftRange;
    const late = 0.6 + this.random() * 0.08;
    if (stage === 'start') this.tilt('reload', total, [[0, 0], [0.4, TILT.reloadGun], [1, 0]]);
    else if (stage === 'end') this.tilt('reload', total, [[0, 0], [0.35, left * 0.8], [1, 0]]);
    else this.tilt('reload', total, [[0, 0], [0.2, TILT.reloadGun], [0.45, TILT.reloadHold], [late, left], [0.86, left * 0.35], [1, 0]]);
  }

  fire() {
    this.kick += (this.random() - 0.5) * TILT.fireKick;
  }

  cancel(kind) {
    this.tilts = this.tilts.filter(t => t.kind !== kind);
  }

  reset() {
    this.tilts.length = 0;
    this.events.length = 0;
    this.trauma = 0;
    this.kick = 0;
    this.roll = 0;
  }

  noise(time) {
    const s = this.seed;
    return Math.sin(time * 41 + s) * 0.5 + Math.sin(time * 27.3 + s * 1.7) * 0.32 + Math.sin(time * 63 + s * 0.6) * 0.18;
  }

  update(dt) {
    const step = clamp(dt, 0, 0.1);
    this.time += step;
    let roll = 0;
    for (const t of this.tilts) {
      t.age += step;
      roll += sample(t.keys, Math.min(t.age, t.duration));
    }
    this.tilts = this.tilts.filter(t => t.age < t.duration);
    if (this.events.length) {
      for (const e of this.events) if (this.time >= e.at) this.trauma = Math.max(this.trauma, e.trauma);
      this.events = this.events.filter(e => this.time < e.at);
    }
    this.kick *= Math.exp(-step * 14);
    this.trauma = Math.max(0, this.trauma - step * 1.9);
    this.roll = roll + this.kick + this.noise(this.time) * TILT.shake * this.trauma * this.trauma;
    return this.roll;
  }

  apply(camera, dt) {
    camera.rotation.z = this.update(dt);
  }
}
