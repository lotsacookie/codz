import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assets } from './asset-loader.js';
import { assetManager, configureKinoAssets, texturesSettled, textureReport, retryFailedTextures } from './runtime-assets.js';

let configured = false;

const megabytes = bytes => (bytes / 1048576).toFixed(0);
const relativeName = url => {
  try { return decodeURIComponent(new URL(url, document.baseURI).pathname.replace(/^\//, '')); } catch { return String(url); }
};

async function fetchExact(path, expected) {
  const url = assets.abs(path);
  for (let attempt = 0; ; attempt++) {
    const { bytes } = await assets.getBytes(url);
    if (bytes.byteLength === expected) return bytes;
    assets.files.delete(url);
    try { await (await assets.openCache())?.delete(url); } catch {}
    if (attempt >= 1) {
      throw new Error(`${path} is ${bytes.byteLength} bytes but the map expects ${expected}. The file is incomplete or damaged; run git lfs pull on the server or reload to download it again.`);
    }
  }
}

function parseGltf(text, base) {
  return new Promise((resolve, reject) => {
    new GLTFLoader(assetManager).parse(text, base, resolve, reject);
  });
}

export function resetMapAssets() { configured = false; }

export async function loadMapGltf(gltfPath, { label = 'map', onStatus = () => {}, pack = null } = {}) {
  if (!configured) {
    configureKinoAssets();
    configured = true;
  }
  assetManager.setURLModifier(assets.urlModifier);
  const report = () => {
    const snapshot = assets.snapshot();
    const textures = textureReport();
    const bytes = snapshot.total ? ` ${megabytes(snapshot.loaded)} / ${megabytes(snapshot.total)} MB` : '';
    onStatus(`Loading ${label}…${bytes}`);
  };
  const stopListening = assets.onProgress(report);
  const timer = setInterval(report, 500);
  const base = gltfPath.slice(0, gltfPath.lastIndexOf('/') + 1);
  const held = [];
  try {
    report();
    // One download for every texture of this map. If the pack is missing or damaged the loader falls back
    // to the individual files, so a bad pack can never stop the map. ?pack=0 skips it.
    if (pack && !/[?&]pack=0\b/.test(location.search)) await assets.loadPack(pack);
    const response = await assets.fetch(gltfPath);
    if (!response.ok) throw new Error(`${gltfPath} HTTP ${response.status}`);
    const text = await response.text();
    const definition = JSON.parse(text);
    for (const buffer of definition.buffers ?? []) {
      if (!buffer.uri || buffer.uri.startsWith('data:')) continue;
      const path = base + buffer.uri;
      const bytes = await fetchExact(path, buffer.byteLength);
      assets.blobUrls.set(assets.abs(path), URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })));
      held.push(path);
    }
    const gltf = await parseGltf(text, base);
    return gltf;
  } finally {
    clearInterval(timer);
    stopListening();
    for (const path of held) assets.release(path);
  }
}

export async function settleTextures({ rounds = 3, onStatus = () => {} } = {}) {
  await texturesSettled();
  let report = textureReport();
  for (let round = 0; report.failed && round < rounds; round++) {
    onStatus(`Retrying ${report.failed} texture${report.failed > 1 ? 's' : ''}…`);
    await new Promise(resolve => setTimeout(resolve, 600 * 2 ** round));
    report = await retryFailedTextures();
  }
  return report;
}

export function textureWarning(report) {
  if (!report?.failed) return '';
  const first = report.failedList[0];
  return `${report.failed} of ${report.total} textures could not be loaded and are shown as flat colour. First: ${relativeName(first.url)} (${first.error}).`;
}
