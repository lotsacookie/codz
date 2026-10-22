import * as THREE from 'three';

const GRAVITY = 520;
const LIFE = 7;
const FADE = 1.2;

const LIMB_TEXTURE = 'textures/~-glimbs_c.png';
const SKIN_RECT = { u0: 0.74, u1: 0.98, v0: 0.4, v1: 0.7 };
const STUMP_DISC = { u: 0.629, v: 0.893, r: 0.085 };
const SKIN_POINT = { u: 0.86, v: 0.55, r: 0.05 };

function limbGeometry() {
  const geometry = new THREE.CylinderGeometry(2.1, 1.7, 1, 8, 1);
  const uv = geometry.attributes.uv;
  const index = geometry.index;
  const mapped = new Uint8Array(uv.count);
  geometry.groups.forEach(group => {
    for (let i = group.start; i < group.start + group.count; i++) {
      const vertex = index.getX(i);
      if (mapped[vertex]) continue;
      mapped[vertex] = 1;
      const u = uv.getX(vertex), v = uv.getY(vertex);
      if (group.materialIndex === 0) {
        uv.setXY(vertex, SKIN_RECT.u0 + u * (SKIN_RECT.u1 - SKIN_RECT.u0), SKIN_RECT.v0 + v * (SKIN_RECT.v1 - SKIN_RECT.v0));
      } else {
        const disc = group.materialIndex === 1 ? STUMP_DISC : SKIN_POINT;
        uv.setXY(vertex, disc.u + (u - 0.5) * 2 * disc.r, disc.v + (v - 0.5) * 2 * disc.r);
      }
    }
  });
  uv.needsUpdate = true;
  return geometry;
}

function limbMaterial() {
  const material = new THREE.MeshLambertMaterial({ color: 0x6a2a24 });
  if (typeof document === 'undefined') return material;
  new THREE.TextureLoader().load(LIMB_TEXTURE, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    material.map = texture;
    material.color.setHex(0xb8aaa4);
    material.needsUpdate = true;
  }, undefined, () => {});
  return material;
}

export class LimbDebris {
  constructor(scene, { max = 6 } = {}) {
    this.scene = scene;
    this.max = max;
    this.group = new THREE.Group();
    this.group.name = 'limb-debris';
    scene.add(this.group);
    this.geometry = limbGeometry();
    this.material = limbMaterial();
    this.items = [];
    this.pool = [];
    this.cursor = 0;
  }

  spawn(position, velocity, length = 20, floorY = 0) {
    let item;
    if (this.items.length >= this.max) {
      this.cursor = (this.cursor + 1) % this.items.length;
      item = this.items[this.cursor];
    } else {
      item = this.pool.pop();
      if (!item) {
        item = { mesh: new THREE.Mesh(this.geometry, this.material), v: new THREE.Vector3(), spin: new THREE.Vector3(), age: 0, floor: 0, rest: false, length: 1 };
        item.mesh.frustumCulled = true;
        this.group.add(item.mesh);
      }
      this.items.push(item);
    }
    item.mesh.visible = true;
    item.mesh.position.set(position.x, position.y, position.z);
    item.mesh.scale.set(1, length, 1);
    item.mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    item.v.set(velocity.x, velocity.y, velocity.z);
    item.spin.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 16);
    item.age = 0;
    item.floor = floorY + 1.5;
    item.rest = false;
    item.length = length;
    return item;
  }

  update(dt) {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      item.age += dt;
      if (item.age >= LIFE) {
        item.mesh.visible = false;
        this.pool.push(item);
        items[i] = items[items.length - 1];
        items.pop();
        continue;
      }
      const mesh = item.mesh;
      if (!item.rest) {
        item.v.y -= GRAVITY * dt;
        mesh.position.addScaledVector(item.v, dt);
        mesh.rotation.x += item.spin.x * dt;
        mesh.rotation.y += item.spin.y * dt;
        mesh.rotation.z += item.spin.z * dt;
        if (mesh.position.y <= item.floor) {
          mesh.position.y = item.floor;
          if (Math.abs(item.v.y) < 40) {
            item.rest = true;
            mesh.rotation.x = Math.PI / 2;
          } else {
            item.v.y *= -0.3;
            item.v.x *= 0.6;
            item.v.z *= 0.6;
            item.spin.multiplyScalar(0.5);
          }
        }
      }
      const fade = item.age > LIFE - FADE ? Math.max(0.001, (LIFE - item.age) / FADE) : 1;
      if (fade < 1) mesh.scale.set(fade, item.length * fade, fade);
    }
  }

  clear() {
    for (const item of this.items) item.mesh.visible = false;
    this.pool.push(...this.items);
    this.items.length = 0;
  }

  dispose() {
    this.clear();
    this.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
