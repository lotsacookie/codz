import * as THREE from 'three';
import { Enemies } from './enemies.js';
import { loadModel, loadAnimation } from './animation.js';
import { zombieHealth } from './rules.js';

export class MoonEnemies extends Enemies {
  constructor(...args){super(...args);this.autoSpawn=false;this.autoRounds=false;this.spawnDelay=2;this.spawnFailures=0;}
  async load(){
    const actors=this.data.actors;
    this.lunarBodies=await Promise.all(actors.technicians.map(n=>loadModel(actors.models[n])));
    this.earthBodies=[await loadModel(actors.models[actors.military])];
    this.heads=await Promise.all(actors.heads.map(n=>loadModel(actors.models[n])));
    [this.astroBody,this.astroHead,this.quad,this.quadHead,this.dog]=await Promise.all([
      'c_zom_moon_pressure_suit_body_zombie','c_zom_moon_pressure_suit_helm','c_zom_quad_body_bloat','c_zom_quad_head_bloat'
    ].map(n=>loadModel(actors.models[n])).concat([loadModel(this.data.characters.zombie_wolf)]));
    await Promise.all(Object.entries(this.data.animations).filter(([name])=>name.startsWith('ai_zombie_')||name.startsWith('zombie_dog_')).map(async([name,url])=>this.anims[name]=await loadAnimation(url)));
  }
  spawn(position,barrier=null,kind='zombie'){
    this.templates=this.session.area==='moon'?this.lunarBodies:this.earthBodies;
    const heads=this.heads;
    if(kind==='astronaut'){this.templates=[this.astroBody];this.heads=[this.astroHead];}
    const z=super.spawn(position,barrier,kind==='astronaut'?'zombie':kind);this.heads=heads;z.kind=kind;
    if(this.session.area==='earth'){
      z.speed=Math.min(205,42+this.session.earthTime*1.5);
      z.health=z.maxHealth=150+Math.floor(this.session.earthTime/30)*100;
    }
    if(kind==='astronaut'){z.health=z.maxHealth=zombieHealth(this.session.round,this.data.rules)*4;z.speed=38;this.session.spawned--;z.grabLeft=0;}
    if(kind==='dog'){z.speed=230;z.health=z.maxHealth=100+Math.floor(this.session.earthTime/30)*50;}
    if(kind==='nova')z.teleportLeft=8+this.session.random()*6;
    z.baseSpeed=z.speed;z.groundAction=z.rig.actions.walk;z.groundData=z.rig.data.walk;
    const moonWalk=z.speed<80?'ai_zombie_walk_moon_v1':z.speed<165?'ai_zombie_run_moon_v1':'ai_zombie_sprint_moon_v1';
    if(kind==='zombie')z.rig.add('moonWalk',this.anims[moonWalk],true);
    z.lowGravity=null;
    z.rig.current=null;z.rig.play('walk',true,1,0);z.rig.update(.01);
    return z;
  }
  candidates(player){
    const nav=this.world.navigation,active=nav.activeZones(this.session);
    return nav.metadata[this.session.area].candidates.filter(c=>active.has(c.zone)).map(c=>({...c,point:new THREE.Vector3(...c.position)}))
      .filter(c=>{const distance=c.point.distanceTo(player);return distance>180&&distance<1700;});
  }
  trySpawn(player,kind='zombie'){
    const candidates=this.candidates(player),s=this.session;
    if(kind==='zombie'&&this.barriers?.length){
      const viable=this.barriers.filter(b=>{const d=b.inside.distanceTo(player);if(d<180||d>1700)return false;const p=this.world.path(b.inside,player);return p.length>1&&p.at(-1).distanceTo(player)<70;});
      if(viable.length){const b=viable[Math.floor(s.random()*viable.length)];if(!this.list.some(z=>z.barrier===b&&['barricade','entering'].includes(z.state))){this.spawn(null,b,kind);this.spawnFailures=0;return true;}}
    }
    // Prefer hidden entrances and distant nodes; never materialize at the player.
    for(let pass=0;pass<2;pass++)for(let i=0;i<Math.min(32,candidates.length);i++){
      const c=candidates[Math.floor(s.random()*candidates.length)];
      if(pass===0&&this.world.lineClear(player.clone().add(new THREE.Vector3(0,45,0)),c.point.clone().add(new THREE.Vector3(0,45,0))))continue;
      if(this.list.some(z=>z.root.position.distanceTo(c.point)<42))continue;
      const path=this.world.path(c.point,player);
      if(path.length<2||path.at(-1).distanceTo(player)>70)continue;
      this.spawn(c.point,null,kind);this.spawnFailures=0;return true;
    }
    this.spawnFailures++;return false;
  }
  update(dt,player){
    const s=this.session;
    this.spawnDelay-=dt;
    const earth=s.area==='earth',cap=earth?(s.earthTime<25?10:20):24;
    if((s.corePhase??s.phase)==='fighting'&&this.list.length<cap&&(earth||s.spawned<s.total)&&this.spawnDelay<=0){
      const zone=this.world.zoneAt?.(player),nova=!earth&&s.power&&s.round>=5&&/tower|forest|generator_exit/.test(zone??'')&&s.spawned%5===4;
      const kind=earth&&s.earthTime>30&&this.list.filter(z=>z.kind==='dog').length<2&&s.random()<.25?'dog':nova?'nova':'zombie';
      const spawned=this.trySpawn(player,kind);
      this.spawnDelay=spawned?(earth?Math.max(.6,3-s.earthTime/40):Math.max(.4,2*Math.pow(.95,s.round-1))):.8;
    }
    this.astroDelay=(this.astroDelay??15)-dt;
    if(!earth&&(s.corePhase??s.phase)==='fighting'&&this.astroDelay<=0&&!this.list.some(z=>z.kind==='astronaut')&&s.round>=(this.nextAstroRound??1)){
      if(this.trySpawn(player,'astronaut'))this.nextAstroRound=s.round+2;this.astroDelay=15;
    }
    for(const z of [...this.list]){
      if(z.kind==='astronaut'){
        z.grabLeft=Math.max(0,z.grabLeft-dt);
        if(!z.grabLeft&&z.root.position.distanceTo(player)<64&&s.phase!=='reviving'&&this.world.lineClear(z.root.position.clone().add(new THREE.Vector3(0,44,0)),player.clone().add(new THREE.Vector3(0,40,0)))){
          z.grabLeft=8;z.attackDealt=true;this.onAstronaut?.(z);
        }
        // Its grab replaces the common melee event.
        if(z.state==='attack')z.attackDealt=true;
        continue;
      }
      if(z.kind==='nova'){
        z.teleportLeft-=dt;
        if(z.teleportLeft<=0&&z.root.position.distanceTo(player)>180){
          const angle=s.random()*Math.PI*2,p=player.clone().add(new THREE.Vector3(Math.cos(angle)*200,0,Math.sin(angle)*200)),safe=this.world.closest(p,{x:50,y:90,z:50});
          if(safe&&safe.distanceTo(player)>130&&this.world.path(safe,player).at(-1)?.distanceTo(player)<60){this.onTeleport?.(z.root.position.clone(),safe);z.root.position.copy(safe);z.repath=0;}
          z.teleportLeft=8+s.random()*8;
        }
        continue;
      }
      if(z.kind!=='zombie')continue;
      const low=this.world.lowGravity(z.root.position);
      if(low!==z.lowGravity){
        const wasWalking=z.rig.current==='walk';z.rig.actions.walk?.stop();
        z.rig.actions.walk=low?z.rig.actions.moonWalk:z.groundAction;z.rig.data.walk=low?z.rig.data.moonWalk:z.groundData;
        z.lowGravity=low;z.speed=z.baseSpeed*(low?.8:1);
        if(wasWalking){z.rig.current=null;z.rig.play('walk');}
      }
    }
    const astronauts=this.list.filter(z=>z.kind==='astronaut');
    super.update(dt,player);
    // The common stuck-enemy retry decrements the wave count; astronauts are extra.
    for(const z of astronauts)if(!this.list.includes(z)&&z.state!=='dead')s.spawned++;
    if(!earth&&(s.corePhase??s.phase)==='fighting'&&s.spawned>=s.total&&!this.list.some(z=>z.kind!=='astronaut')){s.nextRound();this.spawnDelay=1;}
  }
  hurt(z,damage,head=false,melee=false,cause='bullet'){
    if(z.kind==='astronaut'){
      if(['wave','gersh','nuke'].includes(cause))return;
      const alive=this.list.includes(z),insta=this.session.effects.insta_kill;this.session.effects.insta_kill=0;
      super.hurt(z,damage,head,melee,cause);this.session.effects.insta_kill=insta;
      if(alive&&z.state==='dead')this.session.killed--;
    }else {z.deathCause=cause;super.hurt(z,damage,head,melee,cause);}
  }
  nuke(onDeath){
    const astronauts=this.list.filter(z=>z.kind==='astronaut');
    this.list=this.list.filter(z=>z.kind!=='astronaut');
    for(const z of this.list)z.deathCause='nuke';
    super.nuke(onDeath);this.list.push(...astronauts);
  }
  reset(){super.reset();this.spawnDelay=2;this.spawnFailures=0;this.astroDelay=15;this.nextAstroRound=1;}
}
