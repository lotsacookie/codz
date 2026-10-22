import * as THREE from 'three';

const SHEETS = {
  fire: { url: 'textures/fxt_exp_fire.png', cols: 2, rows: 2 },
  glow: { url: 'textures/fxt_exp_glow.png', cols: 1, rows: 1 },
  smoke: { url: 'textures/fxt_smk_def_1.png', cols: 2, rows: 1 },
  plume: { url: 'textures/fxt_debris_plume_dirt.png', cols: 2, rows: 1 },
  ember: { url: 'textures/fxt_exp_ember_omni.png', cols: 1, rows: 1 }
};

const ADDITIVE = new Set(['fire', 'glow', 'ember']);
const SMOKE_TINT = 0x6d675f;
const PLUME_TINT = 0x8f8272;
const BASE_RADIUS = 256;
const MAX_SPRITES = 96;

const KINDS = {
  grenade: { scale: 1, smoke: 6, embers: 16, plumes: 1 },
  explosion: { scale: 1.3, smoke: 8, embers: 22, plumes: 2 }
};

function between(a, b) {
  return a + Math.random() * (b - a);
}

function fade(key, k) {
  if (key === 'glow') return (1 - k) * (1 - k);
  if (key === 'fire') return Math.pow(1 - k, 1.6);
  if (key === 'ember') return 1 - k;
  if (k < 0.12) return k / 0.12;
  return k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6;
}

export class ExplosionFx {
  constructor(scene, { textures = null } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'explosion-fx';
    this.group.frustumCulled = false;
    scene.add(this.group);
    this.items = [];
    this.pools = { add: [], norm: [] };
    this.textures = {};
    this.frames = {};
    this.aspects = {};
    this.cursor = 0;
    this.disposed = false;
    if (textures) {
      for (const [key, texture] of Object.entries(textures)) this.setTexture(key, texture);
      return;
    }
    if (typeof document === 'undefined') return;
    const loader = new THREE.TextureLoader();
    for (const [key, sheet] of Object.entries(SHEETS)) {
      loader.load(sheet.url, texture => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        this.setTexture(key, texture);
      }, undefined, () => {});
    }
  }

  setTexture(key, texture) {
    const sheet = SHEETS[key];
    if (!sheet) return;
    this.textures[key] = texture;
    const { cols, rows } = sheet;
    const width = texture.image?.width, height = texture.image?.height;
    this.aspects[key] = width && height ? (width / cols) / (height / rows) : 1;
    if (cols * rows === 1 || typeof texture.clone !== 'function') {
      this.frames[key] = [texture];
      return;
    }
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
  }

  ready() {
    return Boolean(this.frames.fire && this.frames.smoke);
  }

  acquire(additive) {
    const pool = additive ? this.pools.add : this.pools.norm;
    const pooled = pool.pop();
    if (pooled) return pooled;
    const material = new THREE.SpriteMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
      fog: !additive
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 8;
    sprite.frustumCulled = false;
    this.group.add(sprite);
    return { sprite, material, additive, velocity: new THREE.Vector3() };
  }

  release(item) {
    const index = this.items.indexOf(item);
    if (index < 0) return;
    const last = this.items.pop();
    if (last !== item) this.items[index] = last;
    item.sprite.visible = false;
    (item.additive ? this.pools.add : this.pools.norm).push(item);
  }

  emit(key, position, size, life, velocity, { delay = 0, grow = 1, opacity = 1, gravity = 0, drag = 0, spin = 0, color = 0xffffff } = {}) {
    const frames = this.frames[key];
    if (!frames) return null;
    if (this.items.length >= MAX_SPRITES) {
      this.cursor = (this.cursor + 1) % this.items.length;
      this.release(this.items[this.cursor]);
    }
    const item = this.acquire(ADDITIVE.has(key));
    const { sprite, material } = item;
    material.map = frames[Math.floor(Math.random() * frames.length)];
    material.color.setHex(color);
    material.opacity = 0;
    material.rotation = Math.random() * Math.PI * 2;
    item.key = key;
    item.aspect = this.aspects[key] ?? 1;
    item.size = size;
    item.life = life;
    item.age = -delay;
    item.grow = grow;
    item.peak = opacity;
    item.gravity = gravity;
    item.drag = drag;
    item.spin = spin;
    item.velocity.set(velocity.x, velocity.y, velocity.z);
    sprite.position.set(position.x, position.y, position.z);
    sprite.scale.set(size, size / item.aspect, 1);
    sprite.visible = delay <= 0;
    this.items.push(item);
    return item;
  }

  blast(position, { radius = BASE_RADIUS, kind = 'grenade' } = {}) {
    this.onBlast?.(position, radius, kind);
    if (!this.ready()) return false;
    const profile = KINDS[kind] ?? KINDS.grenade;
    const s = Math.min(2.2, Math.max(0.4, radius / BASE_RADIUS)) * profile.scale;
    const { x, y, z } = position;
    const core = { x, y: y + 18 * s, z };
    const still = { x: 0, y: 0, z: 0 };

    this.emit('glow', core, 420 * s, 0.2, still, { grow: 1.35, opacity: 0.95 });
    this.emit('fire', core, 230 * s, 0.55, { x: 0, y: 26 * s, z: 0 }, { grow: 1.55, spin: between(-0.4, 0.4) });
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2, reach = between(18, 46) * s;
      this.emit('fire', { x: x + Math.cos(angle) * reach, y: y + between(8, 40) * s, z: z + Math.sin(angle) * reach },
        between(120, 170) * s, between(0.35, 0.55), { x: Math.cos(angle) * 40 * s, y: between(20, 60) * s, z: Math.sin(angle) * 40 * s },
        { delay: between(0, 0.06), grow: 1.4, opacity: 0.9, spin: between(-0.8, 0.8) });
    }

    for (let i = 0; i < profile.smoke; i++) {
      const angle = Math.random() * Math.PI * 2, push = between(25, 70) * s;
      this.emit('smoke', { x: x + Math.cos(angle) * 14 * s, y: y + between(10, 40) * s, z: z + Math.sin(angle) * 14 * s },
        between(110, 180) * s, between(1.5, 2.4), { x: Math.cos(angle) * push, y: between(30, 75) * s, z: Math.sin(angle) * push },
        { delay: between(0.04, 0.22), grow: 2.2, opacity: 0.6, drag: 1.2, spin: between(-0.35, 0.35), color: SMOKE_TINT });
    }

    for (let i = 0; i < profile.plumes; i++) {
      const angle = Math.random() * Math.PI * 2, reach = between(10, 40) * s;
      this.emit('plume', { x: x + Math.cos(angle) * reach, y: y + 52 * s, z: z + Math.sin(angle) * reach },
        70 * s, between(0.7, 1.1), { x: 0, y: between(60, 110) * s, z: 0 },
        { delay: between(0, 0.08), grow: 1.5, opacity: 0.7, drag: 1.5, color: PLUME_TINT });
    }

    if (this.frames.ember) {
      for (let i = 0; i < profile.embers; i++) {
        const angle = Math.random() * Math.PI * 2, lift = between(0.25, 1), speed = between(140, 380) * s;
        this.emit('ember', core, between(5, 10) * s, between(0.5, 1.1),
          { x: Math.cos(angle) * speed * (1 - lift * 0.4), y: speed * lift, z: Math.sin(angle) * speed * (1 - lift * 0.4) },
          { grow: 0.4, gravity: 520 * s, drag: 0.6, opacity: 1 });
      }
    }
    return true;
  }

  update(dt) {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      item.age += dt;
      if (item.age < 0) continue;
      const k = item.age / item.life;
      if (k >= 1) {
        item.sprite.visible = false;
        (item.additive ? this.pools.add : this.pools.norm).push(item);
        items[i] = items[items.length - 1];
        items.pop();
        continue;
      }
      item.sprite.visible = true;
      const v = item.velocity;
      v.y -= item.gravity * dt;
      if (item.drag > 0) v.multiplyScalar(Math.max(0, 1 - item.drag * dt));
      item.sprite.position.addScaledVector(v, dt);
      const size = item.size * (1 + (item.grow - 1) * Math.min(1, k * 1.5));
      item.sprite.scale.set(size, size / item.aspect, 1);
      item.material.rotation += item.spin * dt;
      item.material.opacity = item.peak * fade(item.key, k);
    }
  }

  clear() {
    for (const item of this.items) {
      item.sprite.visible = false;
      (item.additive ? this.pools.add : this.pools.norm).push(item);
    }
    this.items.length = 0;
  }

  dispose() {
    this.disposed = true;
    this.clear();
    for (const pool of Object.values(this.pools)) {
      for (const item of pool) item.material.dispose();
      pool.length = 0;
    }
    for (const frames of Object.values(this.frames)) for (const frame of frames) frame.dispose();
    this.frames = {};
    this.textures = {};
    this.group.removeFromParent();
  }
}
