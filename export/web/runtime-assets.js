import * as THREE from 'three';

export const assetManager = new THREE.LoadingManager();
export const runtimeProfile = { mobile: false, anisotropy: 1 };
const textures = new Map();
const textureLoader = new THREE.TextureLoader();
let running = 0;
const queue = [];

function pump() {
  if (document.hidden) return;
  while (running < 3 && queue.length) {
    const { url, resolve, reject } = queue.shift();
    running++;
    textureLoader.loadAsync(url).then(resolve, reject).finally(() => { running--; pump(); });
  }
}

export function configureKinoAssets() {
  runtimeProfile.mobile = matchMedia('(pointer: coarse)').matches || /iPhone|iPad|iPod/.test(navigator.userAgent)
    || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (runtimeProfile.mobile) {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pump(); });
    // Resolve smaller images before decoding; shrinking a full-size image in
    // the browser would still incur Safari's original memory spike.
    assetManager.addHandler(/\.(?:png|webp|jpe?g)(?:\?.*)?$/i, {
      load(url, onLoad, onProgress, onError) {
        const resolved = new URL(url, document.baseURI);
        if (resolved.origin === location.origin) resolved.pathname = resolved.pathname.replace('/textures/', '/textures-mobile/');
        const key = resolved.href;
        if (!textures.has(key)) {
          const pending = new Promise((resolve, reject) => { queue.push({ url: key, resolve, reject }); pump(); });
          textures.set(key, pending);
          pending.catch(() => textures.delete(key));
        }
        textures.get(key).then(texture => onLoad(texture.clone()), onError);
      },
    });
  }
  return runtimeProfile;
}

export function assetDiagnostics() {
  return { mobile: runtimeProfile.mobile, textureSources: textures.size, loadingTextures: running, queuedTextures: queue.length };
}

// Shared geometry/materials belong to the model cache. A cloned skeleton's
// bone texture belongs only to that instance and must be released on removal.
export function disposeSkeletons(root) {
  const disposed = new Set();
  root?.traverse(object => {
    if (object.skeleton && !disposed.has(object.skeleton)) {
      disposed.add(object.skeleton);
      object.skeleton.dispose();
    }
  });
}
