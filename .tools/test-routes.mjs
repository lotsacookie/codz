import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerController } from '../export/web/assets/js/player-controller.js';
import { deserializeCollisionWorld } from '../export/web/assets/js/collision-world.js';
import { init, importNavMesh, NavMeshQuery } from '@recast-navigation/core';
const meta=JSON.parse(fs.readFileSync('export/web/assets/collision.json')),bytes=fs.readFileSync('export/web/assets/collision.bin');
const physics=deserializeCollisionWorld(meta,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
await init();const {navMesh}=importNavMesh(new Uint8Array(fs.readFileSync('export/web/assets/navigation.bin')));
const query=new NavMeshQuery(navMesh,{maxNodes:16384});query.defaultQueryHalfExtents={x:70,y:100,z:70};
const camera=new THREE.PerspectiveCamera();camera.rotation.order='YXZ';
const player=new PlayerController(camera,physics,{spawn:new THREE.Vector3(-115,100,1254),radius:14,height:70,eyeHeight:60,moveSpeed:190,gravity:800,jumpHeight:39,fallResetY:-300,maxSubSteps:12,groundSnapSpeed:10});
const results=[];
for(const [name,start,end]of [['lobby stairs',[-115,100,1254],[582,340,641]],['theater to stage',[-115,100,1254],[-488,0,-1246]],['upper hall to dining',[582,340,641],[1300,0,-400]],['lower hall to alley',[-580,100,641],[-1500,0,0]]]){
 player.setPosition(new THREE.Vector3(...start));for(let i=0;i<90;i++)player.update(1/60,{});
 const path=query.computePath(player.getFeetPosition(),new THREE.Vector3(...end)).path;
 let failure=null,steps=0;
 for(const waypoint of path.slice(1)){
  let reached=false;
  for(let i=0;i<600;i++){
   const feet=player.getFeetPosition();if(Math.hypot(feet.x-waypoint.x,feet.z-waypoint.z)<12){reached=true;break;}
   camera.lookAt(waypoint.x,camera.position.y,waypoint.z);player.update(1/60,{forward:1});steps++;
  }
  if(!reached){failure={waypoint,feet:player.getFeetPosition().toArray(),state:player.state};break;}
 }
 const result={name,passed:!failure,steps,failure,feet:player.getFeetPosition().toArray()};results.push(result);console.log(JSON.stringify(result));
}
fs.writeFileSync('artifacts/physical-routes.json',JSON.stringify(results,null,2));
assert(results.every(r=>r.passed),'Physical routes must be walkable without teleporting between waypoints');
