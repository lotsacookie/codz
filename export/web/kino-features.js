import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadModel, loadAnimation, Rig } from './animation.js';
import { KinoEvents } from './kino-events.js';
import { disposeSkeletons } from './runtime-assets.js';

const up=new THREE.Vector3(0,1,0),v=a=>new THREE.Vector3(...a);
export class KinoFeatures {
  constructor({scene,world,data,session,enemies,player,camera,audio,effect,damage,toast}){
    Object.assign(this,{scene,world,data,session,enemies,player,camera,audio,effect,damage,toast});
    this.models=new Map();this.projectiles=[];this.mines=[];this.turrets=[];this.events=new KinoEvents(data,()=>session.random());
  }
  async load(){
    const defs=[...Object.values(this.data.weapons).flatMap(d=>[d,d.upgrade,d.upgrade?.attachment]),...Object.values(this.data.equipment)];
    const urls=new Set(defs.filter(Boolean).flatMap(d=>[d.projectileModel,d.worldModel]).filter(Boolean));
    await Promise.all([...urls].map(async url=>this.models.set(url,await loadModel(url))));
    this.reelTemplate=await loadModel(this.data.reelModel);this.reelModels=new Map();
    if(this.data.animations.o_monkey_bomb)this.monkeyAnimation=await loadAnimation(this.data.animations.o_monkey_bomb);
    for(const e of this.data.entities.filter(e=>e.targetname?.startsWith('trigger_movie_reel_'))){
      const prop=this.data.entities.find(n=>n.targetname===e.target),old=this.world.entities.get(prop?.id);if(old)old.visible=false;
      const mesh=clone(this.reelTemplate);mesh.position.fromArray(prop?.position??e.position);this.scene.add(mesh);this.reelModels.set(e.id,mesh);
    }
    const screen=this.data.entities.find(e=>e.targetname==='struct_theater_screen');
    this.screenBody=this.world.entities.get(this.data.entities.find(e=>e.targetname==='movie_screen')?.id);
    this.screenStart=this.screenBody?.position.clone();
    const atlas=await new THREE.TextureLoader().loadAsync('textures/game/fxt_projector_screen.webp');
    atlas.colorSpace=THREE.SRGBColorSpace;atlas.repeat.set(.25,.25);this.filmAtlas=atlas;
    this.screen=new THREE.Mesh(new THREE.PlaneGeometry(470,260),new THREE.MeshBasicMaterial({map:atlas,transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false}));
    this.screen.position.fromArray(screen.position);this.screen.position.z+=3;this.scene.add(this.screen);
    this.enemies.lureTarget=z=>this.lureTarget(z);this.reset();
  }
  model(url){const source=this.models.get(url);return source?clone(source):new THREE.Mesh(new THREE.SphereGeometry(2.5,8,6),new THREE.MeshBasicMaterial({color:0x85ff55}));}
  remove(item,list){item.mesh.removeFromParent();item.rig?.mixer.uncacheRoot(item.mesh);disposeSkeletons(item.mesh);if(item.fallback){item.mesh.geometry.dispose();item.mesh.material.dispose();}list.splice(list.indexOf(item),1);}
  shoot(def,direction){
    const mesh=this.model(def.projectileModel);mesh.position.copy(this.camera.position);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),direction);this.scene.add(mesh);
    this.projectiles.push({mesh,fallback:!this.models.has(def.projectileModel),def:{...def},velocity:direction.clone().multiplyScalar(def.projectileSpeed).addScaledVector(up,def.projectileSpeedUp??0),life:def.projectileLifetime||8,stuck:false,gravity:['grenade','bolt'].includes(def.projectileType)||def.id==='knife_ballistic_zm'?320:0});
  }
  placeClaymore(){
    if(this.events.room||this.session.busy||this.session.claymores<=0)return false;
    const forward=this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize(),feet=this.player.getFeetPosition(),guess=feet.clone().addScaledVector(forward,35).addScaledVector(up,32);
    if(!this.world.lineClear(feet.clone().addScaledVector(up,30),guess)){this.toast('Not enough room to place a Claymore');return false;}
    const floor=this.world.raycast(new THREE.Ray(guess,up.clone().negate()),0,70);
    if(!floor||!this.session.useEquipment('claymores'))return false;
    const def=this.data.equipment.claymore_zm,mesh=this.model(def.projectileModel);mesh.position.copy(floor.position).addScaledVector(up,2);mesh.rotation.y=Math.atan2(-forward.z,forward.x);this.scene.add(mesh);
    this.mines.push({mesh,forward,def,armedAt:this.session.time+.8,detonateAt:0});this.audio.play('buy');return true;
  }
  throwMonkey(){
    if(this.events.room||!this.session.useEquipment('monkeys'))return false;
    const def=this.data.equipment.zombie_cymbal_monkey,mesh=this.model(def.projectileModel);mesh.position.copy(this.camera.position);this.scene.add(mesh);
    let rig;if(this.monkeyAnimation){rig=new Rig(mesh);rig.add('cymbals',this.monkeyAnimation);}
    this.projectiles.push({mesh,def,rig,velocity:this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(480).addScaledVector(up,150),life:def.fuseTime,gravity:650,monkey:true,stuck:false});return true;
  }
  lureTarget(z){
    if(z.kind==='dog')return null;
    let nearest=null,distance=1536;
    for(const p of this.projectiles){if(!p.stuck||!(p.monkey||p.def.lure)||p.life<=0)continue;const d=z.root.position.distanceTo(p.mesh.position);if(d<distance){nearest=p.mesh.position;distance=d;}}
    return nearest;
  }
  blast(position,def,{playerDamage=true,score=true}={}){
    const radius=def.explosionRadius??200;
    this.effect(position,def.id==='ray_gun_zm'?0x8df565:0xffb347,25);this.audio.blast(def.id==='ray_gun_zm'?'raygun':def.projectileType==='rocket'?'rocket':'grenade',.6);
    for(const z of [...this.enemies.list]){const point=z.root.position.clone().addScaledVector(up,25),d=point.distanceTo(position);if(d<radius&&this.world.lineClear(position,point))this.enemies.hurt(z,THREE.MathUtils.lerp(def.explosionInnerDamage,def.explosionOuterDamage,d/radius),false,false,'explosion',score);}
    const feet=this.player.getFeetPosition().addScaledVector(up,30),distance=feet.distanceTo(position);
    if(playerDamage&&distance<radius&&this.world.lineClear(position,feet))this.damage(Math.min(180,def.explosionInnerDamage)*(1-distance/radius));
  }
  activateTurret(e){
    if(!this.session.power||this.session.busy||this.turrets.some(t=>t.id===e.id&&t.until>this.session.time))return false;
    const gun=this.data.entities.find(n=>n.targetname===e.target&&n.classname==='misc_turret');
    if(!gun||!this.session.spend(1500))return false;
    this.turrets=this.turrets.filter(t=>t.until>this.session.time);this.turrets.push({id:e.id,position:v(gun.position).addScaledVector(up,28),mesh:this.world.entities.get(gun.id),yaw:gun.yaw,until:this.session.time+30,fire:0});
    this.audio.play('buy');this.toast('Automatic turret active · 30 seconds');return true;
  }
  prompt(e){
    if(e.targetname==='claymore_purchase')return this.session.claymoresOwned?'Claymores equipped · 4 to place':'Claymores · 1000';
    if(e.script_noteworthy==='auto_turret_trigger')return !this.session.power?'The power must be activated':this.turrets.some(t=>t.id===e.id&&t.until>this.session.time)?'Automatic turret active':'Activate automatic turret · 1500';
    if(e.targetname?.startsWith('trigger_movie_reel_'))return this.events.available(e.id)?'Take film reel':null;
    if(e.targetname==='trigger_change_projector_reels')return this.events.carried?'Load film reel into projector':`Film reels · ${this.events.installed.size} / 3 projected`;
  }
  interact(e){
    if(e.targetname==='claymore_purchase'){const ok=this.session.buyClaymores();if(ok){this.audio.play('buy');this.toast('Claymores · press 4 to place');}return ok;}
    if(e.script_noteworthy==='auto_turret_trigger')return this.activateTurret(e);
    if(e.targetname?.startsWith('trigger_movie_reel_')){const ok=this.events.take(e.id);if(ok){this.toast('Film reel found. Bring it to the projection room.');this.audio.play('buy');}return ok;}
    if(e.targetname==='trigger_change_projector_reels'){const ok=this.events.install();if(ok){this.audio.play('buy');this.toast(`Film ${this.events.film} playing · ${this.events.installed.size} / 3 reels projected`,5);}return ok;}
    return false;
  }
  update(dt){
    const s=this.session;
    for(const p of [...this.projectiles]){
      p.life-=dt;
      if(p.stuck&&p.rig){p.rig.play('cymbals');p.rig.update(dt);}
      if(p.stuck&&p.target&&this.enemies.list.includes(p.target))p.mesh.position.copy(p.target.root.position).add(p.offset);
      if(!p.stuck){
        p.velocity.y-=p.gravity*dt;const travel=p.velocity.clone().multiplyScalar(dt),distance=travel.length(),direction=travel.clone().normalize(),ray=new THREE.Ray(p.mesh.position.clone(),direction);
        const wall=this.world.raycast(ray,0,distance+1),hit=p.monkey?null:this.enemies.rayHit(ray,Math.min(distance,wall?.distance??distance));
        if(wall||hit){
          p.mesh.position.copy(hit?.point??wall.position).addScaledVector(direction,-2);
          if(p.monkey){p.velocity.multiplyScalar(-.3);p.velocity.y=Math.abs(p.velocity.y)*.6;if(p.velocity.length()<50)p.stuck=true;}
          else if(p.def.projectileType==='bolt'||p.def.id==='knife_ballistic_zm'){
            p.stuck=true;p.life=p.def.id==='knife_ballistic_zm'?30:Math.max(.1,p.def.fuseTime||1.5);p.target=hit?.z;p.offset=hit?p.mesh.position.clone().sub(hit.z.root.position):null;
            if(hit)this.enemies.hurt(hit.z,p.def.damage,hit.head,false,'projectile');
          }else{
            if(hit)this.enemies.hurt(hit.z,p.def.damage,hit.head,false,'explosion');
            this.blast(p.mesh.position,p.def);this.remove(p,this.projectiles);continue;
          }
        }else p.mesh.position.add(travel);
      }
      if(p.stuck&&p.def.id==='knife_ballistic_zm'&&p.mesh.position.distanceTo(this.player.getFeetPosition().addScaledVector(up,30))<55){
        const w=s.inventory.find(w=>w.id===p.def.id&&!w.lost);if(w){const d=w.upgraded?this.data.weapons[w.id].upgrade:this.data.weapons[w.id];if(w.reserve<d.maxAmmo){w.reserve++;this.remove(p,this.projectiles);this.toast('Blade recovered');continue;}}
      }
      if(p.life<=0){if(p.def.explosionRadius)this.blast(p.mesh.position,p.def);this.remove(p,this.projectiles);}
    }
    for(const mine of [...this.mines]){
      if(mine.detonateAt&&s.time>=mine.detonateAt){this.blast(mine.mesh.position.clone().addScaledVector(up,15),mine.def);this.remove(mine,this.mines);continue;}
      if(s.time<mine.armedAt||mine.detonateAt)continue;
      for(const z of this.enemies.list){const d=z.root.position.clone().sub(mine.mesh.position),distance=d.length();if(distance<96&&d.dot(mine.forward)>20&&d.normalize().dot(mine.forward)>Math.cos(70*Math.PI/180)&&this.world.lineClear(mine.mesh.position.clone().addScaledVector(up,12),z.root.position.clone().addScaledVector(up,25))){mine.detonateAt=s.time+.4;this.audio.play('empty');break;}}
    }
    for(const turret of this.turrets){
      if(s.time>=turret.until){if(turret.mesh)turret.mesh.rotation.y=turret.yaw;continue;}
      turret.fire-=dt;if(turret.fire>0)continue;
      const z=this.enemies.list.filter(z=>z.root.position.distanceTo(turret.position)<1000&&this.world.lineClear(turret.position,z.root.position.clone().addScaledVector(up,35))).sort((a,b)=>a.root.position.distanceToSquared(turret.position)-b.root.position.distanceToSquared(turret.position))[0];
      if(z){const to=z.root.position.clone().addScaledVector(up,35);if(turret.mesh)turret.mesh.rotation.y=Math.atan2(-(to.z-turret.position.z),to.x-turret.position.x);turret.fire=.1;this.effect(turret.position,0xffdc88,2);this.audio.weapon('shot',this.data.weapons.hk21_zm);this.enemies.hurt(z,100,false,false,'turret',false);}
    }
    for(const [id,mesh]of this.reelModels)mesh.visible=this.events.reels.some(r=>r.entity.id===id&&!r.collected);
    if(s.power&&this.powerAt===null)this.powerAt=s.time;
    const lowered=this.powerAt===null?0:Math.min(1,(s.time-this.powerAt)/6);
    if(this.screenBody)this.screenBody.position.copy(this.screenStart).addScaledVector(up,-466*lowered);
    this.screen.visible=s.power&&lowered===1;const frame=(this.events.film?this.events.film-1:3)*4+Math.floor(s.time*2)%4;this.filmAtlas.offset.set(frame%4/4,1-(Math.floor(frame/4)+1)/4);this.screen.material.opacity=.65+Math.sin(s.time*47)*.07;
    this.syncPack();
  }
  syncPack(){
    const pack=this.session.pack;
    if(!pack){this.packMesh?.removeFromParent();disposeSkeletons(this.packMesh);this.packMesh=null;this.packId=null;return;}
    const ready=this.session.time>=pack.readyAt,id=pack.weapon.id+(ready?':ready':'');
    if(id!==this.packId){
      this.packMesh?.removeFromParent();disposeSkeletons(this.packMesh);const def=this.data.weapons[pack.weapon.id],url=ready?def.upgrade.worldModel:def.worldModel;
      this.packMesh=this.model(url);const machine=this.data.entities.find(e=>e.targetname==='zombie_vending_upgrade');
      this.packMesh.position.fromArray(machine.position);this.packMesh.position.y-=8;this.scene.add(this.packMesh);this.packId=id;
    }
    this.packMesh.visible=ready||pack.readyAt-this.session.time>3.5;
  }
  reset(){
    for(const list of [this.projectiles,this.mines])for(const p of [...list])this.remove(p,list);
    for(const t of this.turrets)if(t.mesh)t.mesh.rotation.y=t.yaw;this.turrets=[];this.events.reset();this.packMesh?.removeFromParent();disposeSkeletons(this.packMesh);this.packMesh=null;this.packId=null;
    if(this.screen)this.screen.visible=false;
    this.powerAt=null;if(this.screenBody)this.screenBody.position.copy(this.screenStart);
    for(const [id,mesh]of this.reelModels??[])mesh.visible=this.events.available(id);
  }
  snapshot(){return {projectiles:this.projectiles.map(p=>({id:p.def.id,position:p.mesh.position.toArray(),stuck:p.stuck,life:p.life,monkey:!!p.monkey,lure:!!p.def.lure})),mines:this.mines.map(m=>({position:m.mesh.position.toArray(),forward:m.forward.toArray(),detonateAt:m.detonateAt})),turrets:this.turrets.map(t=>({id:t.id,active:t.until>this.session.time,remaining:Math.max(0,t.until-this.session.time)})),events:this.events.snapshot(),packVisible:!!this.packMesh?.visible};}
}
