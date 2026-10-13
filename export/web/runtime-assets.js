import * as THREE from 'three';
import { assets } from './asset-loader.js';
import { createTextureQueue, createTextureRegistry, looksComplete, placeholderColor, canUseImageBitmap } from './texture-queue.js';

export const assetManager = new THREE.LoadingManager();
export const runtimeProfile = { mobile: false, anisotropy: 1 };
const registry = createTextureRegistry();
const placeholders = new Map();
const tracked = new Set();
const IMAGE_TYPES = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const mimeOf = url => IMAGE_TYPES[/\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase()] ?? 'image/png';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function decodeBytes(bytes, url) {
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

async function decodeImage(url) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { bytes } = await assets.getBytes(url, undefined, undefined, { stallMs: 60000, retries: 2 });
      if (!looksComplete(bytes, url)) throw new Error('image data is incomplete');
      return await decodeBytes(bytes, url);
    } catch (error) {
      last = error;
      if (error.status === 404 || error.status === 403 || error.name === 'LfsPointerError') break;
      await sleep(400 * 2 ** attempt);
    }
  }
  throw last;
}

function placeholder(url) {
  const [r, g, b, a] = placeholderColor(url);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  context.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
  context.fillRect(0, 0, 1, 1);
  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  texture.userData.placeholder = true;
  return texture;
}

function heal(target, real) {
  target.dispose();
  target.source.data = real.image;
  target.source.needsUpdate = true;
  target.needsUpdate = true;
  target.userData.placeholder = false;
}

const textureQueue = createTextureQueue({
  load: decodeImage,
  limit: () => (runtimeProfile.mobile ? 3 : 6),
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
      registry.begin(key);
      textureQueue.request(key).then(texture => {
        registry.ready(key);
        const copy = texture.clone();
        tracked.add(copy);
        onLoad(copy);
      }, error => {
        registry.fail(key, error);
        console.warn(`Texture unavailable, using a placeholder until it can be retried: ${key} (${error.message})`);
        const stand = placeholder(key);
        if (!placeholders.has(key)) placeholders.set(key, []);
        placeholders.get(key).push(stand);
        tracked.add(stand);
        onLoad(stand);
      });
    },
  });
  return runtimeProfile;
}

export const textureReport = () => registry.report();
export const texturesSettled = () => registry.settled();
export const loadedTextures = () => [...tracked];

export async function retryFailedTextures() {
  await Promise.all(registry.failedKeys().map(async key => {
    registry.begin(key);
    try {
      const real = await textureQueue.request(key);
      registry.ready(key);
      for (const stand of placeholders.get(key) ?? []) heal(stand, real);
      placeholders.delete(key);
    } catch (error) {
      registry.fail(key, error);
    }
  }));
  return registry.report();
}

export function assetDiagnostics() {
  const stats = textureQueue.stats();
  const report = registry.report();
  return {
    mobile: runtimeProfile.mobile,
    textureSources: stats.sources,
    loadingTextures: stats.loading,
    queuedTextures: stats.queued,
    texturesTotal: report.total,
    texturesLoaded: report.ready,
    texturesPending: report.pending,
    texturesReady: report.allReady,
    failedTextures: report.failed,
    failedTextureList: report.failedList.slice(0, 20).map(entry => entry.url),
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
