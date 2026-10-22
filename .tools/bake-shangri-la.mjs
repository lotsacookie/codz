// The same serialized render-geometry BVH and controller format used by Kino.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { doorGroups, movingEntityIds } from '../export/web/assets/js/shangri-la-rules.js';

const out = path.resolve(import.meta.dirname, '../export/web/assets/shangri-la');
const doc = JSON.parse(fs.readFileSync(path.join(out, 'shangri-la.gltf')));
const buffer = fs.readFileSync(path.join(out, 'shangri-la.bin'));
const data = JSON.parse(fs.readFileSync(path.join(out, 'map-data.json')));
const playable = new THREE.Box3();
for (const e of data.entities) {
  if (e.position && (e.classname === 'node_pathnode' || e.targetname === 'initial_spawn_points')) {
    playable.expandByPoint(new THREE.Vector3(...e.position));
  }
}
if (playable.isEmpty()) throw new Error('No source traversal bounds');
playable.expandByScalar(512);
const moving = movingEntityIds(data.entities);
const clipPoints = doorGroups(data.entities).flatMap(g => g.clips.map(id => data.entities[id].position));
const CLIP_RADIUS = 90;
const NON_SOLID = /sky|shadowcaster|hdrportal|portal_nodraw|decal|lightshaft|blood|zombie_eye/i;
const THIN_FOLIAGE = /leaf|leaves|card|gobo|fern|ivy|vine|tallgrass|grass_leafy|grndcover|flowers|crop_|shrub|bush_dense|brush|plants|aerial|treewall|foliage_null/i;
const p = new THREE.Vector3(), matrix = new THREE.Matrix4();
let skippedNodes = 0, removedHelperComponents = 0, removedHelperTriangles = 0;
const triBounds = new THREE.Box3(), positions = [], indices = [];
function accessor(i) {
  const a = doc.accessors[i], view = doc.bufferViews[a.bufferView];
  const Type = {5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array}[a.componentType];
  return new Type(buffer.buffer, buffer.byteOffset + (view.byteOffset || 0) + (a.byteOffset || 0),
    a.count * {VEC3: 3, VEC2: 2, SCALAR: 1}[a.type]);
}
function helperComponentsToDrop(transformed, ix) {
  const welded = new Map(), ids = new Int32Array(transformed.length / 3);
  for (let i = 0; i < ids.length; i++) {
    const key = Math.round(transformed[i * 3] * 100) + ',' + Math.round(transformed[i * 3 + 1] * 100) + ',' + Math.round(transformed[i * 3 + 2] * 100);
    if (!welded.has(key)) welded.set(key, welded.size);
    ids[i] = welded.get(key);
  }
  const parent = Int32Array.from({ length: welded.size }, (_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < ix.length; i += 3) { const a = find(ids[ix[i]]); parent[find(ids[ix[i + 1]])] = a; parent[find(ids[ix[i + 2]])] = a; }
  const boxes = new Map();
  for (let i = 0; i < ix.length; i += 3) {
    const root = find(ids[ix[i]]);
    if (!boxes.has(root)) boxes.set(root, { box: new THREE.Box3(), triangles: 0 });
    const entry = boxes.get(root);
    for (let k = 0; k < 3; k++) entry.box.expandByPoint(p.fromArray(transformed, ix[i + k] * 3));
    entry.triangles++;
  }
  const drop = new Set(), point = new THREE.Vector3();
  for (const [root, entry] of boxes) {
    if (clipPoints.some(c => entry.box.distanceToPoint(point.fromArray(c)) < CLIP_RADIUS)) { drop.add(root); removedHelperComponents++; removedHelperTriangles += entry.triangles; }
  }
  return { drop, root: i => find(ids[i]) };
}
for (const node of doc.nodes) {
  if (node.mesh === undefined) continue;
  if (node.extras?.entityId !== undefined && moving.has(node.extras.entityId)) { skippedNodes++; continue; }
  matrix.identity();
  if (node.matrix) matrix.fromArray(node.matrix);
  else matrix.compose(new THREE.Vector3(...(node.translation || [0, 0, 0])),
    new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(node.scale || [1, 1, 1])));
  for (const prim of doc.meshes[node.mesh].primitives) {
    const material = doc.materials[prim.material];
    const name = material.extras?.sourceMaterialNames?.[0] || material.name;
    const base = name.startsWith('*') ? (name.match(/\(([^:)]+)/)?.[1] ?? name) : name.replace(/^[^:]+:(?=[mw]c\/)/, '');
    if (NON_SOLID.test(base) || THIN_FOLIAGE.test(base)) continue;
    const src = accessor(prim.attributes.POSITION), ix = accessor(prim.indices);
    const transformed = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) p.fromArray(src, i).applyMatrix4(matrix).toArray(transformed, i);
    const used = new Map();
    const helpers = node.extras?.collisionOnly ? helperComponentsToDrop(transformed, ix) : null;
    for (let i = 0; i < ix.length; i += 3) {
      const tri = [ix[i], ix[i + 1], ix[i + 2]];
      if (helpers && helpers.drop.has(helpers.root(tri[0]))) continue;
      triBounds.makeEmpty();
      for (const v of tri) triBounds.expandByPoint(p.fromArray(transformed, v * 3));
      if (!playable.intersectsBox(triBounds)) continue;
      for (const v of tri) {
        if (!used.has(v)) {
          used.set(v, positions.length / 3);
          positions.push(transformed[v * 3], transformed[v * 3 + 1], transformed[v * 3 + 2]);
        }
        indices.push(used.get(v));
      }
    }
  }
}
let geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
geometry = mergeVertices(geometry, .001);
const bvh = new MeshBVH(geometry, {strategy: SAH, targetLeafSize: 12, maxDepth: 40});
const serialized = MeshBVH.serialize(bvh, {cloneBuffers: false});
const chunks = [], layout = {}; let offset = 0;
function append(name, array) {
  const chunk = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  layout[name] = {byteOffset: offset, byteLength: chunk.length, type: array.constructor.name, count: array.length};
  chunks.push(chunk); offset += chunk.length;
}
append('position', geometry.attributes.position.array); append('index', serialized.index);
layout.roots = [];
for (const root of serialized.roots) {
  const chunk = Buffer.from(root);
  layout.roots.push({byteOffset: offset, byteLength: chunk.length}); chunks.push(chunk); offset += chunk.length;
}
const report = {
  format: 'hijacked-collision-bvh-v1', binary: 'collision.bin', byteLength: offset, layout,
  vertices: geometry.attributes.position.count, triangles: indices.length / 3,
  bounds: {min: playable.min.toArray(), max: playable.max.toArray()},
  source: 'shangri-la.gltf; filtered render geometry and static brush entities in source traversal bounds; door, debris and window-board parts are excluded and collide as separate runtime parts',
  excludedParts: skippedNodes, removedHelperComponents, removedHelperTriangles,
};
fs.writeFileSync(path.join(out, 'collision.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(out, 'collision.json'), JSON.stringify(report));
console.log('Excluded', skippedNodes, 'moving part nodes and', removedHelperComponents, 'door clip components (' + removedHelperTriangles + ' triangles)');
console.log('Shangri-La collision:', report.vertices, 'vertices,', report.triangles, 'triangles,', Math.round(offset / 1048576), 'MiB');
