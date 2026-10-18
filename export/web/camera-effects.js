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
  meleeDip: -0.034,
  meleeDipFollow: -0.048,
  meleeSweep: 0.026,
  meleeImpact: 0.022,
  reloadGun: -0.055,
  reloadHold: -0.04,
  reloadLeftMin: 0.03,
  reloadLeftRange: 0.045,
  reloadDip: -0.03,
  reloadLift: 0.014,
  reloadSway: 0.012,
  shake: 0.05,
  pitchShake: 0.03,
  yawShake: 0.018,
  tremorRoll: 0.003,
  tremorPitch: 0.0035,
  tremorYaw: 0.0035,
  fireKick: 0.011
};

class Spring {
  constructor(freq, damping) {
    this.freq = freq;
    this.k = freq * freq;
    this.c = 2 * damping * freq;
    this.x = 0;
    this.v = 0;
  }

  bump(amount) {
    this.v += amount * this.freq * 1.4;
  }

  step(dt) {
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * this.x - this.c * this.v) * h;
      this.x += this.v * h;
    }
  }

  reset() {
    this.x = 0;
    this.v = 0;
  }
}

export class CameraEffects {
  constructor(random = Math.random) {
    this.random = random;
    this.tilts = [];
    this.events = [];
    this.hand = null;
    this.time = 0;
    this.trauma = 0;
    this.kick = 0;
    this.roll = 0;
    this.pitch = 0;
    this.yaw = 0;
    this.appliedPitch = 0;
    this.appliedYaw = 0;
    this.camera = null;
    this.rawSet = null;
    this.rollSpring = new Spring(20, 0.4);
    this.pitchSpring = new Spring(22, 0.4);
    this.yawSpring = new Spring(18, 0.45);
    this.seed = random() * 100;
  }

  track(kind, axis, duration, keys) {
    this.tilts.push({ kind, axis, duration, age: 0, keys: keys.map(([t, v]) => [t * duration, v]) });
  }

  schedule(kind, delay, spec) {
    this.events.push({ kind, at: this.time + Math.max(0, delay), ...spec });
  }

  tilt(kind, duration, keys) {
    this.cancel(kind);
    this.track(kind, 'roll', duration, keys);
  }

  melee(duration = 0.8, delay = duration * 0.4) {
    const total = Math.max(0.2, duration);
    const hit = clamp(delay / total, 0.22, 0.7);
    const follow = Math.min(0.92, hit + 0.2);
    this.cancel('reload');
    this.cancel('melee');
    this.track('melee', 'roll', total, [[0, 0], [0.16, TILT.melee], [hit, TILT.meleeFollow], [follow, TILT.melee * 0.45], [1, 0]]);
    this.track('melee', 'pitch', total, [[0, 0], [0.16, TILT.meleeDip], [hit, TILT.meleeDipFollow], [follow, TILT.meleeDip * -0.2], [1, 0]]);
    this.track('melee', 'yaw', total, [[0, 0], [0.16, -TILT.meleeSweep], [hit, TILT.meleeSweep * 1.4], [follow, TILT.meleeSweep * 0.3], [1, 0]]);
    this.schedule('melee', delay, { trauma: 0.62, pitch: TILT.meleeImpact, yaw: -0.01, roll: -0.008 });
    this.trauma = Math.max(this.trauma, 0.18);
  }

  reload(duration = 2, stage = 'magazine', empty = false) {
    const total = Math.max(0.5, duration);
    const left = TILT.reloadLeftMin + this.random() * TILT.reloadLeftRange;
    const late = 0.6 + this.random() * 0.08;
    const side = this.random() < 0.5 ? -1 : 1;
    const scale = 0.85 + this.random() * 0.3;
    this.cancel('reload');
    this.hand = { age: 0, duration: total };
    if (stage === 'start') {
      this.track('reload', 'roll', total, [[0, 0], [0.4, TILT.reloadGun], [1, 0]]);
      this.track('reload', 'pitch', total, [[0, 0], [0.4, TILT.reloadDip * 0.6 * scale], [1, 0]]);
      this.schedule('reload', total * 0.5, { trauma: 0.14, pitch: -0.008 * scale });
    } else if (stage === 'end') {
      this.track('reload', 'roll', total, [[0, 0], [0.35, left * 0.8], [1, 0]]);
      this.track('reload', 'pitch', total, [[0, 0], [0.3, TILT.reloadDip * 0.4 * scale], [0.55, TILT.reloadLift * scale], [1, 0]]);
      this.track('reload', 'yaw', total, [[0, 0], [0.35, side * TILT.reloadSway * 0.6], [1, 0]]);
      this.schedule('reload', total * 0.45, { trauma: 0.3, pitch: -0.014 * scale, roll: side * 0.004 });
    } else {
      this.track('reload', 'roll', total, [[0, 0], [0.2, TILT.reloadGun], [0.45, TILT.reloadHold], [late, left], [0.86, left * 0.35], [1, 0]]);
      this.track('reload', 'pitch', total, [
        [0, 0],
        [0.14, TILT.reloadDip * 0.7 * scale],
        [0.32, TILT.reloadDip * scale],
        [0.5, TILT.reloadLift * scale],
        [0.64, TILT.reloadDip * 0.4 * scale],
        [0.78, TILT.reloadLift * 0.5 * scale],
        [1, 0]
      ]);
      this.track('reload', 'yaw', total, [
        [0, 0],
        [0.2, side * TILT.reloadSway],
        [0.46, -side * TILT.reloadSway * 0.7],
        [0.66, side * TILT.reloadSway * 0.5],
        [0.86, 0],
        [1, 0]
      ]);
      this.schedule('reload', total * 0.3, { trauma: 0.2, pitch: -0.012 * scale, roll: side * 0.004 });
      this.schedule('reload', total * 0.62, { trauma: 0.4, pitch: -0.02 * scale, yaw: side * 0.008, roll: -side * 0.005 });
      if (empty) this.schedule('reload', total * 0.88, { trauma: 0.35, pitch: -0.014 * scale, roll: side * 0.004 });
      else this.schedule('reload', total * 0.88, { trauma: 0.22, pitch: -0.008 * scale });
    }
  }

  fire() {
    this.kick += (this.random() - 0.5) * TILT.fireKick;
  }

  cancel(kind) {
    this.tilts = this.tilts.filter(t => t.kind !== kind);
    this.events = this.events.filter(e => e.kind !== kind);
    if (kind === 'reload') this.hand = null;
  }

  reset() {
    this.tilts.length = 0;
    this.events.length = 0;
    this.hand = null;
    this.trauma = 0;
    this.kick = 0;
    this.roll = 0;
    this.pitch = 0;
    this.yaw = 0;
    this.rollSpring.reset();
    this.pitchSpring.reset();
    this.yawSpring.reset();
    if (this.camera) {
      const r = this.camera.rotation;
      this.rawSet(r.x - this.appliedPitch, r.y - this.appliedYaw, 0);
    }
    this.appliedPitch = 0;
    this.appliedYaw = 0;
  }

  noise(time) {
    const s = this.seed;
    return Math.sin(time * 41 + s) * 0.5 + Math.sin(time * 27.3 + s * 1.7) * 0.32 + Math.sin(time * 63 + s * 0.6) * 0.18;
  }

  tremor(phase) {
    const t = this.time + this.seed;
    return Math.sin(t * 7.3 + phase) * 0.5 + Math.sin(t * 12.1 + phase * 1.9) * 0.3 + Math.sin(t * 17.7 + phase * 0.7) * 0.2;
  }

  trigger(e) {
    if (e.trauma) this.trauma = Math.max(this.trauma, e.trauma);
    if (e.roll) this.rollSpring.bump(e.roll);
    if (e.pitch) this.pitchSpring.bump(e.pitch);
    if (e.yaw) this.yawSpring.bump(e.yaw);
  }

  update(dt) {
    const step = clamp(dt, 0, 0.1);
    this.time += step;
    let roll = 0;
    let pitch = 0;
    let yaw = 0;
    for (const t of this.tilts) {
      t.age += step;
      const value = sample(t.keys, Math.min(t.age, t.duration));
      if (t.axis === 'pitch') pitch += value;
      else if (t.axis === 'yaw') yaw += value;
      else roll += value;
    }
    this.tilts = this.tilts.filter(t => t.age < t.duration);
    if (this.events.length) {
      for (const e of this.events) if (this.time >= e.at) this.trigger(e);
      this.events = this.events.filter(e => this.time < e.at);
    }
    let hand = 0;
    if (this.hand) {
      this.hand.age += step;
      hand = Math.sin(Math.PI * clamp(this.hand.age / this.hand.duration, 0, 1));
      if (this.hand.age >= this.hand.duration) this.hand = null;
    }
    this.rollSpring.step(step);
    this.pitchSpring.step(step);
    this.yawSpring.step(step);
    this.kick *= Math.exp(-step * 14);
    this.trauma = Math.max(0, this.trauma - step * 1.9);
    const shake = this.trauma * this.trauma;
    this.roll = roll + this.kick + this.rollSpring.x + this.noise(this.time) * TILT.shake * shake + this.tremor(0) * TILT.tremorRoll * hand;
    this.pitch = pitch + this.pitchSpring.x + this.noise(this.time + 11.3) * TILT.pitchShake * shake + this.tremor(2.1) * TILT.tremorPitch * hand;
    this.yaw = yaw + this.yawSpring.x + this.noise(this.time + 23.7) * TILT.yawShake * shake + this.tremor(4.2) * TILT.tremorYaw * hand;
    return this.roll;
  }

  attach(camera) {
    if (this.camera === camera) return this;
    this.camera = camera;
    this.appliedPitch = 0;
    this.appliedYaw = 0;
    const rotation = camera.rotation;
    const set = rotation.set.bind(rotation);
    this.rawSet = set;
    rotation.set = (...args) => {
      this.appliedPitch = 0;
      this.appliedYaw = 0;
      return set(...args);
    };
    return this;
  }

  lookBase(camera) {
    return { yaw: camera.rotation.y - this.appliedYaw, pitch: camera.rotation.x - this.appliedPitch };
  }

  apply(camera, dt) {
    this.attach(camera);
    this.update(dt);
    this.rawSet(camera.rotation.x + this.pitch - this.appliedPitch, camera.rotation.y + this.yaw - this.appliedYaw, this.roll);
    this.appliedPitch = this.pitch;
    this.appliedYaw = this.yaw;
  }
}
