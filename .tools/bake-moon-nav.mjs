import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { init, exportNavMesh, NavMeshQuery } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';

const out = path.resolve(import.meta.dirname,'../export/web/assets/moon');
const data = JSON.parse(fs.readFileSync(path.join(out,'map-data.json')));
const meta = JSON.parse(fs.readFileSync(path.join(out,'collision.json')));
const binary = fs.readFileSync(path.join(out,'collision.bin'));
const array = (name,Type) => new Type(binary.buffer,binary.byteOffset+meta.layout[name].byteOffset,meta.layout[name].count);
const src = array('position',Float32Array), ix = array('index',Uint32Array);
await init();
const report = {};
for (const region of ['earth','moon']) {
  const volumes = data.entities.filter(e=>e.script_noteworthy==='player_volume' && (region==='earth')===(e.targetname==='nml_zone'));
  const boxes = volumes.map(e=>new THREE.Box3(new THREE.Vector3(...e.bounds[0]),new THREE.Vector3(...e.bounds[1])).expandByScalar(64));
  const point = new THREE.Vector3(), positions=[], indices=[], used=new Map();
  for(let i=0;i<ix.length;i+=3) {
    const tri=[ix[i],ix[i+1],ix[i+2]];
    if(!tri.some(v=>boxes.some(b=>b.containsPoint(point.fromArray(src,v*3)))))continue;
    for(const v of tri){if(!used.has(v)){used.set(v,positions.length/3);positions.push(src[v*3],src[v*3+1],src[v*3+2]);}indices.push(used.get(v));}
  }
  const config={cs:4,ch:2,walkableSlopeAngle:48,walkableHeight:35,walkableClimb:9,walkableRadius:4,maxEdgeLen:48,maxSimplificationError:1.3,minRegionArea:8,mergeRegionArea:20,maxVertsPerPoly:6,detailSampleDist:6,detailSampleMaxError:1};
  const result=generateSoloNavMesh(new Float32Array(positions),new Uint32Array(indices),config);
  if(!result.success)throw new Error(region+': '+result.error);
  fs.writeFileSync(path.join(out,`navigation-${region}.bin`),exportNavMesh(result.navMesh));
  const query=new NavMeshQuery(result.navMesh,{maxNodes:8192});query.defaultQueryHalfExtents={x:50,y:80,z:50};
  const candidates=[];
  for(const e of data.entities.filter(e=>e.classname==='node_pathnode')){
    const p=new THREE.Vector3(...e.position),zone=volumes.find(v=>new THREE.Box3(new THREE.Vector3(...v.bounds[0]),new THREE.Vector3(...v.bounds[1])).containsPoint(p.clone().add(new THREE.Vector3(0,20,0))));
    if(!zone)continue;
    const r=query.findClosestPoint({x:p.x,y:p.y,z:p.z});
    if(r.success&&Math.hypot(r.point.x-p.x,r.point.y-p.y,r.point.z-p.z)<70)candidates.push({entity:e.id,zone:zone.targetname,position:[r.point.x,r.point.y,r.point.z]});
  }
  const landmarks=Object.entries(data.landmarks).filter(([key])=>(key==='area51')===(region==='earth')).map(([key,l])=>{
    const [x,y,z]=data.entities[l.entity].position,r=query.findClosestPoint({x,y,z});
    if(!r.success)throw new Error('No navigation at '+key);
    return {key,point:r.point};
  });
  report[region]={config,triangles:indices.length/3,candidates,landmarks};
  console.log(region,indices.length/3,'triangles;',candidates.length,'spawn/path nodes');
  query.destroy();result.navMesh.destroy();
}
fs.writeFileSync(path.join(out,'navigation.json'),JSON.stringify(report));
