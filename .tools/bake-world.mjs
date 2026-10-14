import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { init, exportNavMesh, NavMeshQuery } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'export/web');
const doc = JSON.parse(fs.readFileSync(path.join(out,'kino.gltf')));
const buffer = fs.readFileSync(path.join(out,'kino.bin'));
const data = JSON.parse(fs.readFileSync(path.join(out,'game-data.json')));
function acc(i) {
  const a=doc.accessors[i], v=doc.bufferViews[a.bufferView];
  const types={5126:Float32Array,5125:Uint32Array,5123:Uint16Array};
  const size={VEC3:3,VEC2:2,SCALAR:1}[a.type];
  return new types[a.componentType](buffer.buffer,buffer.byteOffset+(v.byteOffset||0)+(a.byteOffset||0),a.count*size);
}
const positions=[], indices=[];
const p=new THREE.Vector3(), matrix=new THREE.Matrix4();
// The old main-theater crop discarded all four teleporter return rooms.
// Keep their actual render geometry for floors, walls and collectible access.
const bonusRooms=data.entities.filter(e=>/^ee_teleport_player[0-3]$/.test(e.targetname)).map(room=>{
  const center=new THREE.Vector3(...room.position),box=new THREE.Box3(center.clone(),center.clone());
  for(const reel of data.entities.filter(e=>e.targetname?.startsWith('trigger_movie_reel_'))){const point=new THREE.Vector3(...reel.position);if(point.distanceTo(center)<550)box.expandByPoint(point);}
  box.min.add(new THREE.Vector3(-160,-100,-160));box.max.add(new THREE.Vector3(160,250,160));return box;
});
const triangleBounds=new THREE.Box3();
let rejected=0;
for(const node of doc.nodes) {
  if(node.mesh===undefined || node.extras?.dynamicBrush) continue;
  matrix.identity();
  if(node.matrix) matrix.fromArray(node.matrix);
  else if(node.translation) matrix.makeTranslation(...node.translation);
  for(const prim of doc.meshes[node.mesh].primitives) {
    const name=doc.materials[prim.material]?.name||'';
    // T5 layered materials name both the structural base and its decals. A
    // blood decal in a compound floor material must not delete the floor.
    const base=name.startsWith('*')?(name.match(/\(([^:)]+)/)?.[1]??name):name.replace(/^[^:]+:(?=[mw]c\/)/,'');
    if(/sky|decal|glass|foliage|ivy|wire|cable|distant|lightshaft|water|blood|paper|zombie_eye/i.test(base)) continue;
    const src=acc(prim.attributes.POSITION), ix=acc(prim.indices);
    const verts=new Float32Array(src.length);
    for(let i=0;i<src.length;i+=3) { p.fromArray(src,i).applyMatrix4(matrix);p.toArray(verts,i); }
    const used=new Map();
    for(let i=0;i<ix.length;i+=3) {
      const tri=[ix[i],ix[i+1],ix[i+2]];
      if(tri.some(v=>verts[v*3]<-2250||verts[v*3]>2200||verts[v*3+1]<-100||verts[v*3+1]>520||verts[v*3+2]<-2150||verts[v*3+2]>2150)) {
        triangleBounds.makeEmpty();for(const v of tri)triangleBounds.expandByPoint(p.fromArray(verts,v*3));
        if(!bonusRooms.some(box=>box.intersectsBox(triangleBounds))){rejected++;continue;}
      }
      for(const v of tri) {
        if(!used.has(v)) {used.set(v,positions.length/3);positions.push(verts[v*3],verts[v*3+1],verts[v*3+2]);}
        indices.push(used.get(v));
      }
    }
  }
}
const geom=new THREE.BufferGeometry();
const pts=new Float32Array(positions), idx=new Uint32Array(indices);
geom.setAttribute('position',new THREE.BufferAttribute(pts,3));
geom.setIndex(new THREE.BufferAttribute(idx,1));
const bvh=new MeshBVH(geom,{strategy:SAH,targetLeafSize:12,maxDepth:40});
const serialized=MeshBVH.serialize(bvh,{cloneBuffers:false});
const chunks=[],layout={};let offset=0;
function append(name,a) {const b=Buffer.from(a.buffer,a.byteOffset,a.byteLength);layout[name]={byteOffset:offset,byteLength:b.length,type:a.constructor.name,count:a.length};chunks.push(b);offset+=b.length;}
append('position',pts);append('index',serialized.index);
layout.roots=[];
for(const r of serialized.roots) {const b=Buffer.from(r);layout.roots.push({byteOffset:offset,byteLength:b.length});chunks.push(b);offset+=b.length;}
fs.writeFileSync(path.join(out,'collision.bin'),Buffer.concat(chunks));
fs.writeFileSync(path.join(out,'collision.json'),JSON.stringify({format:'hijacked-collision-bvh-v1',binary:'collision.bin',coordinateSystem:'three-y-up',source:'kino.gltf static render geometry; dynamic brushes excluded',byteLength:offset,layout,vertices:pts.length/3,triangles:idx.length/3}));
console.log('Collision',pts.length/3,'vertices',idx.length/3,'triangles; excluded',rejected);
await init();
// The compositor converts T5 clockwise GfxWorld faces to glTF winding.
// Adding both windings would incorrectly rasterize ceilings as floors.
// CoD units are inches, and Recast height/climb are voxels.
const config={cs:4,ch:2,walkableSlopeAngle:48,walkableHeight:35,walkableClimb:9,walkableRadius:4,maxEdgeLen:48,maxSimplificationError:1.3,minRegionArea:8,mergeRegionArea:20,maxVertsPerPoly:6,detailSampleDist:6,detailSampleMaxError:1};
const result=generateSoloNavMesh(pts,new Uint32Array(indices),config);
if(!result.success) throw new Error('Navigation bake failed: '+result.error);
fs.writeFileSync(path.join(out,'navigation.bin'),exportNavMesh(result.navMesh));
const query=new NavMeshQuery(result.navMesh,{maxNodes:8192});
query.defaultQueryHalfExtents={x:80,y:100,z:80};
const samples=data.entities.filter(e=>e.classname==='node_pathnode').map(e=>{const [x,y,z]=e.position; const r=query.findClosestPoint({x,y,z});return r.success?Object.values(r.point):null;}).filter(Boolean);
const report={config,bytes:fs.statSync(path.join(out,'navigation.bin')).size,pathNodeSamples:samples.length,collisionTriangles:idx.length/3};
fs.writeFileSync(path.join(out,'navigation.json'),JSON.stringify(report,null,2));
console.log('Navigation',report);
// Pin the browser vendor modules to the same versions used for baking.
fs.mkdirSync(path.join(out,'vendor'),{recursive:true});
for(const [src,dst] of [
 ['three/build/three.module.js','three.module.js'],['three/build/three.core.js','three.core.js'],
 ['three-mesh-bvh/build/index.module.js','bvh.js'],
 ['@recast-navigation/core/dist/index.mjs','recast-core.mjs'],
 ['@recast-navigation/wasm/dist/recast-navigation.wasm-compat.js','recast-wasm.js'],
]) fs.copyFileSync(path.join(root,'node_modules',src),path.join(out,'vendor',dst));
for(const file of ['math/Capsule.js','math/Octree.js','loaders/GLTFLoader.js','utils/SkeletonUtils.js','utils/BufferGeometryUtils.js','controls/PointerLockControls.js','csm/CSM.js','csm/CSMFrustum.js','csm/CSMShader.js']) {
 const dest=path.join(out,'vendor/jsm',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,'node_modules/three/examples/jsm',file),dest);
}
fs.mkdirSync(path.join(out,'vendor/licenses'),{recursive:true});
for(const pkg of ['three','three-mesh-bvh','@recast-navigation/core','@recast-navigation/wasm','@recast-navigation/generators']){
 fs.copyFileSync(path.join(root,'node_modules',pkg,'LICENSE'),path.join(out,'vendor/licenses',pkg.replaceAll('/','-')+'.txt'));
}
