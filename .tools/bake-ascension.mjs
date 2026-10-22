// The same serialized render-geometry BVH and controller format used by Kino.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const out = path.resolve(import.meta.dirname, '../export/web/assets/ascension');
const doc = JSON.parse(fs.readFileSync(path.join(out, 'ascension.gltf')));
const buffer = fs.readFileSync(path.join(out, 'ascension.bin'));
const data = JSON.parse(fs.readFileSync(path.join(out, 'map-data.json')));
const hiddenEntities = new Set(data.hiddenEntities);
const playable = new THREE.Box3();
for (const e of data.entities) {
  if (e.position && (e.classname === 'node_pathnode' || e.targetname === 'initial_spawn_points')) {
    playable.expandByPoint(new THREE.Vector3(...e.position));
  }
}
if (playable.isEmpty()) throw new Error('No source traversal bounds');
playable.expandByScalar(512);
const p = new THREE.Vector3(), matrix = new THREE.Matrix4();
const triBounds = new THREE.Box3(), positions = [], indices = [];
function accessor(i) {
  const a = doc.accessors[i], view = doc.bufferViews[a.bufferView];
  const Type = {5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array}[a.componentType];
  return new Type(buffer.buffer, buffer.byteOffset + (view.byteOffset || 0) + (a.byteOffset || 0),
    a.count * {VEC3: 3, VEC2: 2, SCALAR: 1}[a.type]);
}
for (const node of doc.nodes) {
  if (node.mesh === undefined || hiddenEntities.has(node.extras?.entityId)) continue;
  matrix.identity();
  if (node.matrix) matrix.fromArray(node.matrix);
  else matrix.compose(new THREE.Vector3(...(node.translation || [0, 0, 0])),
    new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1])), new THREE.Vector3(...(node.scale || [1, 1, 1])));
  const offset = data.entityOffsets[node.extras?.entityId];
  if (offset) {
    matrix.elements[12] += offset[0]; matrix.elements[13] += offset[1]; matrix.elements[14] += offset[2];
  }
  for (const prim of doc.meshes[node.mesh].primitives) {
    const material = doc.materials[prim.material];
    const name = material.extras?.sourceMaterialNames?.[0] || material.name;
    const base = name.startsWith('*') ? (name.match(/\(([^:)]+)/)?.[1] ?? name) : name.replace(/^[^:]+:(?=[mw]c\/)/, '');
    if (data.materialRules[base]?.hidden || /sky|shadowcaster|hdrportal|portal_nodraw|decal|foliage|ivy|fern|bamboo_leav|vine|lightshaft|water|blood|zombie_eye/i.test(base)) continue;
    const src = accessor(prim.attributes.POSITION), ix = accessor(prim.indices);
    const transformed = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) p.fromArray(src, i).applyMatrix4(matrix).toArray(transformed, i);
    const used = new Map();
    for (let i = 0; i < ix.length; i += 3) {
      const tri = [ix[i], ix[i + 1], ix[i + 2]];
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
  source: 'ascension.gltf; filtered render geometry, lander docked at source arrival position with open gates',
};
fs.writeFileSync(path.join(out, 'collision.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(out, 'collision.json'), JSON.stringify(report));
console.log('Ascension collision:', report.vertices, 'vertices,', report.triangles, 'triangles,', Math.round(offset / 1048576), 'MiB');
