import * as THREE from 'three';
import { parseVector } from './bsp-parse.js';
import { parseMdl, skinToRgba, decodePcx, decodeTga } from './mdl.js';

export const DEFAULT_PROPS_BASE = new URL('../../maps/bsp/', import.meta.url).href;

const PROP_CLASSES = new Set(['misc_model', 'place_model', 'explosive_barrel']);
const QUAKE_TO_THREE = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const RAD = Math.PI / 180;

async function fetchBytes(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

export async function loadModelIndex(baseUrl, read = fetchBytes) {
  const bytes = await read(new URL('maps.json', baseUrl).href);
  if (!bytes) return new Map();
  try {
    const models = JSON.parse(new TextDecoder().decode(bytes)).models ?? {};
    return new Map(Object.entries(models));
  } catch {
    return new Map();
  }
}

export function propPlacement(entity) {
  const angles = entity.angles ? parseVector(entity.angles) : [0, Number.isFinite(Number(entity.angle)) && Number(entity.angle) >= 0 ? Number(entity.angle) : 0, 0];
  const scale = Number(entity.scale) > 0 ? Number(entity.scale) : 1;
  const [x, y, z] = parseVector(entity.origin);
  const matrix = new THREE.Matrix4().makeTranslation(x, y, z);
  matrix.multiply(new THREE.Matrix4().makeRotationZ(angles[1] * RAD));
  matrix.multiply(new THREE.Matrix4().makeRotationY(-angles[0] * RAD));
  matrix.multiply(new THREE.Matrix4().makeRotationX(angles[2] * RAD));
  matrix.multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  return new THREE.Matrix4().multiplyMatrices(QUAKE_TO_THREE, matrix);
}

function pickFrame(entity, count) {
  const wanted = [entity.frame, entity.first_frame].map(Number).find(value => Number.isFinite(value) && value >= 0) ?? 0;
  return Math.min(count - 1, Math.floor(wanted));
}

function pickSkin(entity, count) {
  const wanted = Number(entity.skin);
  return count ? Math.min(count - 1, Math.max(0, Number.isFinite(wanted) ? Math.floor(wanted) : 0)) : 0;
}

function makeTexture({ width, height, rgba }) {
  const map = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

function buildGeometry(model, frameIndex) {
  const { triangles, texcoords, skinWidth, skinHeight, frames } = model;
  const source = frames[frameIndex];
  const count = triangles.length / 4;
  const position = new Float32Array(count * 9);
  const uv = new Float32Array(count * 6);
  const order = [0, 2, 1];
  for (let i = 0; i < count; i++) {
    const front = triangles[i * 4] !== 0;
    for (let corner = 0; corner < 3; corner++) {
      const vertex = triangles[i * 4 + 1 + order[corner]];
      const st = texcoords[vertex];
      const s = st.s + (st.seam && !front ? skinWidth / 2 : 0);
      position.set([source[vertex * 3], source[vertex * 3 + 1], source[vertex * 3 + 2]], (i * 3 + corner) * 3);
      uv[(i * 3 + corner) * 2] = (s + .5) / skinWidth;
      uv[(i * 3 + corner) * 2 + 1] = (st.t + .5) / skinHeight;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}

export async function loadBspProps(entities, { baseUrl = DEFAULT_PROPS_BASE, index = null, read = fetchBytes } = {}) {
  const wanted = entities.filter(entity => PROP_CLASSES.has(entity.classname) && /\.mdl$/i.test(entity.model ?? '') && entity.origin);
  if (!wanted.length) return null;
  const models = index ?? await loadModelIndex(baseUrl, read);
  const placed = wanted.map(entity => ({ entity, entry: models.get(entity.model.trim().toLowerCase()) })).filter(item => item.entry);
  if (!placed.length) return null;

  const loaded = new Map();
  await Promise.all([...new Set(placed.map(item => item.entry.path))].map(async path => {
    const bytes = await read(new URL(path, baseUrl).href);
    if (!bytes) return;
    try {
      loaded.set(path, parseMdl(bytes));
    } catch (error) {
      console.warn('[bsp-props] could not read', path, error?.message ?? error);
    }
  }));

  const textures = new Map();
  const wantedSkins = new Map();
  for (const { entity, entry } of placed) {
    const model = loaded.get(entry.path);
    if (!model) continue;
    const skin = pickSkin(entity, model.skins.length);
    wantedSkins.set(`${entry.path}|${skin}`, { entry, model, skin });
  }
  await Promise.all([...wantedSkins].map(async ([key, { entry, model, skin }]) => {
    const directory = new URL(entry.path.replace(/[^/]*$/, ''), baseUrl).href;
    let image = null;
    const file = entry.skins?.[skin];
    if (file) {
      const bytes = await read(new URL(file, directory).href);
      if (bytes) {
        try {
          image = /\.tga$/i.test(file) ? decodeTga(bytes) : decodePcx(bytes);
        } catch (error) {
          console.warn('[bsp-props] could not read skin', file, error?.message ?? error);
        }
      }
    }
    if (!image && model.skins[skin]) image = { width: model.skinWidth, height: model.skinHeight, rgba: skinToRgba(model.skins[skin]), alpha: false };
    const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
    material.name = `prop_${entry.path.split('/').pop()}_${skin}`;
    if (image) {
      material.map = makeTexture(image);
      if (image.alpha) material.alphaTest = .5;
    } else material.color.set(0x808080);
    textures.set(key, material);
  }));

  const batches = new Map();
  for (const { entity, entry } of placed) {
    const model = loaded.get(entry.path);
    if (!model) continue;
    const skin = pickSkin(entity, model.skins.length);
    const frame = pickFrame(entity, model.frames.length);
    const key = `${entry.path}|${frame}|${skin}`;
    let batch = batches.get(key);
    if (!batch) batches.set(key, batch = { entry, model, frame, skin, matrices: [] });
    batch.matrices.push(propPlacement(entity));
  }

  const geometries = new Map();
  const group = new THREE.Group();
  group.name = 'bsp_props';
  group.userData.collisionOnly = false;
  group.userData.noCollision = true;
  let count = 0;
  for (const [, { entry, model, frame, skin, matrices }] of batches) {
    const geometryKey = `${entry.path}|${frame}`;
    let geometry = geometries.get(geometryKey);
    if (!geometry) geometries.set(geometryKey, geometry = buildGeometry(model, frame));
    const mesh = new THREE.InstancedMesh(geometry, textures.get(`${entry.path}|${skin}`), matrices.length);
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = `bsp_prop_${entry.path.split('/').pop()}`;
    mesh.computeBoundingSphere();
    group.add(mesh);
    count += matrices.length;
  }
  group.userData.propCount = count;
  return count ? group : null;
}

export async function attachBspProps(root, entities, options = {}) {
  try {
    const props = await loadBspProps(entities, options);
    if (props) root.userData.bspProps = props;
  } catch (error) {
    console.warn('[bsp-props] props unavailable', error?.message ?? error);
  }
  return root.userData.bspProps ?? null;
}
