import * as THREE from 'three';

export const BENT_BARS = Object.freeze({
  vert01: 'p_zom_win_bars_01_vert01_bend_180',
  vert04: 'p_zom_win_bars_01_vert04_bend_180',
});

const cache = new Map();

export function bentBarsName(variant) {
  return BENT_BARS[variant] ?? null;
}

export async function loadBentBars(variant) {
  const name = bentBarsName(variant);
  if (!name) return null;
  if (!cache.has(name)) {
    cache.set(name, (async () => {
      const [{ GLTFLoader }, { assetManager }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('./runtime-assets.js')]);
      return new Promise(resolve => new GLTFLoader(assetManager).load(`models/${name}.glb`, gltf => resolve(gltf.scene), undefined, () => resolve(null)));
    })());
  }
  return cache.get(name);
}

export async function placeBentBars(scene, variant, { position, yaw = 0, flip = false } = {}) {
  const source = await loadBentBars(variant);
  if (!source) return null;
  const bars = source.clone(true);
  bars.position.copy(position ?? new THREE.Vector3());
  bars.rotation.y = yaw + (flip ? Math.PI : 0);
  bars.name = `bent_bars_${variant}`;
  scene.add(bars);
  return bars;
}
