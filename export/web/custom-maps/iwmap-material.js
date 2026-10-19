import * as THREE from 'three';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { SOLID_CLIP } from './iwmap-brush.js';

// Radiant maps only name their materials. Where the map's source folder is available, the `.gdt` files give
// each material its colour map, tint and surface type; the images themselves are not in a map repo, so a
// texture is drawn only if the person supplied it (png, jpg, webp, tga) and otherwise a plain surface in the
// material's colour with a light pattern is used.

const BLOCK = /\n\t"([^"]+)" \( "material\.gdf" \)\n\t\{\n([\s\S]*?)\n\t\}/g;
const PAIR = /"([^"]+)" "([^"]*)"/g;
const KEEP = new Set(['colorMap', 'normalMap', 'colorTint', 'surfaceType', 'materialType', 'usage', 'glossRangeMax']);

export function parseGdtMaterials(text, wanted = null) {
  const out = new Map();
  BLOCK.lastIndex = 0;
  for (let match = BLOCK.exec(text); match; match = BLOCK.exec(text)) {
    const name = match[1];
    if (wanted && !wanted.has(name)) continue;
    const info = {};
    PAIR.lastIndex = 0;
    for (let pair = PAIR.exec(match[2]); pair; pair = PAIR.exec(match[2])) if (KEEP.has(pair[1]) && pair[2]) info[pair[1]] = pair[2];
    out.set(name, info);
  }
  return out;
}

export function gdtMaterialsFromFiles(files, wanted) {
  const out = new Map();
  for (const [name, content] of files ?? []) {
    if (!/\.gdt$/i.test(name)) continue;
    const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
    for (const [key, info] of parseGdtMaterials(text, wanted)) out.set(key, info);
  }
  return out;
}

const IMAGE = /\.(?:png|jpe?g|webp|tga)$/i;
export function imageIndex(files) {
  const index = new Map();
  for (const [name, bytes] of files ?? []) {
    if (!IMAGE.test(name) || typeof bytes === 'string') continue;
    const base = name.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
    if (!index.has(base)) index.set(base, { name, bytes });
  }
  return index;
}

export function describeMaterial(name, info = {}) {
  const lowered = name.toLowerCase();
  const surface = String(info.surfaceType ?? '').toLowerCase();
  const type = String(info.materialType ?? '').toLowerCase();
  const tint = String(info.colorTint ?? '1 1 1').trim().split(/\s+/).slice(0, 3).map(Number);
  const glossMax = Number(info.glossRangeMax) || 0;
  const kind = /glass/.test(surface) || /glass/.test(lowered) ? 'glass'
    : /emissive|backlit|_light\b|^light|lamp/.test(lowered) || /emissive/.test(type) ? 'light'
    : /metal|duct|steel|hatch|grate|vent/.test(`${surface} ${lowered}`) ? 'metal'
    : /tile|floor/.test(lowered) ? 'tile'
    : /cloth|fabric|carpet|paper/.test(surface) ? 'cloth'
    : 'plaster';
  return {
    kind,
    tint: tint.length === 3 && tint.every(Number.isFinite) ? tint : [1, 1, 1],
    transparent: /transparent/.test(type) || kind === 'glass',
    roughness: kind === 'metal' ? 0.45 : kind === 'glass' ? 0.1 : Math.min(1, Math.max(0.35, 1 - glossMax / 40)),
    metalness: kind === 'metal' ? 0.5 : 0,
    colorMap: info.colorMap && !/^\$|^(?:white|black)$/i.test(info.colorMap) ? info.colorMap : null,
  };
}

const BASE = {
  plaster: [0.62, 0.62, 0.6], tile: [0.5, 0.52, 0.52], metal: [0.5, 0.54, 0.58], cloth: [0.5, 0.45, 0.4], glass: [0.7, 0.85, 0.9], light: [1, 0.95, 0.85],
};
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function patternTexture(kind, seed) {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  let s = seed || 1;
  const rand = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0) / 4294967296);
  const speckle = (count, alpha) => {
    for (let i = 0; i < count; i++) {
      const v = 200 + Math.floor(rand() * 55) - (rand() < .5 ? 40 : 0);
      g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
      g.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 1 + Math.floor(rand() * 2), 1 + Math.floor(rand() * 2));
    }
  };
  if (kind === 'tile') {
    speckle(300, .25);
    g.strokeStyle = 'rgba(40,40,40,.55)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, size - 2, size - 2);
    g.beginPath(); g.moveTo(size / 2, 0); g.lineTo(size / 2, size); g.moveTo(0, size / 2); g.lineTo(size, size / 2); g.stroke();
  } else if (kind === 'metal') {
    for (let y = 0; y < size; y++) {
      const v = 215 + Math.floor(rand() * 40);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, y, size, 1);
    }
    g.strokeStyle = 'rgba(30,30,30,.5)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, size - 2, size - 2);
    for (const [x, y] of [[10, 10], [size - 10, 10], [10, size - 10], [size - 10, size - 10]]) { g.beginPath(); g.arc(x, y, 2.5, 0, 6.3); g.fillStyle = 'rgba(30,30,30,.6)'; g.fill(); }
  } else if (kind === 'cloth') {
    for (let i = 0; i < size; i += 3) { g.fillStyle = `rgba(0,0,0,${.05 + rand() * .06})`; g.fillRect(i, 0, 1, size); g.fillRect(0, i, size, 1); }
  } else {
    speckle(900, .22);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createMaterialLibrary({ files = null, gdt = null } = {}) {
  const images = imageIndex(files);
  const cache = new Map();
  const patterns = new Map();
  const loaded = new Map();
  const loadImage = (key, entry, material) => {
    if (!loaded.has(key)) {
      const tga = /\.tga$/i.test(entry.name);
      const url = URL.createObjectURL(new Blob([entry.bytes], { type: tga ? 'image/x-tga' : undefined }));
      loaded.set(key, (tga ? new TGALoader() : new THREE.TextureLoader()).loadAsync(url).then(texture => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        URL.revokeObjectURL(url);
        return texture;
      }).catch(() => { URL.revokeObjectURL(url); return null; }));
    }
    loaded.get(key).then(texture => {
      if (!texture) return;
      material.map = texture;
      material.color.setRGB(1, 1, 1);
      material.needsUpdate = true;
    });
  };
  return {
    imagesFound: images.size,
    get(name, { double = false } = {}) {
      const key = `${name}${double ? '\u0000d' : ''}`;
      if (cache.has(key)) return cache.get(key);
      const info = describeMaterial(name, gdt?.get(name));
      const lowered = name.toLowerCase();
      const solidClip = SOLID_CLIP.test(name);
      const base = (BASE[info.kind] ?? BASE.plaster).map((v, i) => v * info.tint[i]);
      const color = solidClip ? new THREE.Color(0x3d4046) : new THREE.Color(base[0], base[1], base[2]);
      const material = new THREE.MeshStandardMaterial({
        color, roughness: info.roughness, metalness: info.metalness, side: double || info.kind === 'glass' ? THREE.DoubleSide : THREE.FrontSide,
      });
      if (info.kind === 'light') { material.emissive = new THREE.Color(base[0], base[1], base[2]); material.emissiveIntensity = 0.85; }
      if (info.transparent) { material.transparent = true; material.opacity = 0.35; material.depthWrite = false; }
      material.name = name;
      if (!solidClip && lowered !== 'zm_door' && lowered !== 'zm_debris') {
        const image = info.colorMap && images.get(info.colorMap.toLowerCase());
        if (image) loadImage(info.colorMap.toLowerCase(), image, material);
        else if (info.kind !== 'glass' && info.kind !== 'light') {
          if (!patterns.has(info.kind)) patterns.set(info.kind, patternTexture(info.kind, hash(info.kind)));
          const texture = patterns.get(info.kind);
          if (texture) material.map = texture;
        }
      }
      if (lowered === 'zm_door') material.color.set(0x6b5133);
      if (lowered === 'zm_debris') material.color.set(0x57504a);
      cache.set(key, material);
      return material;
    },
  };
}

// Box projection: each face takes the two axes across its dominant normal axis, 128 map units per repeat.
export function boxUv(point, normal, unit = 128) {
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2]);
  if (az >= ax && az >= ay) return [point[0] / unit, point[1] / unit];
  if (ax >= ay) return [point[1] / unit, point[2] / unit];
  return [point[0] / unit, point[2] / unit];
}
