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

const MAX_SPRITES = 260;
const GRAVITY = 360;
// World units are Black Ops inches: a zombie is ~72 tall and its head ~10 across, and the
// game only plays a small neck/hit spurt. Sizes below are tuned to that, not to the
// source texture resolution.

export class BloodFx {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.fountains = [];
    this.textures = {};
    const loader = new THREE.TextureLoader();
    for (const [key, url] of Object.entries(TEXTURES)) {
      loader.load(url, texture => { texture.colorSpace = THREE.SRGBColorSpace; this.textures[key] = texture; }, undefined, () => {});
    }
  }

  ready() {
    return Boolean(this.textures.burst && this.textures.drops);
  }

  sprite(key, position, size, life, options = {}) {
    const map = this.textures[key];
    if (!map) return null;
    if (this.items.length >= MAX_SPRITES) this.release(this.items[0]);
    const material = new THREE.SpriteMaterial({
      map,
      color: options.color ?? 0xffffff,
      transparent: true,
      opacity: options.opacity ?? 0.95,
      depthWrite: false,
      rotation: Math.random() * Math.PI * 2,
      fog: true
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    const image = map.image;
    const aspect = image?.width && image?.height ? image.width / image.height : 1;
    sprite.scale.set(size, size / aspect, 1);
    sprite.renderOrder = 6;
    this.scene.add(sprite);
    const item = {
      sprite,
      material,
      age: 0,
      life,
      size,
      aspect,
      grow: options.grow ?? 1,
      velocity: options.velocity ?? new THREE.Vector3(),
      gravity: options.gravity ?? 0,
      opacity: material.opacity,
      spin: options.spin ?? 0
    };
    this.items.push(item);
    return item;
  }

  spray(position, awayFrom, { head = false, kill = false } = {}) {
    if (!this.ready()) return;
    const away = position.clone().sub(awayFrom);
    away.y = Math.max(away.y, 0);
    if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
    away.normalize();
    const scale = kill ? 1.6 : head ? 1.3 : 1;
    this.sprite('burst', position, (6 + Math.random() * 3) * scale, 0.28 + Math.random() * 0.1, {
      grow: 1.6,
      velocity: away.clone().multiplyScalar(14),
      spin: (Math.random() - 0.5) * 2
    });
    if (head || kill) {
      this.sprite(this.textures.gush ? 'gush' : 'burstTall', position, (9 + Math.random() * 4) * scale, 0.4, {
        grow: 1.4,
        velocity: away.clone().multiplyScalar(30).setY(14),
        gravity: 120,
        opacity: 0.8
      });
    }
    const drops = Math.round((kill ? 9 : head ? 7 : 4) * (0.8 + Math.random() * 0.4));
    for (let i = 0; i < drops; i++) {
      const velocity = away.clone().multiplyScalar(30 + Math.random() * 70);
      velocity.x += (Math.random() - 0.5) * 55;
      velocity.z += (Math.random() - 0.5) * 55;
      velocity.y += 10 + Math.random() * 55;
      this.sprite('drops', position, 1 + Math.random() * 1.8 * scale, 0.45 + Math.random() * 0.4, {
        velocity,
        gravity: GRAVITY,
        grow: 0.55,
        opacity: 0.9
      });
    }
    if (kill && this.textures.trail) {
      this.sprite('trail', position.clone().add(new THREE.Vector3(0, -3, 0)), 16, 0.7, {
        grow: 1.4,
        velocity: away.clone().multiplyScalar(8),
        gravity: 40,
        opacity: 0.6
      });
    }
  }

  // A single drop or smear thrown off a bloody blade. strength is 0..1.
  fling(position, velocity, strength = 1) {
    if (!this.ready()) return;
    const smear = Math.random() < 0.3 && this.textures.trail;
    this.sprite(smear ? 'trail' : 'drops', position, smear ? 3 + Math.random() * 4 * strength : 0.9 + Math.random() * 1.5 * strength, 0.35 + Math.random() * 0.45, {
      velocity: new THREE.Vector3(velocity.x, velocity.y, velocity.z),
      gravity: GRAVITY,
      grow: smear ? 1.5 : 0.7,
      opacity: smear ? 0.55 : 0.9,
      spin: (Math.random() - 0.5) * 3
    });
  }

  // The red arc the blade leaves through the air right as it connects.
  slash(position, direction) {
    if (!this.ready()) return;
    const along = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    for (let i = 0; i < 3; i++) {
      this.sprite(this.textures.trail ? 'trail' : 'burst', position.clone().addScaledVector(along, i * 4), 12 + i * 4, 0.45 + i * 0.08, {
        grow: 1.5,
        velocity: along.clone().multiplyScalar(26 + i * 10),
        gravity: 60,
        opacity: 0.75,
        spin: (Math.random() - 0.5) * 1.5
      });
    }
  }

  // A head blowing apart: a tight column of blood thrown straight up from the neck, a red mist, and
  // a fountain that keeps pumping for a moment. `at` returns the neck position (it follows the body).
  headBurst(at, { power = 1 } = {}) {
    if (!this.ready()) return;
    const origin = typeof at === 'function' ? at() : at;
    const p = Math.min(3, Math.max(1, power));
    const up = key => this.textures[key] ? key : 'burst';
    this.sprite(up('cloud'), origin, 20 * p, 0.55, { grow: 2.2, velocity: new THREE.Vector3(0, 40, 0), opacity: 0.7, spin: 0.4 });
    this.sprite(up('splat'), origin, 16 * p, 0.35, { grow: 1.8, velocity: new THREE.Vector3(0, 30, 0), opacity: 0.95 });
    const column = Math.round(14 + 6 * p);
    for (let i = 0; i < column; i++) {
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 4, (Math.random() - 0.5) * 3);
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 22, 110 + Math.random() * 110 * p, (Math.random() - 0.5) * 22);
      this.sprite(Math.random() < 0.6 ? up('gush') : up('burstTall'), origin.clone().add(jitter), (4 + Math.random() * 4) * (0.8 + 0.3 * p), 0.7 + Math.random() * 0.5, {
        velocity, gravity: 300, grow: 1.5, opacity: 0.85, spin: (Math.random() - 0.5) * 2
      });
    }
    const drops = Math.round(26 + 12 * p);
    for (let i = 0; i < drops; i++) {
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 50, 90 + Math.random() * 150 * p, (Math.random() - 0.5) * 50);
      this.sprite('drops', origin.clone(), 1.2 + Math.random() * 2.2, 0.8 + Math.random() * 0.7, { velocity, gravity: GRAVITY, grow: 0.6, opacity: 0.95 });
    }
    this.fountains.push({ at, age: 0, life: 0.8 + 0.2 * p, rate: 55 * p, carry: 0 });
  }

  release(item) {
    item.sprite.removeFromParent();
    item.material.dispose();
    const index = this.items.indexOf(item);
    if (index >= 0) this.items.splice(index, 1);
  }

  update(dt) {
    for (let i = this.fountains.length - 1; i >= 0; i--) {
      const f = this.fountains[i];
      f.age += dt;
      if (f.age >= f.life) { this.fountains.splice(i, 1); continue; }
      // The heart pumps, so the spurt pulses and weakens.
      const pulse = 0.55 + 0.45 * Math.sin(f.age * 22);
      f.carry += f.rate * pulse * (1 - f.age / f.life) * dt;
      const origin = typeof f.at === 'function' ? f.at() : f.at;
      while (f.carry >= 1) {
        f.carry -= 1;
        const velocity = new THREE.Vector3((Math.random() - 0.5) * 18, 70 + Math.random() * 80, (Math.random() - 0.5) * 18);
        this.sprite(Math.random() < 0.5 ? 'drops' : (this.textures.gush ? 'gush' : 'burst'), origin.clone(), 2 + Math.random() * 3, 0.5 + Math.random() * 0.4, {
          velocity, gravity: 280, grow: 1.3, opacity: 0.85
        });
      }
    }
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      item.age += dt;
      const k = item.age / item.life;
      if (k >= 1) { item.sprite.removeFromParent(); item.material.dispose(); items.splice(i, 1); continue; }
      item.velocity.y -= item.gravity * dt;
      item.sprite.position.addScaledVector(item.velocity, dt);
      const s = item.size * (1 + (item.grow - 1) * Math.min(1, k * 1.5));
      item.sprite.scale.set(s, s / item.aspect, 1);
      item.material.rotation += item.spin * dt;
      item.material.opacity = item.opacity * (k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65);
    }
  }

  clear() {
    this.fountains.length = 0;
    for (const item of [...this.items]) this.release(item);
  }
}
