import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { init, importNavMesh, NavMeshQuery } from '@recast-navigation/core';
import { loadCollisionWorld, CollisionWorld } from './collision-world.js';
import { optimizeStaticScene } from './scene-optimizer.js';
import { loadModel } from './animation.js';
import { censorFlags } from './flag-censorship.js';
import { assetManager, runtimeProfile } from './runtime-assets.js';
import { assets } from './asset-loader.js';
import { applyAnisotropy } from './quality.js';

export const vector=a=>new THREE.Vector3().fromArray(a);
export const zoneNames={foyer_zone:'Lobby',foyer2_zone:'Lobby',vip_zone:'Upper hall',crematorium_zone:'Lower hall',alleyway_zone:'Alley',dining_zone:'Speed Cola room',dressing_zone:'Dressing room',stage_zone:'Stage',theater_zone:'Theater',west_balcony_zone:'Back room'};
function boxCollider(bounds){const box=new THREE.Box3(vector(bounds[0]),vector(bounds[1]));const size=box.getSize(new THREE.Vector3());if(size.x<.01||size.y<.01||size.z<.01)return null;const g=new THREE.BoxGeometry(size.x,size.y,size.z);g.translate(...box.getCenter(new THREE.Vector3()).toArray());return new CollisionWorld(g);}

export class World {
  constructor(scene,data){this.scene=scene;this.data=data;this.doors=new Map();this.entities=new Map();this.barriers=[];this.dynamic=[];this.markers=[];this.navDisabled=new Set();}
  async load(progress){
    progress('Loading the theater',15);
    // Every large download starts at once and goes through the resilient loader (byte progress,
    // retries, stall detection, LFS-pointer fallback, cache). Phones still parse one asset at a
    // time so peak memory is unchanged: the 91 MB collision download waits for the geometry.
    const early=p=>{p.catch(()=>{});return p;};   // a failure is reported where it is awaited
    const loadCollision=()=>early(loadCollisionWorld({metadataUrl:'collision.json'}));
    const geometry=early(assets.prefetchBlob('kino.bin'));
    const navigation=early(assets.buffer('navigation.bin'));
    const recast=early(init());
    let collisionLoad=runtimeProfile.mobile?null:loadCollision();
    await geometry;
    assetManager.setURLModifier(assets.urlModifier);
    const gltf=await new GLTFLoader(assetManager).loadAsync('kino.gltf');
    assets.release('kino.bin');
    applyAnisotropy(gltf.scene,runtimeProfile.anisotropy);
    collisionLoad??=loadCollision();
    const [collision,bytes]=await Promise.all([collisionLoad,navigation]);
    await recast;
    censorFlags(gltf.scene);
    this.collision=collision;this.scene.add(gltf.scene);
    const moving=[];
    gltf.scene.traverse(o=>{if(o.userData?.collisionOnly)o.visible=false;if(o.userData?.dynamicBrush){moving.push(o);this.entities.set(o.userData.entityId,o);}});
    for(const o of moving){this.scene.attach(o);if(o.userData.targetname==='theater_extracam_screen')o.visible=false;}
    this.optimization=optimizeStaticScene(gltf.scene,{cellSize:768});
    const nav=importNavMesh(new Uint8Array(bytes));this.nav=nav.navMesh;this.query=new NavMeshQuery(this.nav,{maxNodes:8192});this.query.defaultQueryHalfExtents={x:70,y:100,z:70};
    progress('Placing machines and barricades',65);
    const ents=this.data.entities;
    const triggers=ents.filter(e=>e.targetname==='zombie_door'&&e.classname==='trigger_use');
    for(const e of triggers){
      if(!this.doors.has(e.target))this.doors.set(e.target,{name:e.target,cost:+e.zombie_cost||750,flag:e.script_flag,electric:e.script_noteworthy==='electric_door',parts:[],triggers:[]});
      this.doors.get(e.target).triggers.push(e);
    }
    for(const e of ents){
      if(e.classname==='script_brushmodel'&&this.doors.has(e.targetname)&&e.bounds){
        const entry={entity:e,object:this.entities.get(e.id),collider:boxCollider(e.bounds),box:new THREE.Box3(vector(e.bounds[0]),vector(e.bounds[1])),enabled:true};
        this.doors.get(e.targetname).parts.push(entry);this.dynamic.push(entry);
      }
    }
    for(const e of ents.filter(e=>e.targetname==='exterior_goal')){
      const parts=ents.filter(n=>n.targetname===e.target),center=parts.find(n=>n.classname==='script_struct')?.position??e.position;
      const outside=vector(e.position),inside=vector(center),direction=inside.clone().sub(outside).setY(0).normalize();
      inside.addScaledVector(direction,48);const near=this.closest(inside);if(near)inside.copy(near);
      const spawners=ents.filter(n=>n.classname==='actor_zombie_ger_zombie');
      const spawner=spawners.sort((a,b)=>vector(a.position).distanceToSquared(outside)-vector(b.position).distanceToSquared(outside))[0];
      const boards=parts.filter(n=>n.script_parameters==='board').map(n=>this.entities.get(n.id)).filter(Boolean);
      const clip=parts.find(n=>n.script_noteworthy==='clip');
      if(clip?.bounds){const c={entity:clip,collider:boxCollider(clip.bounds),box:new THREE.Box3(vector(clip.bounds[0]),vector(clip.bounds[1])),enabled:true,window:true};this.dynamic.push(c);}
      this.barriers.push({id:e.id,position:vector(center),outside,inside,group:spawner?.targetname,boards,count:boards.length||6,repairTime:0,rewardRound:0,reward:0});
    }
    // Load each distinct model once; skeleton clones share GPU geometry/textures.
    await Promise.all(ents.filter(e=>['script_model','misc_turret'].includes(e.classname)&&this.data.models[e.model?.replace(/^,/, '')]).map(async e=>{
      const root=await loadModel(this.data.models[e.model.replace(/^,/, '')]);root.position.fromArray(e.position);root.rotation.y=e.yaw;root.name='prop_'+e.id;
      this.scene.add(root);this.entities.set(e.id,root);
    }));
    this.zones=ents.filter(e=>e.classname==='info_volume'&&e.script_noteworthy==='player_volume');
    this.interactions=ents.filter(e=>e.classname==='trigger_use'&&(e.targetname==='zombie_door'||e.targetname==='weapon_upgrade'||e.targetname==='zombie_vending'||e.targetname==='zombie_vending_upgrade'||e.targetname==='treasure_chest_use'||e.targetname==='use_elec_switch'||e.targetname==='trigger_teleport_pad_0'||e.targetname==='pf16_auto1'||e.targetname==='meteor_egg_trigger'||e.targetname==='bowie_upgrade'||e.targetname?.endsWith('_room_trap')));
    this.boxLocations=this.interactions.filter(e=>e.targetname==='treasure_chest_use');
    this.interactions.push(...ents.filter(e=>['trigger_use','trigger_use_touch'].includes(e.classname)&&(e.targetname==='claymore_purchase'||e.script_noteworthy==='auto_turret_trigger'||e.targetname?.startsWith('trigger_movie_reel_')||e.targetname==='trigger_change_projector_reels')));
    this.activeBox=this.boxLocations.find(e=>e.script_noteworthy==='start_chest')??this.boxLocations[0];
    this.boxBeam=new THREE.Mesh(new THREE.CylinderGeometry(8,28,1600,12,1,true),new THREE.MeshBasicMaterial({color:0x8cacdd,transparent:true,opacity:.1,side:THREE.DoubleSide,depthWrite:false}));
    this.scene.add(this.boxBeam);this.updateBox();
    // The static collision mesh is shared by player physics, weapon occlusion,
    // and AI perception. Authored dynamic door/window volumes are added here.
    this.physics={capsuleIntersect:c=>{
      const hit=this.collision.capsuleIntersect(c);if(hit)return hit;
      for(const d of this.dynamic)if(d.enabled&&d.collider){const h=d.collider.capsuleIntersect(c);if(h)return h;}
      for(const z of this.actors?.()??[]){
        if(z.state==='barricade'||z.state==='entering')continue;
        const p=z.root.position,feet=c.start.y-c.radius,top=c.end.y+c.radius;
        if(feet>p.y+(z.kind==='zombie'?65:32)||top<p.y+4)continue;
        const normal=new THREE.Vector3(c.start.x-p.x,0,c.start.z-p.z),distance=normal.length(),depth=c.radius+15-distance;
        if(depth>0)return {normal:distance>.001?normal.divideScalar(distance):new THREE.Vector3(1,0,0),depth};
      }
      return false;
    },rayIntersect:(r,n=0,f=Infinity)=>this.raycast(r,n,f,true)};
  }
  updateBox(){
    this.boxBeam.position.copy(vector(this.activeBox.position)).add(new THREE.Vector3(0,800,0));
    for(const location of this.boxLocations){const prefix=location.script_noteworthy,visible=!!this.fireSale||location.id===this.activeBox.id||this.openBoxes?.has(location.id);
      for(const e of this.data.entities.filter(e=>e.classname==='script_model'&&(e.targetname?.startsWith(prefix+'_')||e.script_noteworthy===prefix+'_rubble'))){const o=this.entities.get(e.id);if(o)o.visible=e.script_noteworthy===prefix+'_rubble'?!visible:visible;}
    }
  }
  closest(p,extents){const r=this.query.findClosestPoint({x:p.x,y:p.y,z:p.z},extents?{halfExtents:extents}:undefined);return r.success?new THREE.Vector3(r.point.x,r.point.y,r.point.z):null;}
  path(a,b){const r=this.query.computePath({x:a.x,y:a.y,z:a.z},{x:b.x,y:b.y,z:b.z});return r.success?r.path.map(p=>new THREE.Vector3(p.x,p.y,p.z)):[];}
  raycast(ray,near=0,far=Infinity,windows=false){let hit=this.collision.rayIntersect(ray,near,far);for(const d of this.dynamic){if(!d.enabled||!d.collider||(!windows&&d.window))continue;const h=d.collider.rayIntersect(ray,near,hit?Math.min(hit.distance,far):far);if(h)hit=h;}return hit;}
  lineClear(a,b){const v=b.clone().sub(a),dist=v.length();return !this.raycast(new THREE.Ray(a,v.normalize()),1,Math.max(1,dist-4));}
  setDoors(session){
    for(const [name,d] of this.doors){const open=session.openDoors.has(name)||(d.electric&&session.power);for(const p of d.parts){p.enabled=!open;if(p.object)p.object.visible=!open;}}
    for(const ref of this.navDisabled)this.nav.setPolyFlags(ref,1);this.navDisabled.clear();
    for(const d of this.dynamic){if(!d.enabled||d.window)continue;const c=d.box.getCenter(new THREE.Vector3()),h=d.box.getSize(new THREE.Vector3()).multiplyScalar(.5);h.x+=5;h.z+=5;const r=this.query.queryPolygons(c,h);for(const ref of r.polyRefs??[])this.navDisabled.add(ref);}
    for(const ref of this.navDisabled)this.nav.setPolyFlags(ref,0);
    // Stage curtains are script-driven and lift when the power is activated.
    for(const e of this.data.entities)if(/curtain/i.test(e.targetname??'')){const o=this.entities.get(e.id);if(o)o.visible=!session.power;}
  }
  activeZones(session){const active=new Set(['foyer_zone','foyer2_zone']);let changed=true;while(changed){changed=false;for(const [a,b,f]of this.data.zoneLinks)if(session.flags.has(f)&&(active.has(a)||active.has(b))){if(!active.has(a)||!active.has(b))changed=true;active.add(a);active.add(b);}}return active;}
  zoneAt(p){return this.zones.find(e=>e.bounds&&new THREE.Box3(vector(e.bounds[0]),vector(e.bounds[1])).containsPoint(p))?.targetname;}
  spawnBarriers(session){const zones=this.activeZones(session),groups=new Set(this.zones.filter(e=>zones.has(e.targetname)).map(e=>e.target));return this.barriers.filter(b=>groups.has(b.group));}
  setBoards(barrier,count){barrier.count=Math.max(0,Math.min(barrier.boards.length||6,count));barrier.boards.forEach((o,i)=>o.visible=i<barrier.count);}
  reset(session){for(const b of this.barriers){this.setBoards(b,b.boards.length||6);b.reward=0;b.rewardRound=0;}this.activeBox=this.boxLocations.find(e=>e.script_noteworthy==='start_chest')??this.boxLocations[0];this.updateBox();this.setDoors(session);}
}
