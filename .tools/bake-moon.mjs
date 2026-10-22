// Moon traversal collision. Uses the same serialized BVH as the Kino controller.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const out = path.resolve(import.meta.dirname, '../export/web/assets/moon');
const doc = JSON.parse(fs.readFileSync(path.join(out, 'moon.gltf')));
const buffer = fs.readFileSync(path.join(out, 'moon.bin'));
const data = JSON.parse(fs.readFileSync(path.join(out, 'map-data.json')));
const movable = new Set(data.doors.flatMap(d => d.parts));
const windowGroups=new Set(data.entities.filter(e=>e.targetname==='exterior_goal').map(e=>e.target));
for(const e of data.entities)if((windowGroups.has(e.targetname)&&(e.script_noteworthy==='clip'||e.script_parameters?.startsWith('barricade_')))||['digger_hangar_blocker','digger_teleporter_blocker'].includes(e.targetname))movable.add(e.id);
const regions = data.entities.filter(e => e.script_noteworthy === 'player_volume').map(e => new THREE.Box3(new THREE.Vector3(...e.bounds[0]), new THREE.Vector3(...e.bounds[1])).expandByScalar(256));
const positions = [], indices = [], p = new THREE.Vector3(), matrix = new THREE.Matrix4();
const emptyQuaternion = new THREE.Quaternion(), unitScale = new THREE.Vector3(1, 1, 1);
function accessor(i) {
  const a = doc.accessors[i], v = doc.bufferViews[a.bufferView];
  const type = {5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array}[a.componentType];
  return new type(buffer.buffer, buffer.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0), a.count * {VEC3: 3, VEC2: 2, SCALAR: 1}[a.type]);
}
let excluded = 0;
for (const node of doc.nodes) {
  if (node.mesh === undefined || movable.has(node.extras?.entityId)) continue;
  matrix.identity();
  if (node.matrix) matrix.fromArray(node.matrix);
  else matrix.compose(new THREE.Vector3(...(node.translation || [0, 0, 0])), node.rotation ? new THREE.Quaternion(...node.rotation) : emptyQuaternion, node.scale ? new THREE.Vector3(...node.scale) : unitScale);
  for (const prim of doc.meshes[node.mesh].primitives) {
    const name = doc.materials[prim.material]?.name || '';
    const base = name.startsWith('*') ? (name.match(/\(([^:)]+)/)?.[1] ?? name) : name.replace(/^[^:]+:(?=[mw]c\/)/, '');
    // Native shadow blockers seal airlocks for lighting only. Treating these
    // hidden faces as walls prevents traversal even after the doors slide away.
    if (/sky|shadowcaster|hdrportal|decal|foliage|ivy|wire|cable|distant|lightshaft|water|blood|paper|zombie_eye|earth/i.test(base)) continue;
    const src = accessor(prim.attributes.POSITION), ix = accessor(prim.indices);
    const verts = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) p.fromArray(src, i).applyMatrix4(matrix).toArray(verts, i);
    const used = new Map();
    for (let i = 0; i < ix.length; i += 3) {
      const tri = [ix[i], ix[i+1], ix[i+2]];
      if (!tri.some(v => regions.some(region => region.containsPoint(p.fromArray(verts, v*3))))) { excluded++; continue; }
      for (const v of tri) {
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
const pts = geometry.attributes.position.array;
const bvh = new MeshBVH(geometry, {strategy: SAH, targetLeafSize: 12, maxDepth: 40});
const serialized = MeshBVH.serialize(bvh, {cloneBuffers: false});
const chunks = [], layout = {}; let offset = 0;
function append(name, a) {
  const b = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  layout[name] = {byteOffset: offset, byteLength: b.length, type: a.constructor.name, count: a.length};
  chunks.push(b); offset += b.length;
}
append('position', pts); append('index', serialized.index); layout.roots = [];
for (const r of serialized.roots) { const b = Buffer.from(r); layout.roots.push({byteOffset: offset, byteLength: b.length}); chunks.push(b); offset += b.length; }
fs.writeFileSync(path.join(out, 'collision.bin'), Buffer.concat(chunks));
const report = {format: 'hijacked-collision-bvh-v1', binary: 'collision.bin', byteLength: offset, layout, vertices: pts.length/3, triangles: indices.length/3, excluded, source: 'moon.gltf; render geometry within source player volumes + 256 units; door groups handled at runtime'};
fs.writeFileSync(path.join(out, 'collision.json'), JSON.stringify(report));
console.log('Moon collision:', report.vertices, 'vertices,', report.triangles, 'triangles,', Math.round(offset/1048576), 'MiB');
