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
    sprite.scale.setScalar(size);
    sprite.renderOrder = 6;
    this.scene.add(sprite);
    const item = {
      sprite,
      material,
      age: 0,
      life,
      size,
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
    this.sprite('burst', position, (20 + Math.random() * 10) * scale, 0.32 + Math.random() * 0.1, {
      grow: 1.9,
      velocity: away.clone().multiplyScalar(30),
      spin: (Math.random() - 0.5) * 2
    });
    if (head || kill) {
      this.sprite(this.textures.gush ? 'gush' : 'burstTall', position, (30 + Math.random() * 12) * scale, 0.45, {
        grow: 1.5,
        velocity: away.clone().multiplyScalar(55).setY(25),
        gravity: 120,
        opacity: 0.85
      });
    }
    const drops = Math.round((kill ? 14 : head ? 11 : 7) * (0.8 + Math.random() * 0.4));
    for (let i = 0; i < drops; i++) {
      const velocity = away.clone().multiplyScalar(60 + Math.random() * 140);
      velocity.x += (Math.random() - 0.5) * 110;
      velocity.z += (Math.random() - 0.5) * 110;
      velocity.y += 20 + Math.random() * 110;
      this.sprite('drops', position, 3 + Math.random() * 5 * scale, 0.5 + Math.random() * 0.5, {
        velocity,
        gravity: GRAVITY,
        grow: 0.55,
        opacity: 0.9
      });
    }
    if (kill && this.textures.trail) {
      this.sprite('trail', position.clone().add(new THREE.Vector3(0, -6, 0)), 46, 0.8, {
        grow: 1.7,
        velocity: away.clone().multiplyScalar(18),
        gravity: 60,
        opacity: 0.7
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
    for (const item of [...this.items]) {
      item.age += dt;
      const k = item.age / item.life;
      if (k >= 1) { this.release(item); continue; }
      item.velocity.y -= item.gravity * dt;
      item.sprite.position.addScaledVector(item.velocity, dt);
      item.sprite.scale.setScalar(item.size * (1 + (item.grow - 1) * Math.min(1, k * 1.5)));
      item.material.rotation += item.spin * dt;
      item.material.opacity = item.opacity * (k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65);
    }
  }

  clear() {
    for (const item of [...this.items]) this.release(item);
  }
}
