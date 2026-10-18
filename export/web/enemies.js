import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { Rig, loadModel, loadAnimation } from './animation.js';
import { zombieHealth } from './rules.js';
import { disposeSkeletons, runtimeProfile } from './runtime-assets.js';
import { turnToward, steerDirection, smoothingEnabled } from './steering.js';

const BLEND = .18;                       // seconds to cross-fade walk/attack (was .1)
const STEER_RATE = smoothingEnabled() ? 12 : Infinity;   // path-direction easing; Infinity = old behaviour

export const MELEE_DAMAGE = 60;
export const MELEE_ATTACK_DIST = 64;
const SPAWN_DELAY_FLOOR = .08;
const GAIT_SPEED = {
  zombie: { walk: [42, 52, 62], run: [100, 100, 100], sprint: [150, 150, 150] },
  nova: { walk: [48, 48, 48], run: [92, 92, 92], sprint: [128, 128, 128] }
};
const GAIT_ANIM = {
  zombie: { walk: ['ai_zombie_walk_v1', 'ai_zombie_walk_v2', 'ai_zombie_walk_fast_v1'], run: ['ai_zombie_run_v1', 'ai_zombie_run_v1', 'ai_zombie_run_v1'], sprint: ['ai_zombie_sprint_v1', 'ai_zombie_sprint_v1', 'ai_zombie_sprint_v1'] },
  nova: { walk: 'ai_zombie_quad_crawl', run: 'ai_zombie_quad_crawl_run', sprint: 'ai_zombie_quad_crawl_sprint' }
};

export function rollGait(round, rules = {}, random = Math.random) {
  const base = round <= 1 ? 1 : (round - 1) * (rules.zombie_move_speed_multiplier ?? 8);
  const roll = base + Math.floor(random() * 35);
  return roll <= 35 ? 'walk' : roll <= 70 ? 'run' : 'sprint';
}

export class Enemies {
  constructor(scene,world,data,session,{damage,kill,hit,sound}){Object.assign(this,{scene,world,data,session,onDamage:damage,onKill:kill,onHit:hit,onSound:sound});this.list=[];this.dead=[];this.nextSpawn=0;this.serial=0;this.templates=[];this.anims={};}
  async load(){
    const chars=this.data.characters;
    this.templates=await Promise.all(['c_ger_honorguard_body1','c_ger_honorguard_body2'].map(k=>loadModel(chars[k])));
    this.heads=await Promise.all(['c_ger_zombie_head1','c_ger_zombie_head2','c_ger_zombie_head3','c_ger_zombie_head4'].map(k=>loadModel(chars[k])));
    this.dog=await loadModel(chars.zombie_wolf);
    this.quad=await loadModel(chars.c_zom_quad_body);this.quadHead=await loadModel(chars.c_zom_quad_head);
    await Promise.all(Object.entries(this.data.animations).filter(([n])=>n.startsWith('ai_zombie_')||n.startsWith('zombie_dog_')).map(async([n,u])=>{this.anims[n]=await loadAnimation(u);}));
  }
  spawn(position=null,barrier=null,kind=this.session.dogRound?'dog':'zombie'){
    const id=++this.serial,root=new THREE.Group();root.name=kind+'_'+id;
    if(kind==='dog'&&this.dog)root.add(clone(this.dog));
    else{
      const body=clone(kind==='nova'?this.quad:this.templates[id%this.templates.length]);root.add(body);
      const sourceHead=kind==='nova'?this.quadHead:this.heads[id%this.heads.length];
      if(sourceHead){
        const head=clone(sourceHead);root.add(head);root.updateMatrixWorld(true);
        const mount=body.getObjectByName('j_spine4'),anchor=head.getObjectByName('j_spine4');
        if(mount&&anchor){head.matrixAutoUpdate=false;head.matrix.copy(anchor.matrixWorld).invert();mount.add(head);anchor.userData.animationAnchor=true;}
      }
    }
    if(runtimeProfile.shadows)root.traverse(o=>{if(o.isMesh)o.castShadow=true;});
    const spawnAt=barrier&&!position?this.spawnPointOf(barrier):null;root.position.copy(position??spawnAt??barrier.outside);this.scene.add(root);
    const rig=new Rig(root),round=this.session.round;
    const gait=kind==='dog'?'sprint':rollGait(round,this.data.rules,()=>this.session.random());
    const variant=Math.floor(this.session.random()*3),jitter=.94+this.session.random()*.12;
    const speed=kind==='dog'?230:GAIT_SPEED[kind==='nova'?'nova':'zombie'][gait][variant]*jitter;
    const walk=kind==='dog'?'zombie_dog_run':kind==='nova'?GAIT_ANIM.nova[gait]:GAIT_ANIM.zombie[gait][variant];
    const attack=kind==='dog'?'zombie_dog_run_attack':kind==='nova'?'ai_zombie_quad_attack':'ai_zombie_attack_v1';
    if(this.anims[walk])rig.add('walk',this.anims[walk],true);
    if(this.anims[attack])rig.add('attack',this.anims[attack],true);
    const death=kind==='nova'?'ai_zombie_quad_death':kind==='dog'?'zombie_dog_death_front':'ai_zombie_death_v1';
    if(this.anims[death])rig.add('death',this.anims[death],true);
    rig.play('walk');rig.update(.01);
    root.traverse(o=>{if(o.isMesh)o.frustumCulled=false;});
    const z={id,kind,root,rig,speed,health:kind==='dog'?([400,900,1300,1600][Math.min(3,Math.max(0,this.session.dogRounds-1))]):zombieHealth(round,this.data.rules),state:barrier?(spawnAt?'approach':'barricade'):'chase',approachTime:0,barrier,path:[],pathIndex:0,repath:0,attackLeft:0,attackDealt:false,tearLeft:1.1,stuck:0,lastPosition:root.position.clone(),growl:3+id%7};
    if(kind==='nova')z.health=Math.trunc(z.health*.75);
    z.maxHealth=z.health;this.list.push(z);this.session.spawned++;return z;
  }
  update(dt,player){
    const s=this.session;
    if(this.autoSpawn!==false&&s.phase==='fighting'&&s.spawned<s.total&&this.list.length<24){
      this.nextSpawn-=dt;
      if(this.nextSpawn<=0){
        const candidates=this.world.spawnBarriers(s).filter(b=>{const p=this.world.path(b.inside,player);return p.length>1&&p.at(-1).distanceTo(player)<150;});
        if(candidates.length){
          const b=candidates[Math.floor(s.random()*candidates.length)],nova=s.power&&!s.dogRound&&s.spawned%5===4&&['foyer_zone','foyer2_zone','theater_zone','stage_zone','dining_zone'].includes(this.world.zoneAt(player.clone().add(new THREE.Vector3(0,35,0))));
          this.spawn(s.dogRound||nova?b.inside:null,s.dogRound||nova?null:b,s.dogRound?'dog':nova?'nova':'zombie');
          this.nextSpawn=Math.max(SPAWN_DELAY_FLOOR,(this.data.rules.zombie_spawn_delay??2)*Math.pow(.95,s.round-1));
        }
        else this.nextSpawn=1;
      }
    }
    for(const z of [...this.list]){
      z.rig.update(dt);z.growl-=dt;
      if(z.growl<0){this.onSound?.('growl',z.root.position);z.growl=6+s.random()*7;}
      // Zombies from a distant spawn point walk to the window before tearing its boards.
      if(z.state==='approach'){
        z.approachTime+=dt;
        const to=z.barrier.outside,near=Math.hypot(to.x-z.root.position.x,to.z-z.root.position.z)<14&&Math.abs(to.y-z.root.position.y)<60;
        z.approachMark??={t:0,p:z.root.position.clone()};z.approachMark.t+=dt;let jam=false;if(z.approachMark.t>=4){jam=z.approachMark.p.distanceTo(z.root.position)<20;z.approachMark.t=0;z.approachMark.p.copy(z.root.position);}
        if(near||z.approachTime>30||((jam||(z.approachTime>1.5&&z.path.length<2))&&!this.seen(z,player))){z.root.position.copy(to);z.state='barricade';z.heading=null;z.path=[];z.tearLeft=1.1;}
      }
      if(z.state==='barricade'){
        z.root.rotation.y=turnToward(z.root.rotation.y,Math.atan2(-(z.barrier.inside.z-z.root.position.z),z.barrier.inside.x-z.root.position.x),dt,{rate:12});
        z.tearLeft-=dt;
        if(z.barrier.count>0){z.rig.play('attack',true,1,BLEND);if(z.tearLeft<=0){this.world.setBoards(z.barrier,z.barrier.count-1,true);z.tearLeft=1.1;this.onSound?.('board',z.root.position);}}
        else{z.state='entering';z.enterFrom=z.root.position.clone();z.enterTo=null;z.enterTime=0;z.rig.play('walk',true,1,BLEND);}
        continue;
      }
      if(z.state==='entering'){
        z.enterTime+=dt;const t=Math.min(1,z.enterTime/1.2);if(!z.enterTo){const g=this.world.closest(z.barrier.inside,{x:40,y:100,z:40});z.enterTo=g&&Math.hypot(g.x-z.barrier.inside.x,g.z-z.barrier.inside.z)<70?g:z.barrier.inside;}z.root.position.lerpVectors(z.enterFrom,z.enterTo,t*t*(3-2*t));z.root.position.y+=Math.sin(t*Math.PI)*12;
        if(t===1){z.state='chase';z.repath=0;}continue;
      }
      const approaching=z.state==='approach',lure=approaching?null:this.lureTarget?.(z),goal=approaching?z.barrier.outside:lure??player;
      const dist=z.root.position.distanceTo(player),at=z.root.position.clone().add(new THREE.Vector3(0,z.kind==='dog'?25:45,0)),eye=player.clone().add(new THREE.Vector3(0,40,0));
      if(z.state==='attack'){
        z.attackLeft-=dt;
        if(!z.attackDealt&&z.attackLeft<.62){z.attackDealt=true;if(!lure&&dist<76&&this.world.lineClear(at,eye))this.onDamage(z.kind==='dog'?40:z.kind==='nova'?45:MELEE_DAMAGE);}
        if(z.attackLeft<=0){z.state='chase';z.rig.play('walk',true,1,BLEND);}continue;
      }
      if(!lure&&!approaching&&dist<MELEE_ATTACK_DIST&&Math.abs(z.root.position.y-player.y)<50&&s.phase!=='reviving'&&this.world.lineClear(at,eye)){
        z.state='attack';z.attackLeft=1.15;z.attackDealt=false;z.rig.play('attack',false,1,BLEND);continue;
      }
      z.repath-=dt;
      if(z.repath<=0){
        z.path=this.world.path(z.root.position,goal);z.pathIndex=1;z.repath=.55+(z.id%5)*.07;z.trail=false;
        // Navmesh could not connect us to the goal: optionally follow the player's breadcrumb trail instead.
        if(this.fallbackPath&&(z.forceFallback||z.path.length<2||z.path.at(-1).distanceTo(goal)>90)){const alt=this.fallbackPath(z,goal);if(alt?.length){z.path=alt;z.pathIndex=0;z.trail=true;}}
      }
      const target=z.path[z.pathIndex];
      if(target){
        const delta=target.clone().sub(z.root.position),horizontal=Math.hypot(delta.x,delta.z);
        if(horizontal<(z.pathIndex>=z.path.length-1?10:18)){z.pathIndex++;}
        else{
          const want={x:delta.x/horizontal,y:Math.max(-2,Math.min(2,delta.y/horizontal)),z:delta.z/horizontal};
          z.heading=z.heading?steerDirection(z.heading,want,dt,STEER_RATE):want;
          const next=z.root.position.clone().addScaledVector(new THREE.Vector3(z.heading.x,z.heading.y,z.heading.z),Math.min(z.speed*dt,horizontal));
          for(const other of this.list){if(other===z||other.state==='barricade')continue;const op=other.root.position,sx=next.x-op.x,sz=next.z-op.z,d=Math.sqrt(sx*sx+sz*sz);if(d<29&&d>.01){const k=(29-d)/d*dt*2;next.x+=sx*k;next.z+=sz*k;}}
          if(!Number.isFinite(next.x+next.y+next.z)){z.heading=null;z.path=[];z.repath=0;continue;}
          const safe=this.world.closest(next,{x:22,y:36,z:22});
          if(z.trail){const here=z.root.position;if(!this.world.stepClear||this.world.stepClear(here,next))here.copy(next);else{const sx=new THREE.Vector3(next.x,next.y,here.z),sz=new THREE.Vector3(here.x,next.y,next.z);if(this.world.stepClear(here,sx))here.copy(sx);else if(this.world.stepClear(here,sz))here.copy(sz);else{z.repath=Math.min(z.repath,.25);z.heading=null;}}}else{
            let ground=safe&&safe.distanceTo(next)<38?safe:null;
            if(!ground){const wide=this.world.closest(next,{x:40,y:90,z:40});if(wide&&Math.hypot(wide.x-next.x,wide.z-next.z)<48)ground=wide;}
            if(ground){
              z.noGround=0;const here=z.root.position,rise=ground.y-here.y;
              here.x=ground.x;here.z=ground.z;here.y=Math.abs(rise)<.4?ground.y:here.y+rise*Math.min(1,dt*(rise>0?9:14));
            }else{
              z.noGround=(z.noGround??0)+dt;
              if(z.noGround>.4){const rescue=this.world.closest(z.root.position,{x:120,y:160,z:120});if(rescue&&rescue.distanceTo(z.root.position)<200)z.root.position.copy(rescue);z.noGround=0;z.repath=0;}
            }
          }
          z.root.rotation.y=turnToward(z.root.rotation.y,Math.atan2(-z.heading.z,z.heading.x),dt,{rate:14});
        }
      }
      if(z.root.position.y<player.y-900&&this.relocate(z,player))continue;
      z.stuck+=dt;
      if(z.stuck>12){const moved=z.lastPosition.distanceTo(z.root.position);z.lastPosition.copy(z.root.position);z.stuck=0;if(moved<5&&dist>100){z.path=[];z.repath=0;z.stuckCount=(z.stuckCount??0)+1;if(z.stuckCount>=2&&this.relocate(z,player))z.stuckCount=0;else if(z.stuckCount>=4&&!this.seen(z,player)){this.remove(z);s.spawned--;}}else z.stuckCount=0;}
    }
    for(const d of [...this.dead]){d.life-=dt;d.rig.update(dt);if(d.life<2)d.root.position.y-=dt*24;if(d.life<=0){d.root.removeFromParent();d.rig.mixer.uncacheRoot(d.root);disposeSkeletons(d.root);this.dead.splice(this.dead.indexOf(d),1);}}
    if(this.autoRounds!==false&&s.phase==='fighting'&&s.spawned>=s.total&&this.list.length===0){if(s.dogRound)this.onKill?.(null,'full_ammo',this.lastDogDeath??player);s.nextRound();this.nextSpawn=0;this.lastDogDeath=null;}
  }
  spawnPointOf(b){
    const sp=b.spawnPoint;if(!sp)return null;
    const nav=this.world.navigation;if(!nav?.canReach)return sp;
    const c=b.spawnCheck;if(c&&c.version===nav.version)return c.ok?sp:null;
    let ok=true;try{ok=nav.canReach(sp,b.outside)!==false;}catch{ok=true;}
    b.spawnCheck={version:nav.version,ok};return ok?sp:null;
  }
  seen(z,player){
    const p=z.root.position;if(p.distanceTo(player)>900)return false;
    return this.world.lineClear(p.clone().add(new THREE.Vector3(0,45,0)),player.clone().add(new THREE.Vector3(0,40,0)));
  }
  relocate(z,player){
    if(this.seen(z,player))return false;
    const s=this.session,pool=this.pool?this.pool():(this.world.spawnBarriers?.(s)??this.barriers??[]);
    const list=pool.filter(b=>b.inside);if(!list.length)return false;
    const far=list.filter(b=>b.inside.distanceTo(player)>300),pick=[...(far.length?far:list)];
    let target=null;
    for(let tries=0;tries<4&&pick.length&&!target;tries++){
      const b=pick.splice(Math.floor(s.random()*pick.length),1)[0],p=this.world.path(b.inside,player);
      if(p.length>1&&p.at(-1).distanceTo(player)<150)target=b;
    }
    if(!target)return false;
    z.root.position.copy(target.inside);
    z.state='chase';z.heading=null;z.path=[];z.pathIndex=0;z.repath=0;z.stuck=0;z.stuckCount=0;z.stalls=0;z.forceFallback=false;z.watch=null;z.trail=false;
    z.lastPosition.copy(z.root.position);
    return true;
  }
  remove(z){z.root.removeFromParent();z.rig.mixer.uncacheRoot(z.root);disposeSkeletons(z.root);this.list.splice(this.list.indexOf(z),1);}
  hurt(z,damage,head=false,melee=false,cause='bullet',score=true){
    if(!this.list.includes(z))return;
    z.health-=this.session.effects.insta_kill>this.session.time?Math.max(damage,z.health):damage;
    this.onHit?.(z,head);
    if(z.health<=0){
      if(z.kind==='dog')this.lastDogDeath=z.root.position.clone();
      if(score)this.session.scoreHit(true,head,melee);else{this.session.kills++;this.session.killed++;}this.list.splice(this.list.indexOf(z),1);z.state='dead';z.life=4;z.rig.play('death',false);this.dead.push(z);z.gasDeath=z.kind==='nova'&&!melee&&cause==='bullet';this.onKill?.(z);
      if(this.dead.length>12){const old=this.dead.shift();old.root.removeFromParent();old.rig.mixer.uncacheRoot(old.root);disposeSkeletons(old.root);}
    }else if(score)this.session.scoreHit(false);
  }
  rayHit(ray,far){
    let best=null;
    for(const z of this.list){
      const base=z.root.position,headPos=this.headPosition(z);
      const headPoint=ray.intersectSphere(new THREE.Sphere(headPos,z.kind==='dog'?12:10),new THREE.Vector3());
      const bodyPoint=ray.intersectBox(new THREE.Box3(base.clone().add(new THREE.Vector3(-18,4,-18)),base.clone().add(new THREE.Vector3(18,z.kind==='zombie'?58:36,18))),new THREE.Vector3());
      let head=!!headPoint;let point=headPoint??bodyPoint;if(!point)continue;
      if(headPoint&&bodyPoint&&bodyPoint.distanceTo(ray.origin)+12<headPoint.distanceTo(ray.origin)){point=bodyPoint;head=false;}
      const distance=point.distanceTo(ray.origin);if(distance>far||best&&best.distance<distance)continue;best={z,head,point,distance};
    }return best;
  }
  headPosition(z){z.root.updateMatrixWorld(true);const bone=z.root.getObjectByName('j_head');return bone?bone.getWorldPosition(new THREE.Vector3()):z.root.position.clone().add(new THREE.Vector3(0,z.kind==='zombie'?63:28,0));}
  nuke(onDeath){for(const z of [...this.list]){this.list.splice(this.list.indexOf(z),1);this.session.kills++;this.session.killed++;if(z.kind==='dog')this.lastDogDeath=z.root.position.clone();z.state='dead';z.gasDeath=false;z.life=3;z.rig.play('death',false);this.dead.push(z);onDeath(z);this.onKill?.(z);}}
  reset(){for(const z of [...this.list,...this.dead]){z.root.removeFromParent();z.rig.mixer.uncacheRoot(z.root);disposeSkeletons(z.root);}this.list=[];this.dead=[];this.nextSpawn=0;this.lastDogDeath=null;}
  snapshot(){return this.list.map(z=>({id:z.id,kind:z.kind,health:z.health,state:z.state,position:z.root.position.toArray(),pathLength:z.path.length,animation:z.rig.current}));}
}
