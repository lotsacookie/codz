export function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) object.skeleton.dispose();
    for (const material of [object.material].flat()) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    if (object.isInstancedMesh) object.dispose?.();
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    texture.image?.close?.();
    texture.dispose();
  }
  root.clear?.();
}

export function disposeRenderer(renderer) {
  if (!renderer) return;
  renderer.setAnimationLoop(null);
  const canvas = renderer.domElement;
  renderer.renderLists?.dispose();
  renderer.dispose();
  renderer.forceContextLoss?.();
  canvas.remove();
}

export function createListeners() {
  const entries = [];
  return {
    add(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      entries.push([target, type, handler, options]);
    },
    clear() {
      for (const [target, type, handler, options] of entries.splice(0)) target.removeEventListener(type, handler, options);
    },
  };
}
