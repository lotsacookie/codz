import * as THREE from 'three';

const TEXTURES = {
  burst: 'textures/fxt_bio_bloodburst_b.png',
  burstTall: 'textures/fxt_bio_bloodburst_c.png',
  gush: 'textures/fxt_bio_bloodgush.png',
  drops: 'textures/fxt_bio_blooddrops.png',
  trail: 'textures/fxt_bio_bloodtrail.png'
};

const MAX_SPRITES = 140;
const GRAVITY = 360;
// World units are Black Ops inches: a zombie is ~72 tall and its head ~10 across, and the
// game only plays a small neck/hit spurt. Sizes below are tuned to that, not to the
// source texture resolution.

export class BloodFx {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
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

  release(item) {
    item.sprite.removeFromParent();
    item.material.dispose();
    const index = this.items.indexOf(item);
    if (index >= 0) this.items.splice(index, 1);
  }

  update(dt) {
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
    for (const item of [...this.items]) this.release(item);
  }
}
