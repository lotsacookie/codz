import * as THREE from 'three';
import { parseBsp, staticModelIndexes, HIDDEN_TEXTURES, isWaterTexture } from './bsp-parse.js';

// Quake/GoldSrc units are about an inch, the same as the game, so BSP maps load at scale 1.
export const BSP_SCALE = 1;

function makeTexture(texture) {
  const { width, height, rgba } = texture;
  const pixels = rgba ?? new Uint8Array(width * height * 4).fill(128);
  const map = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

export function buildBspScene(parsed) {
  const { textures, texinfo, faces, models, vertices, entities } = parsed;
  const buckets = new Map();
  let triangles = 0;
  const modelIndexes = staticModelIndexes(entities, models.length);
  for (const modelIndex of modelIndexes) {
    const { firstFace, faceCount } = models[modelIndex];
    for (let f = firstFace; f < firstFace + faceCount && f < faces.length; f++) {
      const face = faces[f];
      const info = texinfo[face.texinfo];
      const texture = info && textures[info.texture];
      if (!texture || HIDDEN_TEXTURES.test(texture.name) || isWaterTexture(texture.name) || face.edges < 3) continue;
      const ids = parsed.faceVertices(face);
      if (!ids) continue;
      const points = ids.map(id => [vertices[id * 3], vertices[id * 3 + 1], vertices[id * 3 + 2]]);
      const light = parsed.faceLight(face, points);
      const shade = light ? light.map(v => Math.min(1, .35 + v * 1.3)) : [1, 1, 1];
      let bucket = buckets.get(info.texture);
      if (!bucket) buckets.set(info.texture, bucket = { position: [], uv: [], color: [] });
      const corner = ([x, y, z]) => {
        // Z-up Quake space to Y-up three.js space (a rotation, so winding is kept).
        bucket.position.push(x, z, -y);
        bucket.uv.push((x * info.s[0] + y * info.s[1] + z * info.s[2] + info.s[3]) / texture.width, (x * info.t[0] + y * info.t[1] + z * info.t[2] + info.t[3]) / texture.height);
        bucket.color.push(...shade);
      };
      for (let k = 1; k < points.length - 1; k++) {
        corner(points[0]); corner(points[k + 1]); corner(points[k]);
        triangles++;
      }
    }
  }
  const root = new THREE.Group();
  root.name = 'bsp_map';
  for (const [index, bucket] of buckets) {
    const texture = textures[index];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uv, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.color, 3));
    geometry.computeVertexNormals();
    const masked = texture.name.startsWith('{');
    const material = new THREE.MeshStandardMaterial({ map: makeTexture(texture), vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, alphaTest: masked ? .5 : 0 });
    material.name = texture.name;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `bsp_${texture.name}`;
    root.add(mesh);
  }
  if (!triangles) throw new Error('This BSP file has no drawable geometry.');
  return { root, triangles, textures: buckets.size, entities };
}

export const loadBspBuffer = buffer => buildBspScene(parseBsp(buffer));

export async function loadBspFromUrl(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download the map (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;
  let buffer;
  if (response.body?.getReader && total) {
    const reader = response.body.getReader();
    const bytes = new Uint8Array(total);
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes.set(value.subarray(0, Math.max(0, total - loaded)), loaded);
      loaded += value.length;
      onProgress?.(loaded, total);
    }
    buffer = bytes.buffer;
  } else buffer = await response.arrayBuffer();
  return loadBspBuffer(buffer).root;
}
