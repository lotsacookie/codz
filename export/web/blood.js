import * as THREE from 'three';

const TEXTURES = {
  burst: 'textures/fxt_bio_bloodburst_b.png',
  burstTall: 'textures/fxt_bio_bloodburst_c.png',
  gush: 'textures/fxt_bio_bloodgush.png',
  drops: 'textures/fxt_bio_blooddrops.png',
  trail: 'textures/fxt_bio_bloodtrail.png',
  cloud: 'textures/fxt_bio_blood_cloud.png',
  splat: 'textures/fxt_bio_bloodburst.png'
};

const MAX_SPRITES = 400;
const GRAVITY = 360;
const UP = Object.freeze(new THREE.Vector3(0, 1, 0));
// World units are Black Ops inches: a zombie is ~72 tall and its head ~10 across, and the
// game only plays a small neck/hit spurt. Sizes below are tuned to that, not to the
// source texture resolution.
//
// Performance: sprites and their materials are pooled in one dedicated group (no per-drop
// allocation or scene add/remove), texture aspect ratios are cached, and the hot emit path
// takes plain numbers so bursts do not create vectors.

export class BloodFx {
  // textures: optional {key: texture} to use instead of loading the files (tests, preloaded packs).
  constructor(scene, { textures = null } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'blood-fx';
    this.group.frustumCulled = false;
    scene.add(this.group);
    this.items = [];
    this.pool = [];
    this.fountains = [];
    this.textures = {};
    this.aspects = {};
    this.cursor = 0;
    this.pos = new THREE.Vector3();
    if (textures) {
      for (const [key, texture] of Object.entries(textures)) this.setTexture(key, texture);
      return;
    }
    const loader = new THREE.TextureLoader();
    for (const [key, url] of Object.entries(TEXTURES)) {
      loader.load(url, texture => { texture.colorSpace = THREE.SRGBColorSpace; this.setTexture(key, texture); }, undefined, () => {});
    }
  }

  setTexture(key, texture) {
    this.textures[key] = texture;
    const image = texture.image;
    this.aspects[key] = image?.width && image?.height ? image.width / image.height : 1;
  }

  ready() {
    return Boolean(this.textures.burst && this.textures.drops);
  }

  acquire() {
    const pooled = this.pool.pop();
    if (pooled) return pooled;
    const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: true });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 6;
    sprite.frustumCulled = false;
    this.group.add(sprite);
    return { sprite, material, age: 0, life: 1, size: 1, aspect: 1, grow: 1, velocity: new THREE.Vector3(), gravity: 0, opacity: 1, spin: 0 };
  }

  // Core emit: plain numbers, no allocation once the pool is warm.
  emit(key, x, y, z, size, life, vx, vy, vz, gravity = 0, grow = 1, opacity = 0.95, spin = 0) {
    const map = this.textures[key];
    if (!map) return null;
    if (this.items.length >= MAX_SPRITES) {
      this.cursor = (this.cursor + 1) % this.items.length;
      this.release(this.items[this.cursor]);
    }
    const item = this.acquire();
    const { sprite, material } = item;
    if (material.map !== map) material.map = map;
    material.opacity = opacity;
    material.rotation = Math.random() * Math.PI * 2;
    sprite.position.set(x, y, z);
    item.aspect = this.aspects[key] ?? 1;
    sprite.scale.set(size, size / item.aspect, 1);
    sprite.visible = true;
    item.age = 0;
    item.life = life;
    item.size = size;
    item.grow = grow;
    item.velocity.set(vx, vy, vz);
    item.gravity = gravity;
    item.opacity = opacity;
    item.spin = spin;
    this.items.push(item);
    return item;
  }

  sprite(key, position, size, life, options = {}) {
    const v = options.velocity;
    return this.emit(key, position.x, position.y, position.z, size, life, v?.x ?? 0, v?.y ?? 0, v?.z ?? 0,
      options.gravity ?? 0, options.grow ?? 1, options.opacity ?? 0.95, options.spin ?? 0);
  }

  spray(position, awayFrom, { head = false, kill = false } = {}) {
    if (!this.ready()) return;
    const away = this.pos.copy(position).sub(awayFrom);
    away.y = Math.max(away.y, 0);
    if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
    away.normalize();
    const ax = away.x, ay = away.y, az = away.z;
    const scale = kill ? 1.6 : head ? 1.3 : 1;
    const { x, y, z } = position;
    this.emit('burst', x, y, z, (6 + Math.random() * 3) * scale, 0.28 + Math.random() * 0.1, ax * 14, ay * 14, az * 14, 0, 1.6, 0.95, (Math.random() - 0.5) * 2);
    if (head || kill) {
      this.emit(this.textures.gush ? 'gush' : 'burstTall', x, y, z, (9 + Math.random() * 4) * scale, 0.4, ax * 30, 14, az * 30, 120, 1.4, 0.8);
    }
    const drops = Math.round((kill ? 9 : head ? 7 : 4) * (0.8 + Math.random() * 0.4));
    for (let i = 0; i < drops; i++) {
      const speed = 30 + Math.random() * 70;
      this.emit('drops', x, y, z, 1 + Math.random() * 1.8 * scale, 0.45 + Math.random() * 0.4,
        ax * speed + (Math.random() - 0.5) * 55, ay * speed + 10 + Math.random() * 55, az * speed + (Math.random() - 0.5) * 55, GRAVITY, 0.55, 0.9);
    }
    if (kill && this.textures.trail) this.emit('trail', x, y - 3, z, 16, 0.7, ax * 8, ay * 8, az * 8, 40, 1.4, 0.6);
  }

  // A single drop or smear thrown off a bloody blade. strength is 0..1.
  fling(position, velocity, strength = 1) {
    if (!this.ready()) return;
    const smear = Math.random() < 0.3 && this.textures.trail;
    this.emit(smear ? 'trail' : 'drops', position.x, position.y, position.z, smear ? 3 + Math.random() * 4 * strength : 0.9 + Math.random() * 1.5 * strength,
      0.35 + Math.random() * 0.45, velocity.x, velocity.y, velocity.z, GRAVITY, smear ? 1.5 : 0.7, smear ? 0.55 : 0.9, (Math.random() - 0.5) * 3);
  }

  // The red arc the blade leaves through the air right as it connects.
  slash(position, direction) {
    if (!this.ready()) return;
    const along = this.pos.set(direction.x, direction.y, direction.z).normalize();
    const ax = along.x, ay = along.y, az = along.z;
    for (let i = 0; i < 3; i++) {
      this.emit(this.textures.trail ? 'trail' : 'burst', position.x + ax * i * 4, position.y + ay * i * 4, position.z + az * i * 4, 12 + i * 4, 0.45 + i * 0.08,
        ax * (26 + i * 10), ay * (26 + i * 10), az * (26 + i * 10), 60, 1.5, 0.75, (Math.random() - 0.5) * 1.5);
    }
  }

  // Blood thrown out of a severed part: a tight column along `direction`, a red mist, and a fountain
  // that keeps pumping for a moment. `at` is a position or a function returning one (it follows the body).
  // power 1..3 scales the amount and speed.
  burst(at, { power = 1, direction = UP } = {}) {
    if (!this.ready()) return;
    const origin = typeof at === 'function' ? at() : at;
    const p = Math.min(3, Math.max(1, power));
    const d = this.pos.copy(direction).normalize();
    const dx = d.x, dy = d.y, dz = d.z;
    const { x, y, z } = origin;
    const pick = (a, b) => (this.textures[a] ? a : b);
    this.emit(pick('cloud', 'burst'), x, y, z, 20 * p, 0.55, dx * 40, dy * 40, dz * 40, 0, 2.2, 0.7, 0.4);
    this.emit(pick('splat', 'burst'), x, y, z, 16 * p, 0.35, dx * 30, dy * 30, dz * 30, 0, 1.8, 0.95);
    // Lots of blood, but it stays low: peak heights come out around 25-55 world units (a zombie is ~72).
    this.emit(pick('cloud', 'burst'), x, y, z, 14 * p, 0.5, dx * 20, dy * 20, dz * 20, 0, 2.2, 0.6, -0.3);
    const strength = 0.6 + 0.4 * p;
    const column = Math.round(26 + 10 * p);
    for (let i = 0; i < column; i++) {
      const speed = 70 + Math.random() * 60 * strength;
      this.emit(Math.random() < 0.6 ? pick('gush', 'burst') : pick('burstTall', 'burst'),
        x + (Math.random() - 0.5) * 4, y + Math.random() * 4, z + (Math.random() - 0.5) * 4,
        (4.5 + Math.random() * 4.5) * (0.8 + 0.3 * p), 0.7 + Math.random() * 0.5,
        dx * speed + (Math.random() - 0.5) * 30, dy * speed + (Math.random() - 0.5) * 22, dz * speed + (Math.random() - 0.5) * 30,
        300, 1.5, 0.88, (Math.random() - 0.5) * 2);
    }
    const drops = Math.round(50 + 20 * p);
    for (let i = 0; i < drops; i++) {
      const speed = 50 + Math.random() * 70 * strength;
      this.emit('drops', x, y, z, 1.3 + Math.random() * 2.4, 0.8 + Math.random() * 0.7,
        dx * speed + (Math.random() - 0.5) * 70, dy * speed + (Math.random() - 0.5) * 50, dz * speed + (Math.random() - 0.5) * 70, GRAVITY, 0.6, 0.95);
    }
    this.fountains.push({ at, age: 0, life: 0.8 + 0.2 * p, rate: 95 * p, carry: 0, dx, dy, dz, speed: 55 });
  }

  headBurst(at, { power = 1 } = {}) {
    this.burst(at, { power, direction: UP });
  }

  // Blood dripping and spraying off a flying severed part for a moment.
  trail(at, { life = 0.6, rate = 40 } = {}) {
    if (!this.ready()) return;
    this.fountains.push({ at, age: 0, life, rate, carry: 0, dx: 0, dy: 0, dz: 0, speed: 0, scatter: 30 });
  }

  release(item) {
    const index = this.items.indexOf(item);
    if (index < 0) return;
    const last = this.items.pop();
    if (last !== item) this.items[index] = last;
    item.sprite.visible = false;
    this.pool.push(item);
  }

  update(dt) {
    for (let i = this.fountains.length - 1; i >= 0; i--) {
      const f = this.fountains[i];
      f.age += dt;
      if (f.age >= f.life) { this.fountains[i] = this.fountains[this.fountains.length - 1]; this.fountains.pop(); continue; }
      // The heart pumps, so the spurt pulses and weakens.
      const pulse = 0.55 + 0.45 * Math.sin(f.age * 22);
      f.carry += f.rate * pulse * (1 - f.age / f.life) * dt;
      if (f.carry < 1) continue;
      const origin = typeof f.at === 'function' ? f.at() : f.at;
      const scatter = f.scatter ?? 18;
      while (f.carry >= 1) {
        f.carry -= 1;
        const speed = f.speed * (1 + Math.random() * 1.1);
        this.emit(Math.random() < 0.5 ? 'drops' : (this.textures.gush ? 'gush' : 'burst'), origin.x, origin.y, origin.z, 2 + Math.random() * 3, 0.5 + Math.random() * 0.4,
          f.dx * speed + (Math.random() - 0.5) * scatter, f.dy * speed + (Math.random() - 0.5) * scatter, f.dz * speed + (Math.random() - 0.5) * scatter, 280, 1.3, 0.85);
      }
    }
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      item.age += dt;
      const k = item.age / item.life;
      if (k >= 1) {
        item.sprite.visible = false;
        this.pool.push(item);
        items[i] = items[items.length - 1];
        items.pop();
        continue;
      }
      const v = item.velocity;
      v.y -= item.gravity * dt;
      item.sprite.position.addScaledVector(v, dt);
      const s = item.size * (1 + (item.grow - 1) * Math.min(1, k * 1.5));
      item.sprite.scale.set(s, s / item.aspect, 1);
      item.material.rotation += item.spin * dt;
      item.material.opacity = item.opacity * (k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65);
    }
  }

  clear() {
    this.fountains.length = 0;
    for (const item of this.items) item.sprite.visible = false;
    this.pool.push(...this.items);
    this.items.length = 0;
  }

  dispose() {
    this.clear();
    for (const item of this.pool) item.material.dispose();
    this.pool.length = 0;
    this.group.removeFromParent();
  }
}
