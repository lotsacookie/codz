import * as THREE from 'three';

export const GIB_MODELS = Object.freeze([
  'fx_char_gib_chunk_flesh01', 'fx_char_gib_chunk_flesh02', 'fx_char_gib_chunk_flesh03',
  'fx_char_gib_chunk_meat01', 'fx_char_gib_chunk_meat02', 'fx_char_gib_chunk_fat',
  'fx_char_gib_chunk_bone02', 'fx_char_gib_chunk_bone03',
]);

export const GIB_TUNING = Object.freeze({ count: 4, scale: [3, 5.5], speed: [40, 110], lift: [60, 140], gravity: 520, life: [1.4, 2.2], shrink: 0.4, cap: 48, bounce: 0.35 });

export function planGibs(random = Math.random, count = GIB_TUNING.count) {
  const gibs = [];
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const speed = GIB_TUNING.speed[0] + random() * (GIB_TUNING.speed[1] - GIB_TUNING.speed[0]);
    gibs.push({
      model: GIB_MODELS[Math.floor(random() * GIB_MODELS.length) % GIB_MODELS.length],
      scale: GIB_TUNING.scale[0] + random() * (GIB_TUNING.scale[1] - GIB_TUNING.scale[0]),
      velocity: new THREE.Vector3(Math.cos(angle) * speed, GIB_TUNING.lift[0] + random() * (GIB_TUNING.lift[1] - GIB_TUNING.lift[0]), Math.sin(angle) * speed),
      spin: new THREE.Vector3((random() - 0.5) * 14, (random() - 0.5) * 14, (random() - 0.5) * 14),
      life: GIB_TUNING.life[0] + random() * (GIB_TUNING.life[1] - GIB_TUNING.life[0]),
    });
  }
  return gibs;
}

export function stepGib(gib, dt, floor) {
  gib.velocity.y -= GIB_TUNING.gravity * dt;
  gib.position.addScaledVector(gib.velocity, dt);
  let landed = false;
  if (gib.position.y <= floor) {
    gib.position.y = floor;
    landed = true;
    if (Math.abs(gib.velocity.y) > 30) gib.velocity.y *= -GIB_TUNING.bounce;
    else gib.velocity.y = 0;
    gib.velocity.x *= 0.6;
    gib.velocity.z *= 0.6;
    gib.spin.multiplyScalar(0.6);
  }
  gib.age += dt;
  return landed;
}

export function gibScale(age, life, base) {
  const start = life * (1 - GIB_TUNING.shrink);
  if (age <= start) return base;
  return base * Math.max(0, 1 - (age - start) / (life - start));
}

export class GibFx {
  constructor(scene, { random = Math.random } = {}) {
    this.scene = scene;
    this.random = random;
    this.models = new Map();
    this.live = [];
    this.requested = false;
  }
  async #load() {
    if (this.requested || typeof document === 'undefined') return;
    this.requested = true;
    try {
      const [{ GLTFLoader }, { assetManager }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('./runtime-assets.js')]);
      const loader = new GLTFLoader(assetManager);
      await Promise.all(GIB_MODELS.map(name => new Promise(resolve => loader.load(`models/${name}.glb`, gltf => { this.models.set(name, gltf.scene); resolve(); }, undefined, () => resolve()))));
    } catch { this.requested = false; }
  }
  preload() { return this.#load(); }
  burst(position, { count = GIB_TUNING.count, floor = position.y - 30 } = {}) {
    this.#load();
    if (!this.models.size) return [];
    const planned = planGibs(this.random, count);
    for (const plan of planned) {
      if (this.live.length >= GIB_TUNING.cap) this.#remove(this.live[0]);
      const source = this.models.get(plan.model);
      if (!source) continue;
      const mesh = source.clone(true);
      mesh.traverse(child => { if (child.isMesh) child.material = child.material.clone(); });
      mesh.position.copy(position).add(new THREE.Vector3((this.random() - 0.5) * 8, this.random() * 10, (this.random() - 0.5) * 8));
      mesh.rotation.set(this.random() * 6.28, this.random() * 6.28, this.random() * 6.28);
      mesh.scale.setScalar(plan.scale);
      this.scene.add(mesh);
      this.live.push({ mesh, position: mesh.position, velocity: plan.velocity, spin: plan.spin, life: plan.life, base: plan.scale, age: 0, floor });
    }
    return planned;
  }
  #remove(gib) {
    this.scene.remove(gib.mesh);
    gib.mesh.traverse(child => { if (child.isMesh) child.material.dispose(); });
    const index = this.live.indexOf(gib);
    if (index >= 0) this.live.splice(index, 1);
  }
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const gib = this.live[i];
      stepGib(gib, dt, gib.floor);
      gib.mesh.rotation.x += gib.spin.x * dt;
      gib.mesh.rotation.y += gib.spin.y * dt;
      gib.mesh.rotation.z += gib.spin.z * dt;
      gib.mesh.scale.setScalar(Math.max(0.0001, gibScale(gib.age, gib.life, gib.base)));
      if (gib.age >= gib.life) this.#remove(gib);
    }
  }
  clear() {
    for (const gib of [...this.live]) this.#remove(gib);
  }
}
