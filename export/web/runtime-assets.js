import * as THREE from 'three';
import { assets } from './asset-loader.js';
import { createTextureQueue, placeholderColor, canUseImageBitmap } from './texture-queue.js';

export const assetManager = new THREE.LoadingManager();
export const runtimeProfile = { mobile: false, anisotropy: 1 };
const failedTextures = new Map();
const IMAGE_TYPES = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const mimeOf = url => IMAGE_TYPES[/\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase()] ?? 'image/png';

async function decodeImage(url) {
  const { bytes } = await assets.getBytes(url);
  const blob = new Blob([bytes], { type: mimeOf(url) });
  if (!runtimeProfile.mobile && canUseImageBitmap()) {
    const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const texture = new THREE.Texture(bitmap);
    texture.needsUpdate = true;
    return texture;
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const texture = new THREE.Texture(image);
    texture.needsUpdate = true;
    return texture;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function placeholder(url) {
  const texture = new THREE.DataTexture(new Uint8Array(placeholderColor(url)), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

const textureQueue = createTextureQueue({
  load: decodeImage,
  limit: () => (runtimeProfile.mobile ? 3 : 8),
  canRun: () => !(runtimeProfile.mobile && document.hidden),
});

function textureUrl(url) {
  const resolved = new URL(url, document.baseURI);
  // Resolve smaller images before decoding; shrinking a full-size image in
  // the browser would still incur Safari's original memory spike.
  if (runtimeProfile.mobile && resolved.origin === location.origin) resolved.pathname = resolved.pathname.replace('/textures/', '/textures-mobile/');
  return resolved.href;
}

export function configureKinoAssets() {
  runtimeProfile.mobile = matchMedia('(pointer: coarse)').matches || /iPhone|iPad|iPod/.test(navigator.userAgent)
    || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (runtimeProfile.mobile) document.addEventListener('visibilitychange', () => { if (!document.hidden) textureQueue.pump(); });
  assetManager.addHandler(/\.(?:png|webp|jpe?g)(?:\?.*)?$/i, {
    load(url, onLoad) {
      const key = textureUrl(url);
      textureQueue.request(key).then(texture => onLoad(texture.clone()), error => {
        if (!failedTextures.has(key)) console.warn(`Texture unavailable, using a placeholder: ${key} (${error.message})`);
        failedTextures.set(key, error.message);
        onLoad(placeholder(key));
      });
    },
  });
  return runtimeProfile;
}

export function assetDiagnostics() {
  const stats = textureQueue.stats();
  return {
    mobile: runtimeProfile.mobile,
    textureSources: stats.sources,
    loadingTextures: stats.loading,
    queuedTextures: stats.queued,
    failedTextures: failedTextures.size,
    failedTextureList: [...failedTextures.keys()].slice(0, 20),
  };
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
