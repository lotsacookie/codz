import * as THREE from 'three';
import { parseIwmap } from './iwmap-parse.js';
import { flattenIwmap, createResolver, normalizeName } from './iwmap-flatten.js';
import { extractIwmapLayout, playArea, restrictLayout } from './iwmap-layout.js';

const toThree = ([x, y, z]) => [x, z, -y];

function materialColor(name) {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619) >>> 0;
  const lowered = name.toLowerCase();
  const hue = (hash % 360) / 360;
  const lightness = /floor|ground|dirt/.test(lowered) ? .3 : /ceil/.test(lowered) ? .42 : .5;
  return new THREE.Color().setHSL(hue, .22, lightness);
}

export function buildIwmapGroup(polygons) {
  const buckets = new Map();
  let triangles = 0;
  for (const polygon of polygons) {
    const key = polygon.double ? `${polygon.material}\u0000double` : polygon.material;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, bucket = []);
    const points = polygon.points.map(toThree);
    for (let k = 1; k < points.length - 1; k++) {
      bucket.push(...points[0], ...points[k], ...points[k + 1]);
      triangles++;
    }
  }
  if (!triangles) throw new Error('This map has no drawable brush geometry.');
  const root = new THREE.Group();
  root.name = 'iwmap';
  for (const [key, positions] of buckets) {
    const [name, double] = key.split('\u0000');
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: materialColor(name), roughness: 1, metalness: 0, side: double ? THREE.DoubleSide : THREE.FrontSide });
    material.name = name;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = double ? `iwmap_${name}_curve` : `iwmap_${name}`;
    root.add(mesh);
  }
  return { root, triangles };
}

export function buildIwmapScene(map, { files = new Map() } = {}) {
  const flat = flattenIwmap(map, { resolve: createResolver(files) });
  let layout = extractIwmapLayout(flat.entities);
  const area = playArea(layout);
  let polygons = flat.polygons;
  if (area) {
    const [x0, y0, z0] = area.min, [x1, y1, z1] = area.max;
    polygons = polygons.filter(polygon => {
      let lx = Infinity, hx = -Infinity, ly = Infinity, hy = -Infinity, lz = Infinity, hz = -Infinity;
      for (const [x, y, z] of polygon.points) {
        lx = Math.min(lx, x); hx = Math.max(hx, x);
        ly = Math.min(ly, z); hy = Math.max(hy, z);
        lz = Math.min(lz, -y); hz = Math.max(hz, -y);
      }
      return hx >= x0 && lx <= x1 && hy >= y0 && ly <= y1 && hz >= z0 && lz <= z1;
    });
    layout = restrictLayout(layout, area);
  }
  const { root, triangles } = buildIwmapGroup(polygons);
  root.userData.bspLayout = layout;
  root.userData.iwmap = { triangles, ...flat.stats, croppedTo: area && { min: area.min, max: area.max }, spawnRelocated: Boolean(area?.relocated) };
  return root;
}

export function loadIwmapText(text, files) {
  return buildIwmapScene(parseIwmap(text), { files });
}

export function pickMainMap(files) {
  const candidates = [...files].filter(([name]) => /\.map$/i.test(name) && !/(^|\/)_prefabs\//i.test(normalizeName(name)));
  if (!candidates.length) throw new Error('The archive has no .map file outside the _prefabs folder.');
  const preferred = candidates.filter(([name]) => /(^|\/)map_source\/(?!_prefabs)/i.test(normalizeName(name)));
  const pool = preferred.length ? preferred : candidates;
  return pool.reduce((best, entry) => (entry[1].length > best[1].length ? entry : best));
}

export function loadIwmapFiles(files) {
  const [, bytes] = pickMainMap(files);
  return loadIwmapText(new TextDecoder().decode(bytes), files);
}
