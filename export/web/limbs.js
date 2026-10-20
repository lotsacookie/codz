import * as THREE from 'three';

// Severed limbs flying through the air. A small pool of cheap tapered cylinders (one shared
// geometry and material, no skinned clones): they tumble, bounce once or twice, lie there, then shrink away.

const GRAVITY = 520;
const LIFE = 7;
const FADE = 1.2;

function limbGeometry() {
  // Unit-length tapered cylinder; the torn end (y>0) is red, the other end is dull skin and cloth.
  const geometry = new THREE.CylinderGeometry(2.1, 1.7, 1, 6, 1);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const flesh = new THREE.Color(0x8a1010), skin = new THREE.Color(0x77735c);
  for (let i = 0; i < position.count; i++) {
    const c = position.getY(i) > 0 ? flesh : skin;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export class LimbDebris {
  constructor(scene, { max = 6 } = {}) {
    this.scene = scene;
    this.max = max;
    this.group = new THREE.Group();
    this.group.name = 'limb-debris';
    scene.add(this.group);
    this.geometry = limbGeometry();
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.items = [];
    this.pool = [];
    this.cursor = 0;
  }

  // position/velocity: Vector3-likes. length: arm length in world units. floorY: height to land on.
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
