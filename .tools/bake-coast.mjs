// Same glTF -> serialized BVH pipeline as Kino, with Coast's exploration pose.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const out = path.resolve(import.meta.dirname, '../export/web/assets/coast');
const doc = JSON.parse(fs.readFileSync(path.join(out, 'coast.gltf')));
const binary = fs.readFileSync(path.join(out, 'coast.bin'));
const data = JSON.parse(fs.readFileSync(path.join(out, 'map-data.json')));
const removed = new Set(data.removedDebris), doors = new Set(data.openDoors);
const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
const identity = new THREE.Quaternion();
const vec = a => new THREE.Vector3(...a);
function nodeMatrix(node) {
  return node.matrix ? matrix.fromArray(node.matrix) : matrix.compose(vec(node.translation || [0, 0, 0]),
    node.rotation ? new THREE.Quaternion(...node.rotation) : identity, vec(node.scale || [1, 1, 1]));
}
for (const node of doc.nodes) {
  const id = node.extras?.entityId;
  if (removed.has(id)) node.extras.explorationHidden = true;
  if (!doors.has(id) || node.extras?.explorationOpened) continue;
  const entity = data.entities[id];
  const m = nodeMatrix(node).clone();
  if (entity.script_string === 'rotate') {
    // _zombiemode_blockers.gsc uses RotateTo: these are absolute game angles.
    const [p, y, r] = entity.script_angles.split(' ').map(v => THREE.MathUtils.degToRad(Number(v)));
    const cy=Math.cos(y), sy=Math.sin(y), cp=Math.cos(p), sp=Math.sin(p), cr=Math.cos(r), sr=Math.sin(r);
    const axes = [[cy*cp, sy*cp, -sp], [cy*sp*sr-sy*cr, sy*sp*sr+cy*cr, cp*sr],
      [cy*sp*cr+sy*sr, sy*sp*cr-cy*sr, cp*cr]];
    const rotate = ([x,y,z]) => [x,z,-y];
    const cols = [rotate(axes[0]), rotate(axes[2]), rotate(axes[1]).map(v => -v)];
    const scale = Number(entity.modelscale || 1);
    m.fromArray([...cols.flatMap(col => [...col.map(v => v*scale), 0]), ...entity.position, 1]);
  } else if (entity.script_vector) {
    const [x, y, z] = entity.script_vector.split(' ').map(Number);
    m.premultiply(new THREE.Matrix4().makeTranslation(x, z, -y));
  } else {
    throw new Error(`Missing source opening transform for coast door ${id}`);
  }
  node.matrix = m.toArray();
  delete node.translation; delete node.rotation; delete node.scale;
  node.extras.explorationOpened = true;
}
// Use source material names, not the composer's truncated display names.
function materialBase(material) {
  const name = material?.extras?.sourceMaterialNames?.[0] || material?.name || '';
  return name.startsWith('*') ? (name.match(/\(([^:)]+)/)?.[1] ?? name) : name.replace(/^[^:]+:(?=[mw]c\/)/, '');
}
const regions = data.entities.filter(e => e.script_noteworthy === 'player_volume')
  .map(e => new THREE.Box3(vec(e.bounds[0]), vec(e.bounds[1])).expandByScalar(256));
const positions = [], indices = [], triangleBounds = new THREE.Box3();
function accessor(index) {
  const a = doc.accessors[index], v = doc.bufferViews[a.bufferView];
  const Type = {5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array}[a.componentType];
  return new Type(binary.buffer, binary.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0),
    a.count * {VEC3: 3, VEC2: 2, SCALAR: 1}[a.type]);
}
let excluded = 0;
for (const node of doc.nodes) {
  if (node.mesh === undefined || node.extras?.explorationHidden || node.extras?.collisionOnly) continue;
  nodeMatrix(node);
  for (const primitive of doc.meshes[node.mesh].primitives) {
    const base = materialBase(doc.materials[primitive.material]);
    // "black_sand2_underwater" is solid coastal terrain, not a water plane.
    if (/sky|shadowcaster|hdrportal|caulk|portal_nodraw|clip_player|decal|foliage|ivy|wire|cable|distant|lightshaft|blood|paper|zombie_eye/i.test(base)
      || /(?:^|\/)(?:zom_ocean_water_dynamic|water(?:_|$))/i.test(base)) continue;
    const src = accessor(primitive.attributes.POSITION), ix = accessor(primitive.indices);
    const verts = new Float32Array(src.length), used = new Map();
    for (let i = 0; i < src.length; i += 3) point.fromArray(src, i).applyMatrix4(matrix).toArray(verts, i);
    for (let i = 0; i < ix.length; i += 3) {
      triangleBounds.makeEmpty();
      for (let k = 0; k < 3; k++) triangleBounds.expandByPoint(point.fromArray(verts, ix[i+k]*3));
      if (!regions.some(region => region.intersectsBox(triangleBounds))) { excluded++; continue; }
      for (let k = 0; k < 3; k++) {
        const v = ix[i+k];
        if (!used.has(v)) { used.set(v, positions.length/3); positions.push(verts[v*3], verts[v*3+1], verts[v*3+2]); }
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
function append(name, a) {
  const chunk = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  layout[name] = {byteOffset: offset, byteLength: chunk.length, type: a.constructor.name, count: a.length};
  chunks.push(chunk); offset += chunk.length;
}
append('position', geometry.attributes.position.array); append('index', serialized.index);
layout.roots = [];
for (const root of serialized.roots) {
  const chunk = Buffer.from(root); layout.roots.push({byteOffset: offset, byteLength: chunk.length});
  chunks.push(chunk); offset += chunk.length;
}
const report = {format: 'hijacked-collision-bvh-v1', binary: 'collision.bin', coordinateSystem: 'three-y-up',
  byteLength: offset, layout, vertices: geometry.attributes.position.count, triangles: indices.length/3,
  excluded, source: 'coast.gltf render geometry in source player volumes + 256 units, open purchase doors, removed purchase debris'};
fs.writeFileSync(path.join(out, 'collision.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(out, 'collision.json'), JSON.stringify(report));
fs.writeFileSync(path.join(out, 'coast.gltf'), JSON.stringify(doc));
console.log(`Coast collision: ${report.vertices} vertices, ${report.triangles} triangles, ${(offset/1048576).toFixed(1)} MiB`);
