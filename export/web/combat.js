import * as THREE from 'three';
import { ViewWeapon } from './animation.js';
import { MoonAudio } from './moon-audio.js';
import { Powerups } from './powerups.js';
import { MoonSession } from './moon-session.js';
import { MoonEnemies } from './moon-enemies.js';
import { PerkDrink } from './perk-drink.js';
import { loadModel } from './animation.js';
import { createOfferPrefetch, prefetchOtherSlots, warmEntry } from './viewmodel-cache.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { guardEnemies } from './enemy-guard.js';
import { BloodFx } from './blood.js';
import { ExplosionFx } from './explosion-fx.js';
import { KnifeBlood } from './knife-blood.js';
import { popHead, popLimb } from './gore.js';
import { LimbDebris } from './limbs.js';
import { WallImpacts, fadeParticle } from './impact-fx.js';

const pickupNames={full_ammo:'Max Ammo',double_points:'Double Points',insta_kill:'Insta-Kill',nuke:'Nuke',carpenter:'Carpenter',fire_sale:'Fire Sale'};

export class Combat {
  constructor(scene,camera,world,{notice,end,feet,teleport,sessionClass=MoonSession,enemiesClass=MoonEnemies,blood=false}) {
    Object.assign(this,{scene,camera,world,notice,end,feet,teleport,sessionClass,enemiesClass});
    // Kino's sprite blood (burst, gush, drops, trail). Opt-in per map; others keep the cube particles.
    this.blood=blood?new BloodFx(scene):null;this.knifeBlood=new KnifeBlood();this.explosions=new ExplosionFx(scene);this.limbDebris=new LimbDebris(scene);this.enabled=true;this.primary=false;this.pressed=false;this.ads=false;
    this.impacts=new WallImpacts(scene);
    this.audio=new MoonAudio();this.audio.camera=camera;
    // Common combat cues are reusable; Kino's looping theater ambience is not.
    this.audio.music={stop(){}};
    this.viewScene=new THREE.Scene();this.viewCamera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.01,200);
    this.viewScene.add(new THREE.AmbientLight(0xdce4ef,2.6));const light=new THREE.DirectionalLight(0xffefdb,2);light.position.set(0,4,2);this.viewScene.add(light);
    this.muzzle=new THREE.PointLight(0xffc276,0,200,1);scene.add(this.muzzle);
    this.particles=[];this.grenades=[];this.pendingMelee=null;this.lastReload=0;this.burst=0;this.hitUntil=0;this.lastShot=null;this.lastRound=0;
  }
  async load(){
    const response=await fetch('moon/combat-data.json');if(!response.ok)throw new Error('Missing Moon combat assets; rebuild Moon.');
    this.data=await response.json();this.session=new this.sessionClass(this.data);
    this.view=new ViewWeapon(this.viewScene,this.data,(name,def)=>this.audio.notify(name,def));
    this.enemies=new this.enemiesClass(this.scene,this.world,this.data,this.session,{damage:n=>this.damage(n),kill:z=>this.onKill(z),hit:(z,head)=>this.hit(z,head),sound:(kind,p)=>this.audio.play(kind,Math.max(0,1-p.distanceTo(this.camera.position)/1000)),voice:(z,gait,kind)=>this.audio.voice(gait,()=>z.root.position,kind),event:(type,z,cause)=>this.audio.zombieEvent(type,z.kind,z.root.position,1,cause)});
    guardEnemies(this.enemies,{onFault:(where,error)=>this.faultNotice?.(where,error)});
    this.pickups=new Powerups(this.scene,this.data,this.audio,(type,position,info)=>this.collect(type,info));
    this.perkDrink=new PerkDrink(this.viewScene,this.data,this.audio);this.equipmentModels={};
    await Promise.all([this.audio.load(),this.enemies.load(),this.pickups.load(),this.equip(),this.perkDrink.load(),
      ...Object.entries(this.data.equipment).map(async([id,d])=>this.equipmentModels[id]=await loadModel(d.worldModel))]);
  }
  async equip(lower=false){
    const suit=!!this.features?.state.suit;
    if(suit!==this.handSuit){this.view.currentId=null;this.handSuit=suit;}
    const adjust=d=>{if(suit)d.handsModel=this.data.props.viewmodel_zom_pressure_suit_arms;return d;};
    const def=adjust({...this.session.def});
    await this.view.equip(def,{lower});if(this.view.ready){this.audio.warmWeapon(this.session.def);
      for(const w of this.session.inventory){const d=this.data.weapons[w.id];if(d)this.audio.warmWeapon(d);}
      // Build the guns that are equipped but not in hand now, so switching to them later does not stall.
      prefetchOtherSlots(this.session,this.view,{adjust,onBuilt:entry=>this.renderer&&warmEntry(this.renderer,this.viewScene,this.viewCamera,entry)});}
  }
  prefetchWeapon(id){
    const suit=!!this.features?.state.suit;
    const adjust=d=>{if(suit)d.handsModel=this.data.props.viewmodel_zom_pressure_suit_arms;return d;};
    return createOfferPrefetch({weapons:this.data.weapons,view:this.view,adjust,onBuilt:entry=>this.renderer&&warmEntry(this.renderer,this.viewScene,this.viewCamera,entry),warmAudio:def=>this.audio.warmWeapon(def)})(id);
  }
  clearInput(){this.primary=false;this.pressed=false;this.secondary=false;this.secondaryPressed=false;this.ads=false;this.burst=0;}
  pause(){this.clearInput();this.audio.pause();}
  resume(){if(this.enabled){this.audio.start();this.audio.warmWeapon(this.session.def);}}
  enterArea(lunar){this.enemies.reset();this.pickups.reset();this.clearTransient();this.session.enterArea(lunar);this.session.spawned=this.session.killed;this.world.navigation.area=lunar?'moon':'earth';this.lastRound=0;}
  clearTransient(){
    this.perkDrink?.stop();
    this.pendingMelee=null;this.session.meleeLeft=0;this.clearInput();
    for(const list of [this.particles,this.grenades]){for(const p of [...list])this.removeEffect(list,p);}
    this.blood?.clear();this.explosions.clear();this.limbDebris.clear();
    this.impacts.clear();
  }
  async reset(){this.clearTransient();this.audio.reset();this.session.reset();this.enemies.reset();this.pickups.reset();this.view.currentId=null;this.view.clearCache();this.lastRound=0;this.lastPhase=undefined;this.lastLookYaw=undefined;this.lastLookPitch=undefined;this.lastReload=0;await this.equip();}
  damage(n){
    if(this.session.area==='earth'&&this.session.effects.pack_shield>this.session.time&&this.camera.position.distanceTo(new THREE.Vector3(...this.features.one('zombie_vending_upgrade').position))<220)return;
    if(!this.enabled||!this.session.damage(n))return;
    this.audio.play('hit');
    if(this.session.phase==='gameover'){this.pendingMelee=null;this.clearInput();this.end();}
  }
  key(code){
    if(!this.enabled)return;
    if(code==='KeyR')this.reload();if(code==='KeyV')this.melee();if(code==='KeyG')this.grenade();if(code==='KeyX')this.throwEquipment();
    if(code==='KeyB'&&this.session.toggleWave()){this.view.currentId=null;this.equip().catch(console.error);}
    if(['Digit1','Digit2','Digit3'].includes(code))this.switchWeapon(Number(code.at(-1))-1);
    if(code==='KeyM'){this.audio.enabled=!this.audio.enabled;this.notice(this.audio.enabled?'Sound on':'Sound off');}
  }
  switchWeapon(slot){
    if(!this.enabled)return;
    const previous=this.session.slot;this.session.switchWeapon(slot);
    if(previous===this.session.slot)return;
    this.pendingMelee=null;this.burst=0;this.equip(true).catch(console.error);
  }
  reload(){if(!this.view.ready)return;const empty=this.session.weapon.mag===0;if(this.session.reload()){this.burst=0;this.ads=false;this.lastReload=this.session.reloadSerial;this.view.reload(empty,this.session.reloadDuration,this.session.reloadStage);}}
  shot(hand='right'){
    const s=this.session;
    if(!this.view.ready||['raise','melee','sprintIn','sprint','sprintOut'].includes(this.view.mode))return false;
    if(s.reloadLeft&&s.def.segmentedReload&&s.weapon.mag){s.interruptReload();return false;}
    if(!s.fire()){if(s.weapon.mag===0&&this.pressed)this.audio.weapon('empty',s.def);return false;}
    s.adsShot=!!this.ads;this.view.shoot({ads:this.ads,empty:s.weapon.mag===0,hand});this.audio.weapon('shot',s.def);this.muzzle.position.copy(this.camera.position);this.muzzle.intensity=160;
    const forward=this.camera.getWorldDirection(new THREE.Vector3());
    this.features?.shot(new THREE.Ray(this.camera.position.clone(),forward),s.def.id.startsWith('microwavegun')?'wave':'bullet');
    if(s.def.id==='microwavegun_zm'){
      for(const z of [...this.enemies.list]){const delta=z.root.position.clone().add(new THREE.Vector3(0,35,0)).sub(this.camera.position),d=delta.length();
        if(d<(s.weapon.upgraded?1400:1000)&&delta.normalize().dot(forward)>.78&&this.world.lineClear(this.camera.position,this.enemies.headPosition(z)))this.enemies.hurt(z,z.health,false,false,'wave');}
      this.effect(this.camera.position.clone().addScaledVector(forward,110),0xccecff,20);return true;
    }
    if(s.def.explosionRadius>0){
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(3,8,6),new THREE.MeshBasicMaterial({color:s.def.id==='ray_gun_zm'?0x65ff73:0xffe699}));mesh.position.copy(this.camera.position);this.scene.add(mesh);
      this.grenades.push({mesh,velocity:forward.multiplyScalar(s.def.projectileSpeed||1600),life:4,rocket:true,radius:s.def.explosionRadius,damage:s.def.explosionInnerDamage||s.def.damage});return true;
    }
    for(let i=0;i<Math.max(1,s.def.pellets);i++){
      const direction=forward.clone(),spread=(s.def.pellets>1?.055:this.ads?0:.012)*(s.perks.has('specialty_deadshot')?.65:1);
      direction.add(new THREE.Vector3((Math.random()-.5)*spread,(Math.random()-.5)*spread,(Math.random()-.5)*spread)).normalize();
      const ray=new THREE.Ray(this.camera.position.clone(),direction),wall=this.world.raycast(ray,1,6000),hit=this.enemies.rayHit(ray,wall?.distance??6000);
      this.lastShot={target:hit?.z.id,head:hit?.head,wall:wall?.distance};
      if(hit)this.enemies.hurt(hit.z,s.def.id==='microwavegundw_zm'?hit.z.health:(hit.distance>s.def.range?s.def.minDamage:s.def.damage)*(hit.head?Math.max(1,s.def.headMultiplier):1),hit.head,false,s.def.id==='microwavegundw_zm'?'zap':'bullet');
      if(hit?.head&&this.blood&&!this.enemies.list.includes(hit.z))popHead({blood:this.blood,enemies:this.enemies,zombie:hit.z,def:s.def,distance:hit.distance});else if(hit?.limb&&this.blood)popLimb({blood:this.blood,enemies:this.enemies,debris:this.limbDebris,zombie:hit.z,limb:hit.limb,cut:hit.cut,def:s.def,distance:hit.distance,awayFrom:this.camera.position});
      else if(wall)this.impacts.strike(wall,ray,this.particles);
    }
    this.camera.rotation.x=Math.min(1.48,this.camera.rotation.x+(this.ads?.006:.012));return true;
  }
  meleeTarget(){
    const forward=this.camera.getWorldDirection(new THREE.Vector3());let best=null;
    for(const z of this.enemies.list){const delta=z.root.position.clone().add(new THREE.Vector3(0,44,0)).sub(this.camera.position);if(delta.length()<94&&delta.clone().normalize().dot(forward)>.4&&this.world.lineClear(this.camera.position,z.root.position.clone().add(new THREE.Vector3(0,44,0))))if(!best||delta.length()<best.distance)best={z,distance:delta.length()};}
    return best?.z;
  }
  bloodyKnife(){
    this.knifeBlood.soak();this.view.tintKnife(1);
    const tip=this.view.knifeTip(this.camera,this.viewCamera);if(!tip||!this.blood?.ready())return;
    this.blood.slash(tip,new THREE.Vector3(-1,-.25,0).applyQuaternion(this.camera.quaternion),this.camera);
  }
  melee(){
    const s=this.session;if(!this.view.ready||!s.canAct)return false;
    const strike=this.view.melee(s.bowie?'bowie':'knife',!!this.meleeTarget());if(!strike)return false;
    this.knifeBlood.reset();this.view.tintKnife(0);
    s.cancelReload();s.meleeLeft=strike.duration;this.burst=0;this.ads=false;this.pressed=false;
    this.pendingMelee={at:s.time+strike.delay,damage:strike.damage};this.audio.knife('swing',false);return true;
  }
  grenade(){
    if(!this.session.grenades||!this.session.canAct)return;
    this.session.grenades--;
    this.audio.grenadeThrow();
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(3.5,8,6),new THREE.MeshStandardMaterial({color:0x43563b,roughness:.8}));mesh.position.copy(this.camera.position);this.scene.add(mesh);
    this.grenades.push({mesh,velocity:this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(480).add(new THREE.Vector3(0,140,0)),life:3});
  }
  throwEquipment(){
    const s=this.session;if(!s.canAct||!s.equipment||s.equipmentAmmo<=0)return false;
    s.equipmentAmmo--;const mesh=clone(this.equipmentModels[s.equipment]);mesh.position.copy(this.camera.position);this.scene.add(mesh);
    this.grenades.push({mesh,velocity:this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(440).add(new THREE.Vector3(0,110,0)),life:2,equipment:s.equipment,shared:true});return true;
  }
  effect(position,color=0x9e3023,count=7){
    for(let i=0;i<count;i++){const mesh=new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5),new THREE.MeshBasicMaterial({color}));mesh.position.copy(position);this.scene.add(mesh);this.particles.push({mesh,life:.5,velocity:new THREE.Vector3((Math.random()-.5)*90,Math.random()*80,(Math.random()-.5)*90)});}
  }
  hit(z,head){this.hitUntil=this.session.time+.12;const p=head?this.enemies.headPosition(z):z.root.position.clone().add(new THREE.Vector3(0,z.kind==='zombie'?42:25,0));if(this.blood?.ready())this.blood.spray(p,this.camera.position,{head});else this.effect(p);}
  onKill(z){
    this.features?.onKill(z);
    if(z?.root&&this.blood?.ready())this.blood.spray(z.root.position.clone().add(new THREE.Vector3(0,z.kind==='zombie'?40:22,0)),this.camera.position,{kill:true});
    if(!z||this.nuking||this.session.area==='earth'||z.kind==='astronaut'||['wave','gersh'].includes(z.deathCause))return;
    const type=this.session.drops.tryDrop(this.session,{kind:z.kind,playable:true,destroyedWindows:this.features?.brokenWindows??0,boxMoves:this.features?.box?.moves??0});
    if(type&&this.data.powerups[type])this.pickups.spawn(type,z.root.position);
  }
  collect(type,info={}){
    const authority=info.host!==false;
    this.session.powerup(type);this.audio.play(type);this.notice(pickupNames[type]);
    if(type==='nuke'&&authority){this.nuking=true;this.enemies.nuke(z=>this.effect(z.root.position,0xe3e7b9));this.nuking=false;}
    if(type==='carpenter'&&authority)this.features?.repairAll();
  }
  buyWeapon(id){
    if(!this.session.buyWeapon(id)){this.notice(this.session.inventory.some(w=>w.id===id)?'Not enough points or ammunition already full.':'Not enough points.');return false;}
    this.equip().catch(console.error);this.audio.play('buy');this.notice(this.data.weapons[id].name);return true;
  }
  /** Attach a co-op client (see net/coop-client.js): it is updated every frame and tells zombies where teammates are. */
  attachCoop(coop){this.coop=coop;this.enemies.remoteTargets=coop?()=>coop.targets():null;if(!coop)return;coop.attachEnemies(this.enemies,{session:this.session,damage:n=>this.damage(n),teleport:p=>this.teleport?.(p),onGameOver:()=>{this.pendingMelee=null;this.clearInput();this.end();}});coop.attachAudio(this.audio,{weapons:this.data.weapons});coop.attachPowerups(this.pickups,{area:()=>this.session.area});this.enemies.onRemoteHit=(z,head)=>this.remoteHit(z,head);this.enemies.onPuppetKill=z=>this.puppetKill(z);}
  idle(dt){if(!this.enabled||!this.coop)return;this.coop.update(dt);this.coop.idle(dt);}
  remoteHit(z,head){const p=head?this.enemies.headPosition(z):z.root.position.clone().add(new THREE.Vector3(0,z.kind==='zombie'?42:25,0));if(this.blood?.ready())this.blood.spray(p,this.camera.position,{head});else this.effect(p);}
  puppetKill(z){
    if(z?.root&&z.deathCause==='nuke')this.effect(z.root.position,0xe3e7b9);
    if(z?.root&&this.blood?.ready())this.blood.spray(z.root.position.clone().add(new THREE.Vector3(0,z.kind==='zombie'?40:22,0)),this.camera.position,{kill:true});
  }
  update(dt,{moving,sprint}){
    this.blood?.update(dt);this.explosions.update(dt);this.limbDebris.update(dt);this.coop?.update(dt);
    if(!this.enabled||this.session.phase==='gameover')return;
    const s=this.session;s.update(dt);
    if(this.view.currentId!==s.def.id+(s.def.upgraded?':upgraded':'')||this.handSuit!==!!this.features?.state.suit)this.equip().catch(console.error);
    this.perkDrink.update(dt,s);this.view.pivot.visible=!s.pack&&!s.drinking&&s.phase!=='reviving';
    if(s.reloadLeft>0&&s.reloadSerial!==this.lastReload){this.lastReload=s.reloadSerial;this.view.reload(false,s.reloadDuration,s.reloadStage);}
    if(this.pendingMelee&&s.time>=this.pendingMelee.at){const strike=this.pendingMelee;this.pendingMelee=null;this.features?.shot(new THREE.Ray(this.camera.position.clone(),this.camera.getWorldDirection(new THREE.Vector3())),'melee',94);const z=this.meleeTarget();if(z){this.enemies.hurt(z,strike.damage,false,true,'melee');this.audio.knife('hit',false);this.bloodyKnife();}}
    if(this.knifeBlood.active){this.knifeBlood.update(dt,this.view.knifeTip(this.camera,this.viewCamera),(p,v,k)=>this.blood?.fling(p,v,k,this.camera));if(this.knifeBlood.active)this.view.tintKnife(this.knifeBlood.level);}
    const base=this.view.lookBase(this.camera);
    const lookYaw=this.lastLookYaw===undefined?0:Math.atan2(Math.sin(base.yaw-this.lastLookYaw),Math.cos(base.yaw-this.lastLookYaw)),lookPitch=this.lastLookPitch===undefined?0:base.pitch-this.lastLookPitch;this.lastLookYaw=base.yaw;this.lastLookPitch=base.pitch;
    this.view.update(dt,{moving,sprint,ads:this.ads,reloading:s.reloadLeft>0,empty:s.weapon.mag===0,time:s.time,look:{yaw:lookYaw,pitch:lookPitch},camera:this.camera,viewCamera:this.viewCamera,worldScene:this.scene});
    if(!sprint&&(this.pressed||this.primary&&s.def.automatic||this.burst>0)){if(this.shot()){if(this.burst>0)this.burst--;else if(s.def.fireType==='3-Round Burst')this.burst=2;}}
    this.pressed=false;
    if(!sprint&&s.def.dualWield&&(this.secondaryPressed||this.secondary&&s.def.automatic))this.shot('left');
    this.secondaryPressed=false;
    this.enemies.update(dt,this.feet());
    if(s.area==='moon'&&(s.corePhase??s.phase)==='fighting'&&s.round!==this.lastRound){this.lastRound=s.round;this.notice('Round '+s.round,4);this.audio.play('round');}
    {const core=s.corePhase??s.phase;if(core!==this.lastPhase){if(core==='preparing'&&s.round>1&&this.lastPhase==='fighting')this.audio.play('round_end');this.lastPhase=core;}}
    this.pickups.update(dt,this.feet(),!['gameover','reviving'].includes(s.phase)&&!this.features?.hack,(a,b)=>this.world.lineClear(a,b));
    for(const g of [...this.grenades]){
      g.life-=dt;if(!g.rocket)g.velocity.y-=(this.world.lowGravity(g.mesh.position)?136:650)*dt;
      const travel=g.velocity.clone().multiplyScalar(dt),hit=this.world.raycast(new THREE.Ray(g.mesh.position.clone(),travel.clone().normalize()),0,travel.length()+4);
      if(hit){const normal=hit.triangle.getNormal(new THREE.Vector3());if(normal.dot(g.velocity)>0)normal.negate();g.velocity.reflect(normal).multiplyScalar(.45);g.mesh.position.copy(hit.position).addScaledVector(normal,4);if(g.rocket)g.life=0;else if(!g.equipment)this.audio.grenadeBounce();}else g.mesh.position.add(travel);
      if(g.life<=0){
        if(g.equipment){this.features?.equipment(g.equipment,g.mesh.position.clone());this.removeEffect(this.grenades,g);continue;}
        this.audio.blast(g.rocket?'rocket':'grenade');if(!this.explosions.blast(g.mesh.position,{radius:g.radius||300,kind:g.rocket?'explosion':'grenade'}))this.effect(g.mesh.position,0xffb347,25);this.features?.blast(g.mesh.position,g.rocket?'explosion':'grenade');
        const radius=g.radius||300,damage=g.damage||1500;
        for(const z of [...this.enemies.list]){const d=z.root.position.distanceTo(g.mesh.position);if(d<radius&&this.world.lineClear(g.mesh.position,z.root.position.clone().add(new THREE.Vector3(0,30,0))))this.enemies.hurt(z,Math.max(75,damage*(1-d/radius)),false,false,g.rocket?'explosion':'grenade');}
        const d=this.camera.position.distanceTo(g.mesh.position);if(d<160&&!s.perks.has('specialty_flakjacket'))this.damage(180*(1-d/160));this.removeEffect(this.grenades,g);
      }
    }
    for(const p of [...this.particles]){p.life-=dt;p.velocity.y-=200*dt;p.mesh.position.addScaledVector(p.velocity,dt);fadeParticle(p);if(p.life<=0)this.removeEffect(this.particles,p);}
    this.muzzle.intensity=Math.max(0,this.muzzle.intensity-dt*2200);
    this.camera.fov=THREE.MathUtils.damp(this.camera.fov,this.ads&&!s.reloadLeft&&!s.meleeLeft?s.def.adsFov||56:78,12,dt);this.camera.updateProjectionMatrix();
  }
  removeEffect(list,item){item.mesh.removeFromParent();if(!item.shared){item.mesh.geometry.dispose();item.mesh.material.dispose();}list.splice(list.indexOf(item),1);}
  snapshot(){return {...this.session.snapshot(),area:this.session.area,earthTime:this.session.earthTime,enemies:this.enemies.snapshot(),view:this.view.snapshot(),spawnFailures:this.enemies.spawnFailures};}
}
