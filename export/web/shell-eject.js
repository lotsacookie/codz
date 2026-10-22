import * as THREE from 'three';
import { SHELLS } from './shell-kinds.js';
export { SHELLS, ENABLED, shellKindFor } from './shell-kinds.js';

// Shell casings use the reference fx_*_shell XModels (baked by .tools/bake-shells.mjs into shell-models.json).
// and their reference colour textures. Only the kinds listed in ENABLED eject a casing.
const MODELS_URL = new URL('./shell-models.json', import.meta.url);
const textureUrl = file => new URL(`./reference/images/${encodeURIComponent(file)}`, import.meta.url).href;

let modelsPromise = null;
const loadModels = () => (modelsPromise ??= fetch(MODELS_URL).then(r => r.json()).catch(() => null));

function buildGeometry(model) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(model.pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(model.uv, 2));
  geometry.setIndex(model.idx);
  geometry.computeVertexNormals();
  return geometry;
}

export class ShellEjector {
  constructor(scene, limit = 24) {
    this.scene = scene; this.limit = limit; this.shells = []; this.assets = new Map();
  }

  asset(kind) {
    if (this.assets.has(kind)) return this.assets.get(kind);
    const spec = SHELLS[kind];
    const entry = { geometry: null, material: new THREE.MeshBasicMaterial({ color: spec.tint, side: THREE.DoubleSide }) };
    new THREE.TextureLoader().load(textureUrl(spec.texture), map => {
      map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
      entry.material.map = map; entry.material.color.set(0xffffff); entry.material.needsUpdate = true;
    }, undefined, () => {});
    loadModels().then(all => { if (all?.[spec.model]) entry.geometry = buildGeometry(all[spec.model]); });
    this.assets.set(kind, entry);
    return entry;
  }

  emit(ndc, camera, kind, hand = 'right') {
    const spec = SHELLS[kind]; if (!spec) return;
    const { geometry, material } = this.asset(kind);
    if (!geometry) return;
    camera.updateMatrixWorld();
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const side = hand === 'left' ? -1 : 1;
    const ray = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(spec.scale);
    mesh.position.copy(camera.position).addScaledVector(ray, 15).addScaledVector(right, side * 1.2).addScaledVector(up, -0.6);
    mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    mesh.renderOrder = 6;
    if (this.shells.length >= this.limit) this.remove(this.shells[0]);
    this.scene.add(mesh);
    const velocity = right.clone().multiplyScalar(side * spec.speed * (0.7 + Math.random() * 0.5))
      .addScaledVector(up, spec.speed * (0.35 + Math.random() * 0.35))
      .addScaledVector(forward, -6 + Math.random() * 14);
    this.shells.push({ mesh, velocity, age: 0, life: spec.life * (0.8 + Math.random() * 0.4),
      spin: new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30) });
  }

  update(dt) {
    for (const shell of [...this.shells]) {
      shell.age += dt;
      if (shell.age >= shell.life) { this.remove(shell); continue; }
      shell.velocity.y -= 380 * dt;
      shell.mesh.position.addScaledVector(shell.velocity, dt);
      shell.mesh.rotation.x += shell.spin.x * dt; shell.mesh.rotation.y += shell.spin.y * dt; shell.mesh.rotation.z += shell.spin.z * dt;
    }
  }

  remove(shell) {
    shell.mesh.removeFromParent();
    const index = this.shells.indexOf(shell); if (index >= 0) this.shells.splice(index, 1);
  }

  dispose() {
    for (const shell of [...this.shells]) this.remove(shell);
    for (const { geometry, material } of this.assets.values()) { geometry?.dispose(); material.map?.dispose(); material.dispose(); }
    this.assets.clear();
  }
}
