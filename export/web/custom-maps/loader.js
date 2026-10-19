import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { unzip } from './zip.js';
import { loadBspWithProps, loadBspFromUrl } from './bsp.js';
import { loadIwmapText, loadIwmapFiles } from './iwmap.js';

const SKETCHFAB = 'https://api.sketchfab.com/v3';

function parse(loader, data, base = '') {
  return new Promise((resolve, reject) => loader.parse(data, base, gltf => resolve(gltf.scene), reject));
}

async function download(url, onProgress, fetchImpl, options) {
  const response = await fetchImpl(url, options);
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body?.getReader) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

const toBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

export async function loadFromArchive(files) {
  const names = [...files.keys()];
  const entry = names.find(n => /\.glb$/i.test(n)) ?? names.find(n => /(^|\/)scene\.gltf$/i.test(n)) ?? names.find(n => /\.gltf$/i.test(n));
  if (!entry) {
    if (names.some(n => /\.map$/i.test(n))) return loadIwmapFiles(files);
    throw new Error('The archive has no glTF, GLB or .map file in it.');
  }
  const directory = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : '';
  const blobs = new Map();
  for (const [name, bytes] of files) if (name !== entry) blobs.set(name, URL.createObjectURL(new Blob([bytes])));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    let key = url;
    try { key = decodeURIComponent(url); } catch { key = url; }
    return blobs.get(directory + key) ?? blobs.get(key) ?? url;
  });
  const loader = new GLTFLoader(manager);
  try {
    const bytes = files.get(entry);
    return /\.glb$/i.test(entry) ? await parse(loader, toBuffer(bytes)) : await parse(loader, new TextDecoder().decode(bytes));
  } finally {
    for (const url of blobs.values()) URL.revokeObjectURL(url);
  }
}

export async function loadFromFile(file) {
  if (/\.bsp$/i.test(file.name)) return (await loadBspWithProps(await file.arrayBuffer())).root;
  if (/\.map$/i.test(file.name)) return loadIwmapText(await file.text());
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.zip$/i.test(file.name)) return loadFromArchive(await unzip(bytes));
  if (/\.gltf$/i.test(file.name)) return parse(new GLTFLoader(), new TextDecoder().decode(bytes));
  return parse(new GLTFLoader(), toBuffer(bytes));
}

export function loadFromUrl(url, onProgress, include = null) {
  const manager = new THREE.LoadingManager();
  if (include) {
    manager.setURLModifier(requested => {
      let key = requested;
      try { key = decodeURIComponent(requested); } catch { key = requested; }
      const name = Object.keys(include).find(file => key === file || key.endsWith(`/${file}`));
      return name ? include[name] : requested;
    });
  }
  return new GLTFLoader(manager).loadAsync(url, event => onProgress?.(event.loaded, event.total)).then(gltf => gltf.scene);
}

export async function loadFromSketchfab({ uid, token }, onProgress, fetchImpl = globalThis.fetch.bind(globalThis)) {
  if (!token) throw new Error('Enter your Sketchfab API token in the Custom Maps menu to download models.');
  const response = await fetchImpl(`${SKETCHFAB}/models/${encodeURIComponent(uid)}/download`, { headers: { Authorization: `Token ${token}` } });
  if (response.status === 401 || response.status === 403) throw new Error('Sketchfab refused the download: check the API token, and that the model is downloadable.');
  if (!response.ok) throw new Error(`Sketchfab download request failed (${response.status}).`);
  const info = await response.json();
  const url = info.gltf?.url;
  if (!url) throw new Error('This Sketchfab model has no glTF download.');
  const archive = await download(url, onProgress, fetchImpl);
  return loadFromArchive(await unzip(archive));
}

export async function loadIwmapFromUrl(url, onProgress, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const bytes = await download(url, onProgress, fetchImpl);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return loadIwmapFiles(await unzip(bytes));
  return loadIwmapText(new TextDecoder().decode(bytes));
}

export function loadCustomModel(params, onProgress) {
  if (params?.source === 'file') return loadFromFile(params.file);
  if (params?.source === 'sketchfab') return loadFromSketchfab(params, onProgress);
  if (params?.source === 'bsp') return loadBspFromUrl(params.url, onProgress);
  if (params?.source === 'iwmap') return loadIwmapFromUrl(params.url, onProgress);
  if (params?.source === 'url') return loadFromUrl(params.url, onProgress, params.include);
  throw new Error('No model was selected.');
}
