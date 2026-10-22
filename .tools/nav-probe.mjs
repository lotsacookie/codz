import fs from 'node:fs';
import * as THREE from 'three';
import {deserializeCollisionWorld} from '../export/web/assets/js/collision-world.js';
import {init,exportNavMesh,NavMeshQuery} from '@recast-navigation/core';
import {generateSoloNavMesh} from '@recast-navigation/generators';
const meta=JSON.parse(fs.readFileSync('export/web/assets/collision.json')),bytes=fs.readFileSync('export/web/assets/collision.bin');
const world=deserializeCollisionWorld(meta,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
for(const [x,z]of [[0,1100],[-488,-1246],[1400,-400],[520,900]]){const ray=new THREE.Ray(new THREE.Vector3(x,480,z),new THREE.Vector3(0,-1,0));console.log('FLOOR',x,z,world.bvh.raycast(ray,THREE.DoubleSide,0,600).map(h=>({p:h.point.toArray(),normal:h.face.normal.toArray()})).slice(0,12));}
await init();const pts=world.geometry.attributes.position.array,idx=world.geometry.index.array.slice();for(let i=0;i<idx.length;i+=3)[idx[i],idx[i+2]]=[idx[i+2],idx[i]];
const config=JSON.parse(fs.readFileSync('export/web/assets/navigation.json')).config;
const result=generateSoloNavMesh(pts,idx,config);if(!result.success)throw new Error(result.error);fs.writeFileSync('artifacts/navigation-flipped.bin',exportNavMesh(result.navMesh));
const q=new NavMeshQuery(result.navMesh,{maxNodes:16384});q.defaultQueryHalfExtents={x:70,y:100,z:70};const a={x:-115,y:100,z:1254};
for(const [name,b]of Object.entries({lobby:{x:0,y:100,z:1100},upper:{x:582,y:340,z:641},stage:{x:-488,y:0,z:-1246},dining:{x:1300,y:0,z:-400},alley:{x:-1500,y:0,z:0}})){const r=q.computePath(a,b);console.log(name,'nearest',q.findClosestPoint(b),'path',r.path?.length,r.path?.at(-1));}
