import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerController } from '../export/web/assets/js/player-controller.js';
import { deserializeCollisionWorld } from '../export/web/assets/js/collision-world.js';
import { init, importNavMesh, NavMeshQuery } from '@recast-navigation/core';
const data=JSON.parse(fs.readFileSync('export/web/assets/game-data.json')),meta=JSON.parse(fs.readFileSync('export/web/assets/collision.json')),bytes=fs.readFileSync('export/web/assets/collision.bin');
const physics=deserializeCollisionWorld(meta,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
await init();const {navMesh}=importNavMesh(new Uint8Array(fs.readFileSync('export/web/assets/navigation.bin'))),query=new NavMeshQuery(navMesh,{maxNodes:8192});query.defaultQueryHalfExtents={x:100,y:100,z:100};
const camera=new THREE.PerspectiveCamera();camera.rotation.order='YXZ';
const player=new PlayerController(camera,physics,{radius:14,height:70,eyeHeight:60,moveSpeed:190,gravity:800,jumpHeight:39,fallResetY:-800,maxSubSteps:12,groundSnapSpeed:10});
const results=[];
for(const room of data.entities.filter(e=>/^ee_teleport_player[0-3]$/.test(e.targetname))){
  for(const reel of data.entities.filter(e=>e.targetname?.startsWith('trigger_movie_reel_')&&new THREE.Vector3(...e.position).distanceTo(new THREE.Vector3(...room.position))<550)){
    player.setPosition(new THREE.Vector3(...room.position));for(let i=0;i<60;i++)player.update(1/60,{});
    const grounded=player.state.grounded,target=new THREE.Vector3(...reel.position),path=query.computePath(player.getFeetPosition(),target).path??[];
    let elapsed=0;
    for(const waypoint of path.slice(1)){
      for(let i=0;i<300&&elapsed<5.8&&camera.position.distanceTo(target)>105;i++){
        const feet=player.getFeetPosition();if(Math.hypot(feet.x-waypoint.x,feet.z-waypoint.z)<12)break;
        camera.lookAt(waypoint.x,camera.position.y,waypoint.z);player.update(1/60,{forward:1});elapsed+=1/60;
      }
    }
    const distance=camera.position.distanceTo(target),result={room:room.targetname,reel:reel.id,grounded,elapsed,distance,passed:grounded&&distance<=105&&elapsed<5.8};results.push(result);console.log(JSON.stringify(result));
  }
}
fs.mkdirSync('artifacts/kino-completion',{recursive:true});fs.writeFileSync('artifacts/kino-completion/room-routes.json',JSON.stringify(results,null,2));assert.equal(results.length,12);assert(results.every(r=>r.passed),'All twelve reel placements must be reachable on foot within the return-room visit');
