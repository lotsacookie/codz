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

const ATLAS = { splat: [4, 4], drops: [2, 2], gush: [2, 1] };
const TINT = { splat: 0x7a1313, cloud: 0xd01c1c };

const MAX_SPRITES = 400;
const TRAIL_MIN_SPEED = 60;
const GRAVITY = 360;
const UP = Object.freeze(new THREE.Vector3(0, 1, 0));

export class BloodFx {
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
    this.frames = {};
    this.aspects = {};
    this.cursor = 0;
    this.pos = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
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
    const width = image?.width, height = image?.height;
    const grid = ATLAS[key];
    if (grid && typeof texture.clone === 'function') {
      const [cols, rows] = grid;
      const frames = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const frame = texture.clone();
          frame.repeat.set(1 / cols, 1 / rows);
          frame.offset.set(col / cols, 1 - (row + 1) / rows);
          frame.needsUpdate = true;
          frames.push(frame);
        }
      }
      this.frames[key] = frames;
      this.aspects[key] = width && height ? (width / cols) / (height / rows) : 1;
      return;
    }
    this.aspects[key] = width && height ? width / height : 1;
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

  emit(key, x, y, z, size, life, vx, vy, vz, gravity = 0, grow = 1, opacity = 0.95, spin = 0, rotation = null) {
    const frames = this.frames[key];
    const map = frames ? frames[Math.floor(Math.random() * frames.length)] : this.textures[key];
    if (!map) return null;
    if (this.items.length >= MAX_SPRITES) {
      this.cursor = (this.cursor + 1) % this.items.length;
      this.release(this.items[this.cursor]);
    }
    const item = this.acquire();
    const { sprite, material } = item;
    if (material.map !== map) material.map = map;
    material.color.setHex(TINT[key] ?? 0xffffff);
    material.opacity = opacity;
    material.rotation = rotation ?? Math.random() * Math.PI * 2;
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
      options.gravity ?? 0, options.grow ?? 1, options.opacity ?? 0.95, options.spin ?? 0, options.rotation ?? null);
  }

  screenAngle(camera, x, y, z) {
    if (!camera) return null;
    camera.updateMatrixWorld();
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(camera.matrixWorld, 1);
    const along = x * this.right.x + y * this.right.y + z * this.right.z;
    const rise = x * this.up.x + y * this.up.y + z * this.up.z;
    if (along * along + rise * rise < 1e-6) return null;
    return Math.atan2(rise, along);
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
    this.emit('splat', x, y, z, (7 + Math.random() * 3) * scale, 0.25 + Math.random() * 0.1, ax * 8, ay * 8, az * 8, 0, 1.5, 0.85, (Math.random() - 0.5) * 1.5);
    this.emit('burst', x, y, z, (6 + Math.random() * 3) * scale, 0.28 + Math.random() * 0.1, ax * 14, ay * 14, az * 14, 0, 1.6, 0.95, (Math.random() - 0.5) * 2);
    if (head || kill) {
      this.emit(this.textures.gush ? 'gush' : 'burstTall', x, y, z, (9 + Math.random() * 4) * scale, 0.4, ax * 30, 14, az * 30, 120, 1.4, 0.8);
    }
    const drops = Math.round((kill ? 6 : head ? 5 : 3) * (0.8 + Math.random() * 0.4));
    for (let i = 0; i < drops; i++) {
      const speed = 30 + Math.random() * 70;
      this.emit('drops', x, y, z, (2.6 + Math.random() * 2.6) * Math.sqrt(scale), 0.45 + Math.random() * 0.4,
        ax * speed + (Math.random() - 0.5) * 55, ay * speed + 10 + Math.random() * 55, az * speed + (Math.random() - 0.5) * 55, GRAVITY, 0.7, 0.9);
    }
    if (kill && this.textures.trail) this.emit('trail', x, y - 3, z, 20, 0.7, ax * 8, ay * 8, az * 8, 40, 1.4, 0.75, 0, (Math.random() - 0.5) * 0.6);
  }

  fling(position, velocity, strength = 1, camera = null, speed = Infinity, heading = null) {
    if (!this.ready()) return;
    const k = 0.55 + 0.45 * strength;
    const along = heading ?? velocity;
    const angle = this.screenAngle(camera, along.x, along.y, along.z);
    const streaking = this.textures.trail && (angle !== null || !camera) && speed >= TRAIL_MIN_SPEED;
    if (streaking) {
      const size = (10 + Math.random() * 3) * k;
      const reach = size * 0.45;
      const hx = heading ? heading.x : 0, hy = heading ? heading.y : 0, hz = heading ? heading.z : 0;
      this.emit('trail', position.x + hx * reach, position.y + hy * reach, position.z + hz * reach, size, 0.35 + Math.random() * 0.2,
        hx * 14, hy * 14, hz * 14, 60, 1.1, 0.85, 0, angle ?? 0);
    }
    if (!streaking || Math.random() < 0.45) {
      this.emit('drops', position.x, position.y, position.z, (2.2 + Math.random() * 2) * k, 0.35 + Math.random() * 0.4,
        velocity.x, velocity.y, velocity.z, GRAVITY, 0.8, 0.9, (Math.random() - 0.5) * 3);
    }
  }

  slash(position, direction, camera = null) {
    if (!this.ready()) return;
    const along = this.pos.set(direction.x, direction.y, direction.z).normalize();
    const ax = along.x, ay = along.y, az = along.z;
    const angle = this.screenAngle(camera, ax, ay, az);
    for (let i = 0; i < 3; i++) {
      this.emit(this.textures.trail ? 'trail' : 'burst', position.x + ax * i * 5, position.y + ay * i * 5, position.z + az * i * 5, 28 - i * 4, 0.5 + i * 0.08,
        ax * (12 + i * 6), ay * (12 + i * 6), az * (12 + i * 6), 40, 1.25, 0.8, 0, angle ?? (Math.random() - 0.5) * 0.8);
    }
  }

  burst(at, { power = 1, direction = UP } = {}) {
    if (!this.ready()) return;
    const origin = typeof at === 'function' ? at() : at;
    const p = Math.min(3, Math.max(1, power));
    const d = this.pos.copy(direction).normalize();
    const dx = d.x, dy = d.y, dz = d.z;
    const { x, y, z } = origin;
    const pick = (a, b) => (this.textures[a] ? a : b);
    this.emit(pick('cloud', 'burst'), x, y, z, 20 * p, 0.55, dx * 40, dy * 40, dz * 40, 0, 2.2, 0.7, 0.4);
    this.emit(pick('splat', 'burst'), x, y, z, 16 * p, 0.35, dx * 30, dy * 30, dz * 30, 0, 1.8, 0.9);
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
      this.emit('drops', x, y, z, 2.6 + Math.random() * 3, 0.8 + Math.random() * 0.7,
        dx * speed + (Math.random() - 0.5) * 70, dy * speed + (Math.random() - 0.5) * 50, dz * speed + (Math.random() - 0.5) * 70, GRAVITY, 0.7, 0.95);
    }
    this.fountains.push({ at, age: 0, delay: 0, life: 0.8 + 0.2 * p, rate: 95 * p, carry: 0, dx, dy, dz, speed: 55 });
  }

  headBurst(at, { power = 1 } = {}) {
    this.burst(at, { power, direction: UP });
    this.fountains.push({ at, age: 0, delay: 0.3, life: 0.6, rate: 55, carry: 0, dx: 0, dy: 1, dz: 0, speed: 50, scatter: 20 });
  }

  trail(at, { life = 0.6, rate = 40 } = {}) {
    if (!this.ready()) return;
    this.fountains.push({ at, age: 0, delay: 0, life, rate, carry: 0, dx: 0, dy: 0, dz: 0, speed: 0, scatter: 30, streak: true });
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
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.age += dt;
      if (f.age >= f.life) { this.fountains[i] = this.fountains[this.fountains.length - 1]; this.fountains.pop(); continue; }
      const pulse = 0.55 + 0.45 * Math.sin(f.age * 22);
      f.carry += f.rate * pulse * (1 - f.age / f.life) * dt;
      if (f.carry < 1) continue;
      const origin = typeof f.at === 'function' ? f.at() : f.at;
      const scatter = f.scatter ?? 18;
      while (f.carry >= 1) {
        f.carry -= 1;
        const speed = f.speed * (1 + Math.random() * 1.1);
        const vx = f.dx * speed + (Math.random() - 0.5) * scatter, vy = f.dy * speed + (Math.random() - 0.5) * scatter, vz = f.dz * speed + (Math.random() - 0.5) * scatter;
        if (f.streak && this.textures.trail && Math.random() < 0.6) {
          this.emit('trail', origin.x, origin.y, origin.z, 6 + Math.random() * 5, 0.45 + Math.random() * 0.3, vx * 0.3, vy * 0.3, vz * 0.3, 200, 1.2, 0.8, 0, (Math.random() - 0.5) * 0.9);
        } else if (Math.random() < 0.5) {
          this.emit('drops', origin.x, origin.y, origin.z, 2.4 + Math.random() * 2.4, 0.5 + Math.random() * 0.4, vx, vy, vz, 280, 0.8, 0.85);
        } else {
          this.emit(this.textures.gush ? 'gush' : 'burst', origin.x, origin.y, origin.z, 2 + Math.random() * 3, 0.5 + Math.random() * 0.4, vx, vy, vz, 280, 1.3, 0.85);
        }
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
    for (const frames of Object.values(this.frames)) for (const frame of frames) frame.dispose();
    this.frames = {};
    this.group.removeFromParent();
  }
}
