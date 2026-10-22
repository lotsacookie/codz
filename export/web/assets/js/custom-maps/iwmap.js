import * as THREE from 'three';
import { parseIwmap } from './iwmap-parse.js';
import { createMaterialLibrary, gdtMaterialsFromFiles, boxUv } from './iwmap-material.js';
import { flattenIwmap, createResolver, normalizeName } from './iwmap-flatten.js';
import { extractIwmapLayout, playArea, restrictLayout } from './iwmap-layout.js';

const toThree = ([x, y, z]) => [x, z, -y];

const faceNormal = points => {
  const [a, b, c] = points;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
};

export function buildIwmapGroup(polygons, { library = createMaterialLibrary() } = {}) {
  const buckets = new Map();
  let triangles = 0;
  for (const polygon of polygons) {
    const key = polygon.double ? `${polygon.material}\u0000double` : polygon.material;
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, bucket = { positions: [], uvs: [] });
    const normal = polygon.normal ?? faceNormal(polygon.points);
    const uv = polygon.points.map(p => boxUv(p, normal));
    const points = polygon.points.map(toThree);
    for (let k = 1; k < points.length - 1; k++) {
      bucket.positions.push(...points[0], ...points[k], ...points[k + 1]);
      bucket.uvs.push(...uv[0], ...uv[k], ...uv[k + 1]);
      triangles++;
    }
  }
  if (!triangles) throw new Error('This map has no drawable brush geometry.');
  const root = new THREE.Group();
  root.name = 'iwmap';
  for (const [key, bucket] of buckets) {
    const [name, double] = key.split('\u0000');
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, library.get(name, { double: Boolean(double) }));
    mesh.name = double ? `iwmap_${name}_curve` : `iwmap_${name}`;
    root.add(mesh);
  }
  return { root, triangles };
}

export function buildIwmapScene(map, { files = new Map() } = {}) {
  const flat = flattenIwmap(map, { resolve: createResolver(files) });
  let layout = extractIwmapLayout(flat.entities, flat.brushModels);
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
  const used = new Set(polygons.map(p => p.material));
  const library = createMaterialLibrary({ files, gdt: gdtMaterialsFromFiles(files, used) });
  const { root, triangles } = buildIwmapGroup(polygons, { library });
  layout = { ...layout, doors: layout.doors.map(({ polygons: parts, ...door }) => ({ ...door, object: buildIwmapGroup(parts.map(p => ({ ...p, material: door.debris ? 'zm_debris' : 'zm_door' })), { library }).root })) };
  root.userData.bspLayout = layout;
  root.userData.iwmap = { triangles, ...flat.stats, croppedTo: area && { min: area.min, max: area.max }, spawnRelocated: Boolean(area?.relocated), materials: library.imagesFound };
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
