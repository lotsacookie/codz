import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadModel } from './animation.js';
import { MysteryBox } from './mystery-box.js';
import { MoonProgression, DIGGERS } from './moon-progression.js';
import { MOON_PERKS } from './moon-session.js';
import { contains } from './moon-rules.js';

const V=a=>new THREE.Vector3(...a), colors=[0xe74a49,0x4ecc78,0x4b8cff,0xffdb55],colorNames=['RED','GREEN','BLUE','YELLOW'];
export class MoonFeatures {
  constructor({data,state,combat,scene,camera,player,objects,opened,parts,navigation,notice,raycast}){
    Object.assign(this,{data,state,combat,scene,camera,player,objects,opened,parts,navigation,notice,raycast});
    this.s=combat.session;this.quest=new MoonProgression(data,this.s,notice);combat.features=this;
    this.targets=[];this.fx=[];this.portals=[];this.models={};this.hack=null;this.flight=null;this.padCooldown=0;this.lastArea='earth';
  }
  all(n){return this.data.entities.filter(e=>e.targetname===n);}
  one(n){return this.all(n)[0];}
  async load(){
    await Promise.all(Object.entries(this.combat.data.props).map(async([n,url])=>this.models[n]=await loadModel(url)));
    const locations=this.all('treasure_chest_use'),entities=this.data.entities.slice();
    for(const e of locations){
      const index=e.target.split('_').at(-1),base=this.one('magic_box_base_'+index);
      entities.push({...base,targetname:e.script_noteworthy+'_org'});
      entities.push({...this.one(e.target),targetname:e.script_noteworthy+'_lid'});
    }
    const world={entities:this.objects,boxLocations:locations,activeBox:locations.find(e=>e.script_noteworthy==='start_chest')??locations[0],fireSale:false};
    world.updateBox=()=>{
      for(const e of locations){const index=e.target.split('_').at(-1),visible=e.id===world.activeBox.id||world.fireSale||world.openBoxes?.has(e.id);
        for(const name of ['magic_box_base_','magic_box_lid_']){const o=this.objects.get(this.one(name+index)?.id);if(o)o.visible=visible;}}
    };
    const boxWeapons=Object.fromEntries(Object.entries(this.combat.data.weapons).filter(([id])=>this.combat.data.boxPool.includes(id)));
    Object.assign(boxWeapons,this.combat.data.equipment);
    this.box=new MysteryBox(this.scene,world,{...this.combat.data,weapons:boxWeapons,entities},this.s,this.combat.audio,this.notice);
    await this.box.load();world.updateBox();
    for(const e of this.all('zombie_vending'))this.targets.push({e,kind:'perk',perk:e.script_noteworthy});
    // Mule Kick is spawned by the DLC perk scripts, rather than a BSP trigger.
    const mule={id:'mule',targetname:'zombie_vending',script_noteworthy:'specialty_additionalprimaryweapon',position:[-760,-8,-550],yaw:Math.PI/2};
    this.mule=this.spawnModel('zombie_vending_three_gun',mule.position,mule.yaw);this.targets.push({e:mule,kind:'perk',perk:mule.script_noteworthy});
    for(const e of locations)this.targets.push({e,kind:'box'});
    this.barriers=this.all('exterior_goal').map(e=>{
      const members=this.all(e.target),center=members.find(n=>n.classname==='script_struct')?.position??e.position,outside=V(e.position),inside=V(center);
      inside.addScaledVector(inside.clone().sub(outside).setY(0).normalize(),48);
      const boards=members.filter(n=>n.script_parameters?.startsWith('barricade_')).sort((a,b)=>Number(a.script_noteworthy)-Number(b.script_noteworthy));
      const b={id:e.id,position:V(center),outside,inside,boards,count:boards.length,repairTime:0,reward:0,rewardRound:0};
      this.targets.push({e:{...e,position:center},kind:'barrier',barrier:b});return b;
    });
    this.combat.world.setBoards=(b,n)=>this.setBoards(b,n);this.combat.enemies.barriers=this.barriers;
    this.targets.push({e:this.one('zombie_vending_upgrade'),kind:'pack'});
    for(const e of this.all('zombie_equipment_upgrade').filter(e=>e.zombie_equipment_upgrade==='equip_hacker_zm'))this.targets.push({e,kind:'hacker'});
    for(const [id,d] of Object.entries(DIGGERS))this.targets.push({e:this.one(d.switch),kind:'digger',id});
    for(const name of ['sq_ss_button','struct_osc_st','struct_osc_button','sq_knife_switch','sq_charge_terminal','sq_pyramid_console','sq_wire_pos'])for(const e of this.all(name))this.targets.push({e,kind:name});
    for(const e of this.all('8bitsongs'))this.targets.push({e,kind:'music'});
    const bowie=this.data.entities.find(e=>e.targetname==='bowie_upgrade');if(bowie)this.targets.push({e:bowie,kind:'bowie'});
    this.sphere=this.spawnModel('p_zom_moon_black_egg',this.one('vs_stage_1a').position);this.sphere.visible=false;
    this.wire=this.spawnModel('zombie_magic_box_wire',this.data.entities[this.quest.wireId].position);
    this.plates=this.all('sq_cassimir_plates').map(e=>this.spawnModel('p_zom_moon_cassimir_plate',e.position,e.yaw));
    this.generator=this.spawnModel('p_zom_moon_vril_complete',this.one('sq_charge_vg_pos').position);this.generator.visible=false;
    const sam=this.one('sq_sam');this.samantha=this.spawnModel(sam.model,sam.position,sam.yaw);this.samantha.visible=false;
    this.tankFills=[this.one('sq_first_tank'),...this.all('sq_second_tank')].map(e=>{
      const mesh=new THREE.Mesh(new THREE.CylinderGeometry(13,13,65,16),new THREE.MeshBasicMaterial({color:0x6ff9ea,transparent:true,opacity:.6,depthWrite:false}));
      mesh.position.copy(V(e.position)).y+=45;this.scene.add(mesh);mesh.visible=false;return mesh;
    });
    this.simonLights=this.all('sq_ss_button').map(e=>{
      const light=new THREE.PointLight(colors[Number(e.script_int)],0,150,1);light.position.copy(V(e.position));this.scene.add(light);
      const screen=new THREE.Mesh(new THREE.PlaneGeometry(25,22),new THREE.MeshBasicMaterial({color:colors[Number(e.script_int)],transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));
      screen.position.copy(V(e.position));screen.rotation.y=e.yaw;this.scene.add(screen);return {light,screen};
    });
    this.securityLights=this.all('struct_osc_st').map(e=>{
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(3,8,6),new THREE.MeshBasicMaterial({color:0x61ff9c}));mesh.position.copy(V(e.position));this.scene.add(mesh);return {e,mesh};
    });
    this.combat.enemies.onAstronaut=z=>this.astronaut(z);
    this.combat.enemies.onTeleport=(from,to)=>{this.combat.effect(from,0x92ccff,12);this.combat.effect(to,0x92ccff,12);};
    this.resetPresentation();
  }
  spawnModel(name,position,yaw=0){const o=clone(this.models[name]);o.position.copy(V(position));o.rotation.y=yaw;this.scene.add(o);return o;}
  resetPresentation(){
    for(const t of this.targets.filter(t=>t.kind==='hacker')){const e=this.one(t.e.target),o=this.objects.get(e?.id);if(o)o.visible=t.e.id===this.quest.hackerId;}
    this.wire.position.copy(V(this.data.entities[this.quest.wireId].position));this.wire.visible=true;
    this.syncPerkMachine();
  }
  reset(){
    this.quest.reset();this.box.reset();this.box.world.activeBox=this.box.world.boxLocations.find(e=>e.script_noteworthy==='start_chest')??this.box.world.boxLocations[0];this.box.world.updateBox();
    this.hack=null;this.flight=null;this.padCooldown=0;this.lastArea='earth';this.sphere.visible=false;this.packHackVisit=null;this.sirenPhase=0;
    for(const p of this.portals){p.mesh.removeFromParent();p.mesh.geometry.dispose();p.mesh.material.dispose();}this.portals=[];
    for(const f of this.fx){f.mesh.removeFromParent();f.mesh.geometry.dispose();f.mesh.material.dispose();}this.fx=[];
    this.generator.visible=false;this.samantha.visible=false;this.samantha.position.fromArray(this.one('sq_sam').position);for(const t of this.tankFills)t.visible=false;
    for(const b of this.barriers){this.setBoards(b,b.boards.length);b.reward=0;b.rewardRound=0;}
    for(const w of this.all('sq_pyramid_walls')){const o=this.objects.get(w.id);if(o)o.position.copy(V(w.position));}
    this.resetPresentation();this.syncBlockers();
  }
  syncPerkMachine(){
    const jug=this.s.earthVisits%2===0;
    for(const [name,visible] of [['vending_jugg',jug],['vending_sleight',!jug]])for(const e of this.all(name)){const o=this.objects.get(e.id);if(o)o.visible=visible;}
  }
  describe(t){
    const q=this.quest,s=this.s;
    if(t.kind==='perk'){
      if(t.e.position[0]>10000&&t.perk!==(s.earthVisits%2===0?'specialty_armorvest':'specialty_fastreload'))return '';
      const p=MOON_PERKS[t.perk];if(!p)return '';
      if(s.perks.has(t.perk))return p.name+' equipped'+(s.hacker&&!s.permanentPerks?' · Hold F to refund':'');
      if(t.perk==='specialty_quickrevive'&&s.revives>=3&&!s.permanentPerks)return 'Quick Revive exhausted';
      if(!s.power&&s.area!=='earth'&&t.perk!=='specialty_quickrevive')return p.name+' · Requires power';
      return p.name+' · '+p.price+(s.perks.size>=s.perkLimit?' · Four-perk limit':'');
    }
    if(t.kind==='box'){
      if(!this.box.available(t.e))return '';
      const roll=this.box.at(t.e);return roll?roll.ready&&!roll.teddy?'Take '+this.box.data.weapons[roll.weapon].name:roll.teddy?'The box is moving…':'Mystery Box rolling…':'Mystery Box · '+(s.effects.fire_sale>s.time?10:950);
    }
    if(t.kind==='pack')return s.pack?s.time>=s.pack.readyAt?'Retrieve '+s.def.name+' · Pack-a-Punch':'Upgrading weapon…':s.weapon.upgraded?'Weapon already upgraded':'Pack-a-Punch · 5000';
    if(t.kind==='hacker')return t.e.id===q.hackerId&&!s.hacker?'Take Hacker · replaces P.E.S.':'';
    if(t.kind==='digger')return q.diggers[t.id].phase!=='idle'?(s.hacker?'Hold F · Retract excavator ':'Hacker required · Excavator ')+DIGGERS[t.id].name:'';
    if(t.kind==='bowie')return s.bowie?'Bowie Knife equipped':'Bowie Knife · 3000';
    if(t.kind==='barrier')return t.barrier.count<t.barrier.boards.length?'Hold F · Repair barricade':'';
    if(t.kind==='music')return 'Play hidden recording';
    if(t.kind==='sq_ss_button'&&['simon','final_simon'].includes(q.stage))return (q.elapsed<q.sequenceShowUntil?'Watch the sequence':'Press '+colorNames[Number(t.e.script_int)])+` · ${q.sequenceInput}/${q.sequenceLength}`;
    if(t.kind==='struct_osc_button')return q.stage==='security_start'?(s.hacker?'Hold F · Hack security · 500':'Hacker required'):q.stage==='buttons'?'Press laboratory button':'';
    if(t.kind==='struct_osc_st'&&q.stage==='security'&&q.securityTargets.includes(t.e.id)&&!q.security.has(t.e.id))return s.hacker?'Hold F · Hack green terminal':'Hacker required';
    if(t.kind==='sq_knife_switch'&&q.stage==='switch')return 'Release Samantha';
    if(t.kind==='sq_wire_pos'&&q.stage==='wire'&&!q.wire&&t.e.id===q.wireId)return 'Collect wire';
    if(t.kind==='sq_charge_terminal'&&((q.stage==='wire'&&q.wire)||q.stage==='charge'))return q.stage==='charge'?`Hold F · Charge Vril Device · ${Math.floor(q.charge)}/60s`:'Connect wire and Vril Device';
    if(t.kind==='sq_pyramid_console'&&q.stage==='swap')return 'Insert charged Vril Device';
    return '';
  }
  findTarget(maxDistance=110){
    let best=null;const forward=this.camera.getWorldDirection(new THREE.Vector3());
    for(const t of this.targets){const label=this.describe(t);if(!label)continue;
      const point=t.kind==='sq_wire_pos'?this.wire.position:V(t.e.position),delta=point.clone().sub(this.camera.position);
      const d=t.e.bounds?new THREE.Box3(V(t.e.bounds[0]),V(t.e.bounds[1])).distanceToPoint(this.camera.position):delta.length();
      if(d>=maxDistance||delta.length()>25&&delta.clone().normalize().dot(forward)<.25)continue;
      const wall=this.raycast(new THREE.Ray(this.camera.position.clone(),delta.clone().normalize()),1,delta.length());
      if(wall&&wall.distance<delta.length()-32)continue;
      best={...t,label,distance:d};maxDistance=d;
    }
    this.target=best;return best;
  }
  interact(t=this.target){
    if(!t||!this.s.canAct&&!(t.kind==='pack'&&this.s.pack))return false;
    const s=this.s,q=this.quest,a=this.combat.audio;let ok=false;
    if(t.kind==='perk'){
      if(s.hacker&&s.perks.has(t.perk)&&!s.permanentPerks)return this.startHack(t,5,()=>{s.losePerk(t.perk);s.points+=MOON_PERKS[t.perk].price;this.combat.equip().catch(console.error);});
      ok=s.buyPerk(t.perk);if(ok){this.combat.clearInput();this.combat.perkDrink.start(t.perk,this.combat.view);this.notice(MOON_PERKS[t.perk].name);a.play(t.perk,1,t.e.position);}
      else this.notice(s.perks.size>=s.perkLimit?'You can buy four perks. Complete the quest to earn all eight.':'Cannot purchase: check points, power, and owned perks.');
    }
    if(t.kind==='hacker'&&t.e.id===q.hackerId){s.hacker=true;this.state.hasSuit=false;this.state.suit=false;this.notice('Hacker equipped. You have no P.E.S. Return to a suit station before entering vacuum.');ok=true;}
    if(t.kind==='box'){
      const roll=this.box.at(t.e);
      if(roll?.ready&&!roll.teddy){const id=this.box.take(t.e);ok=!!id;if(id){if(this.combat.data.equipment[id])s.giveEquipment(id);else{s.giveWeapon(id);this.combat.equip().catch(console.error);}this.notice(this.box.data.weapons[id].name+(this.combat.data.equipment[id]?' · X to throw':''));}}
      else if(!roll&&this.box.available(t.e)){const cost=s.effects.fire_sale>s.time?10:950;if(s.points>=cost&&this.box.start(t.e)){s.spend(cost);ok=true;}else this.notice('Not enough points.');}
    }
    if(t.kind==='pack'){
      ok=s.pack?s.takePack():s.beginPack();
      if(ok){a.play('packapunch',1,t.e.position);this.combat.equip().catch(console.error);this.notice(s.pack?'Weapon inserted. Retrieve it after five seconds.':'Weapon upgraded.');}
      else this.notice(s.pack?'The machine is still working.':'Pack-a-Punch requires 5000 points and an unupgraded weapon.');
    }
    if(t.kind==='digger')return this.startHack(t,5,()=>q.hackDigger(t.id));
    if(t.kind==='struct_osc_st')return this.startHack(t,5,()=>q.hackSecurity(t.e.id));
    if(t.kind==='struct_osc_button'){if(q.stage==='security_start')return this.startHack(t,5,()=>q.startSecurity());ok=q.pressButton(t.e.id);}
    if(t.kind==='sq_ss_button'){ok=q.pressSimon(Number(t.e.script_int));this.combat.audio.cue('_sidequest/samanthasays/evt_ss_'+(ok?'right':'wrong'));}
    if(t.kind==='sq_knife_switch')ok=q.useSwitch();
    if(t.kind==='sq_wire_pos')ok=q.takeWire(t.e.id);
    if(t.kind==='sq_charge_terminal')ok=q.chargeDevice(0);
    if(t.kind==='sq_pyramid_console')ok=q.swap();
    if(t.kind==='bowie'&&!s.bowie&&s.spend(3000)){s.bowie=true;ok=true;this.notice('Bowie Knife equipped.');}
    if(t.kind==='music'){
      q.musicEggs.add(t.e.id);const n=Number(t.e.script_string.at(-1)),track=q.musicEggs.size===3?'coming_home':['bit/new_chorus_8bit','bit/paradol_8bit','bit/redamned'][n];
      a.playMusic('moon/mus/zombie/moon/'+track).catch(console.error);this.notice(q.musicEggs.size===3?'Coming Home':'Hidden recording '+q.musicEggs.size+' / 3');ok=true;
    }
    if(ok)this.combat.audio.play('buy');return ok;
  }
  startHack(target,duration,action){
    if(!this.s.hacker||this.hack)return false;this.hack={target,duration,left:duration,action,start:this.player.getFeetPosition().clone(),health:this.s.health};this.combat.clearInput();return true;
  }
  updateHold(dt,held){
    if(this.hack){const h=this.hack;
      const t=this.findTarget(),valid=h.remote?this.camera.position.distanceTo(V(h.target.e.position))<130:t?.e.id===h.target.e.id;
      if(!held||!this.s.canAct||!this.s.hacker||this.s.health<h.health||this.player.getFeetPosition().distanceTo(h.start)>35||!valid){this.hack=null;this.notice('Hack interrupted.');return;}
      h.left-=dt;if(h.left<=0){h.action();this.hack=null;this.combat.audio.play('buy');}
    }else if(held&&this.target?.kind==='sq_charge_terminal'&&this.s.canAct)this.quest.chargeDevice(dt);
    else if(held&&this.target?.kind==='barrier'&&this.s.canAct){const b=this.target.barrier;
      if(b.rewardRound!==this.s.round){b.rewardRound=this.s.round;b.reward=0;}
      b.repairTime+=dt;if(b.repairTime>=.7&&b.count<b.boards.length){b.repairTime=0;this.setBoards(b,b.count+1);if(b.reward<Math.min(500,40+(this.s.round-1)*50)){this.s.addPoints(10);b.reward+=10;}this.combat.audio.play('board');}
    }
  }
  hackNearby(baseTarget){
    if(!this.s.hacker||!this.s.canAct||this.hack)return false;
    const t=this.findTarget(),s=this.s;
    if(t?.kind==='box'){
      const b=this.box.boxes.get(t.e.id),roll=b?.roll;if(!roll?.ready||roll.teddy||roll.hacked||s.points<600)return false;
      return this.startHack(t,3,()=>{if(b.roll!==roll||s.points<600)return;s.spend(600);roll.hacked=true;roll.ready=false;roll.weapon=roll.pool[Math.floor(s.random()*roll.pool.length)];roll.started=s.time;roll.time=s.time+3.9;roll.expires=s.time+15.9;this.notice('Mystery Box rerolled.');});
    }
    if(t?.kind==='perk'&&s.perks.has(t.perk))return this.interact(t);
    if(t?.kind==='barrier')return this.startHack(t,5,()=>{this.setBoards(t.barrier,t.barrier.boards.length);s.addPoints(100);this.notice('Barricade restored. +100 points.');});
    if(baseTarget?.kind==='door'&&s.points>=200){const d=baseTarget.door,e=baseTarget.entity;
      if(this.startHack({e,kind:'door'},30,()=>{if(s.openDoors.has(d.name)||!s.spend(200))return;s.openDoors.add(d.name);if(d.flag)s.flags.add(d.flag);this.opened.add(d.name);this.notice('Door hacked for 200 points.');})){this.hack.remote=true;return true;}
    }
    if(baseTarget?.kind==='weapon'&&s.points>=3000&&!s.hackedWeapons.has(baseTarget.weapon.id)){
      const id=baseTarget.weapon.id;
      if(this.startHack({e:baseTarget.entity,kind:'weapon'},5,()=>{if(!s.spend(3000))return;s.hackedWeapons.add(id);this.notice('Wall ammunition prices reversed for '+this.combat.data.weapons[id].name+'.');})){this.hack.remote=true;return true;}
    }
    if(t?.kind==='pack'&&this.packHackVisit!==s.earthVisits){
      return this.startHack(t,5,()=>{this.packHackVisit=s.earthVisits;s.addPoints(1000);s.effects.pack_shield=s.time+20;this.notice('Pack-a-Punch protection active for 20 seconds. +1000 points.');});
    }
    const pickup=this.combat.pickups.items.find(p=>p.root.position.distanceTo(this.camera.position)<120);
    if(pickup&&s.points>=5000){
      const e={id:'pickup-hack',position:pickup.root.position.toArray()};
      if(this.startHack({e,kind:'pickup'},5,()=>{if(!this.combat.pickups.items.includes(pickup)||!s.spend(5000))return;const at=pickup.root.position.clone().add(new THREE.Vector3(0,-40,0));this.combat.pickups.remove(pickup);this.combat.pickups.spawn(pickup.type==='full_ammo'?'fire_sale':'full_ammo',at);this.notice('Power-up converted.');})){this.hack.remote=true;return true;}
    }
    return false;
  }
  environment(base){if(this.quest.breaches.has(base.zone))return {...base,lowGravity:true,breathable:false,gravity:136};return base;}
  syncBlockers(){
    let changed=false;
    for(const [id,d] of Object.entries(DIGGERS))if(d.blocker){const part=this.parts.get(this.one(d.blocker)?.id);if(!part)continue;
      const amount=this.quest.diggers[id].phase==='digging'?0:1;
      if(part.amount!==amount){part.amount=amount;changed=true;}if(part.object)part.object.visible=amount===0;
    }
    if(changed)this.navigation.setDoors(this.parts);
  }
  safeTeleport(){
    const zones=this.navigation.activeZones(this.s),feet=this.player.getFeetPosition();
    const spots=this.all('struct_black_hole_teleport').filter(e=>zones.has(e.script_string)&&V(e.position).distanceTo(feet)>250);
    const ordered=spots.sort(()=>this.s.random()-.5);
    for(const e of ordered){const p=this.navigation.closest(V(e.position));if(p&&p.distanceTo(V(e.position))<100){this.player.setPosition(p.add(new THREE.Vector3(0,3,0)));this.state.exposure=0;return true;}}
    return false;
  }
  astronaut(z){
    if(this.s.phase==='reviving'||this.s.effects.invulnerable>this.s.time)return;
    const perks=[...this.s.perks],perk=perks[Math.floor(this.s.random()*perks.length)];if(perk)this.s.losePerk(perk);
    this.s.health=1;this.s.damageTime=this.s.time;this.s.effects.invulnerable=this.s.time+2;
    this.safeTeleport();this.combat.equip().catch(console.error);this.combat.effect(z.root.position,0xa6d9ff,25);
    this.notice('The astronaut teleported you'+(perk&&!this.s.permanentPerks?' and stole '+MOON_PERKS[perk].name:'')+'.',7);
  }
  onKill(z){
    if(!z)return;
    const tank=this.quest.kill(z.root.position.toArray(),z.kind,z.deathCause);if(tank)this.combat.effect(V(tank).add(new THREE.Vector3(0,65,0)),0x67ffd8,10);
    if(z.kind==='astronaut'){
      this.combat.effect(z.root.position,0xc7efff,30);
      for(const other of [...this.combat.enemies.list])if(other.root.position.distanceTo(z.root.position)<400)this.combat.enemies.hurt(other,other.health,false,false,'explosion');
    }
    if(z.gasDeath){const mesh=new THREE.Mesh(new THREE.SphereGeometry(95,12,8),new THREE.MeshBasicMaterial({color:0x91bd52,transparent:true,opacity:.16,depthWrite:false}));mesh.position.copy(z.root.position).y+=30;this.scene.add(mesh);this.fx.push({mesh,life:5,gas:true});}
  }
  shot(ray,cause,range=6000){
    const q=this.quest;
    if(q.stage==='sphere'&&q.spherePosition){const p=ray.intersectSphere(new THREE.Sphere(V(q.spherePosition),18),new THREE.Vector3());
      if(p&&p.distanceTo(ray.origin)<range){const wall=this.raycast(ray,1,p.distanceTo(ray.origin));if(!wall||wall.distance>=p.distanceTo(ray.origin)-24)q.motivateSphere(cause);}}
  }
  blast(position,cause){this.quest.blast(position.toArray(),cause);}
  equipment(id,position){
    const type=id==='zombie_black_hole_bomb'?'gersh':'qed',questEvent=this.quest.blast(position.toArray(),type);
    this.combat.audio.play('teleport');
    if(type==='gersh'){
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(45,24,16),new THREE.MeshBasicMaterial({color:0x6034b5,transparent:true,opacity:.85}));mesh.position.copy(position).y+=25;this.scene.add(mesh);
      this.portals.push({mesh,life:10,pulse:0,teleported:false});
    }else{
      this.combat.effect(position,0x83c7ff,45);
      if(questEvent)return;
      const roll=Math.floor(this.s.random()*11);
      if(roll===0){this.combat.collect('full_ammo');this.notice('QED: Max Ammo');}
      else if(roll===1){for(const z of [...this.combat.enemies.list])if(z.root.position.distanceTo(position)<650)this.combat.enemies.hurt(z,z.health,false,false,'explosion');this.notice('QED: Quantum explosion');}
      else if(roll===2){const choices=Object.keys(MOON_PERKS).filter(p=>!this.s.perks.has(p));const p=choices[Math.floor(this.s.random()*choices.length)];if(p){this.s.perks.add(p);this.s.health=this.s.maxHealth;this.notice('QED: Free '+MOON_PERKS[p].name);}}
      else if(roll===3){this.safeTeleport();this.notice('QED: Teleportation');}
      else if(roll===4){this.s.addPoints(1000);this.notice('QED: 1000 points');}
      else if(roll===5){this.combat.collect('double_points');this.notice('QED: Double Points');}
      else if(roll===6){this.s.points=Math.max(0,this.s.points-1000);this.notice('QED: 1000 points lost');}
      else if(roll===7){const perks=[...this.s.perks];if(perks.length){this.s.losePerk(perks[Math.floor(this.s.random()*perks.length)]);this.combat.equip().catch(console.error);}this.notice('QED: Perk disruption');}
      else if(roll===8){this.s.weapon.mag=0;this.notice('QED: Magazine emptied');}
      else if(roll===9){for(let i=0;i<4;i++)if(this.combat.enemies.trySpawn(this.player.getFeetPosition())&&this.s.area==='moon')this.s.total++;this.notice('QED: Reinforcements incoming');}
      else if(this.s.def.upgrade&&!this.s.weapon.upgraded){this.s.weapon.upgraded=true;this.s.weapon.mag=this.s.def.clipSize;this.s.weapon.reserve=this.s.def.maxAmmo;this.combat.equip().catch(console.error);this.notice('QED: Weapon upgraded');}
    }
  }
  updateJump(dt){
    this.padCooldown=Math.max(0,this.padCooldown-dt);
    if(this.flight){const f=this.flight;f.time=Math.min(f.duration,f.time+dt);const t=f.time/f.duration;
      const p=f.from.clone().lerp(f.to,t);p.y+=4*t*(1-t)*f.height;this.player.setPosition(p);
      if(t===1){this.flight=null;this.padCooldown=1.5;}return;
    }
    if(!this.s.power||this.padCooldown||this.s.phase==='reviving')return;
    const feet=this.player.getFeetPosition().toArray();
    const pad=this.all('trig_jump_pad').find(e=>contains(e.bounds,feet)||contains(e.bounds,[feet[0],feet[1]+35,feet[2]]));if(!pad)return;
    const start=this.one(pad.target),end=this.one(start?.target);if(!end)return;
    const from=this.player.getFeetPosition(),to=V(end.position).add(new THREE.Vector3(0,6,0));
    this.flight={from,to,time:0,duration:Math.max(1.1,from.distanceTo(to)/460),height:Math.max(170,Math.abs(to.y-from.y)*.4)};this.combat.audio.play('teleport');
  }
  update(dt,held){
    const q=this.quest,s=this.s;q.update(dt);this.box.update(dt);this.updateHold(dt,held);this.updateJump(dt);this.syncBlockers();
    if(s.area!==this.lastArea){this.lastArea=s.area;this.syncPerkMachine();this.hack=null;this.flight=null;}
    if(s.area==='earth'){
      const phase=Math.floor(s.earthTime/30);if(phase!==(this.sirenPhase??0)){this.sirenPhase=phase;this.combat.audio.play('round');this.notice('No Man’s Land: the horde is getting stronger.',4);}
    }
    if(s.pack&&s.time>s.pack.expires){
      const slot=s.inventory.indexOf(s.pack.weapon);if(slot>=0)s.inventory.splice(slot,1);s.pack=null;
      if(!s.inventory.length)s.giveWeapon('m1911_zm');s.slot=Math.min(s.slot,s.inventory.length-1);this.combat.equip().catch(console.error);this.notice('The Pack-a-Punch weapon was not collected in time.');
    }
    const feet=this.player.getFeetPosition();
    for(const [id,d] of Object.entries(DIGGERS))if(q.diggers[id].phase==='digging'&&d.damage&&contains(this.one(d.damage)?.bounds,feet.toArray()))this.combat.damage(10000);
    for(const p of [...this.portals]){
      p.life-=dt;p.mesh.rotation.y+=dt*2;p.mesh.scale.setScalar(1+Math.sin(p.life*7)*.12);
      for(const z of [...this.combat.enemies.list]){const distance=z.root.position.distanceTo(p.mesh.position);if(z.kind==='astronaut'||distance>650)continue;
        if(distance<85)this.combat.enemies.hurt(z,z.health,false,false,'gersh');else{z.path=[z.root.position.clone(),p.mesh.position.clone()];z.pathIndex=1;z.repath=1;}}
      if(!p.teleported&&feet.distanceTo(p.mesh.position)<60){p.teleported=true;this.safeTeleport();this.notice('Gersh Device teleport.');}
      if(p.life<=0){p.mesh.removeFromParent();p.mesh.geometry.dispose();p.mesh.material.dispose();this.portals.splice(this.portals.indexOf(p),1);}
    }
    for(const f of [...this.fx]){f.life-=dt;if(f.gas&&feet.distanceTo(f.mesh.position)<100&&!s.perks.has('specialty_flakjacket'))this.combat.damage(dt*18);if(f.life<=0){f.mesh.removeFromParent();f.mesh.geometry.dispose();f.mesh.material.dispose();this.fx.splice(this.fx.indexOf(f),1);}}
    this.sphere.visible=!!q.spherePosition;if(q.spherePosition)this.sphere.position.copy(V(q.spherePosition));
    this.wire.visible=!q.wire;
    const platePositions=q.plates==='earth'||q.plates==='loose'?this.all('sq_cassimir_plates'):q.plates==='receiving'?this.all('sq_ctvg_tp2'):this.all('sq_cp_final');
    this.plates.forEach((o,i)=>{o.position.copy(V(platePositions[i].position));if(q.plates==='loose')o.position.y-=75;});
    this.generator.visible=['charge','tanks','swap','final_simon','final_qed','final_gersh','launch','complete'].includes(q.stage);
    if(this.generator.visible)this.generator.position.copy(V(this.one(q.generator?'sq_vg_final':'sq_charge_vg_pos').position));
    this.tankFills.forEach((o,i)=>{o.visible=['tank','switch','tanks','swap'].includes(q.stage)&&(q.stage==='tanks'||q.stage==='swap'||i===0);o.scale.y=Math.max(.02,q.tanks[i]/25);});
    const open=q.history.some(h=>h.stage==='switch');
    this.samantha.visible=open;
    if(open){const sam=this.one('sq_sam'),end=this.one(sam.target);this.samantha.position.lerp(V(end?.position??sam.position),Math.min(1,dt*.4));this.samantha.position.y+=Math.sin(q.elapsed*1.7)*dt*2;}
    if(open)for(const e of this.all('sq_pyramid_walls')){const o=this.objects.get(e.id);if(o)o.position.y=THREE.MathUtils.damp(o.position.y,e.position[1]-200,1,dt);}
    const showing=['simon','final_simon'].includes(q.stage)&&q.elapsed<q.sequenceShowUntil;
    const age=q.sequenceLength*.8+1-(q.sequenceShowUntil-q.elapsed),index=Math.floor((age-.5)/.8),flash=showing&&age>.5&&index<q.sequenceLength&&(age-.5)% .8<.55?q.sequence[index]:-1;
    this.simonLights.forEach(({light,screen},i)=>{light.intensity=flash===i?90:0;screen.material.opacity=flash===i?.9:.06;});
    for(const {e,mesh}of this.securityLights)mesh.visible=q.stage==='security'&&q.securityTargets.includes(e.id)&&!q.security.has(e.id);
    this.updateHud();
  }
  updateHud(){
    const s=this.s,q=this.quest,$=id=>document.getElementById(id);
    if($('objective'))$('objective').textContent=q.objective();
    if($('perks')){const html=[...s.perks].map(id=>MOON_PERKS[id].image?`<img alt="${MOON_PERKS[id].name}" title="${MOON_PERKS[id].name}" src="textures/${MOON_PERKS[id].image}.png">`:`<span title="${MOON_PERKS[id].name}" style="background:${MOON_PERKS[id].color}">${MOON_PERKS[id].icon}</span>`).join('');if($('perks').innerHTML!==html)$('perks').innerHTML=html;}
    if($('special-equipment'))$('special-equipment').textContent=(s.hacker?'HACKER · ':'')+(s.equipment?this.combat.data.equipment[s.equipment].name+' × '+s.equipmentAmmo+' · X':'')+(s.weapon.id==='microwavegun_zm'?' · B: combine / split':'');
    if($('hazard'))$('hazard').textContent=Object.entries(q.diggers).filter(([,d])=>d.phase!=='idle').map(([id,d])=>`${DIGGERS[id].name} · ${DIGGERS[id].label} · ${d.phase==='digging'?'BREACHED':Math.ceil(d.left)+'s'}`).join(' / ');
    if($('hack-progress')){$('hack-progress').hidden=!this.hack;$('hack-progress').value=this.hack?1-this.hack.left/this.hack.duration:0;}
  }
  setBoards(b,n){b.count=Math.max(0,Math.min(b.boards.length,n));b.boards.forEach((e,i)=>{const o=this.objects.get(e.id);if(o)o.visible=i<b.count;const p=this.parts.get(e.id);if(p)p.amount=i<b.count?0:1;});}
  get brokenWindows(){return this.barriers.filter(b=>b.count===0).length;}
  repairAll(){for(const b of this.barriers)this.setBoards(b,b.boards.length);}
  snapshot(){return {quest:this.quest.snapshot(),box:this.box.snapshot(),boxLocation:this.box.world.activeBox.id,boxMoves:this.box.moves,hacker:this.s.hacker,equipment:this.s.equipment,equipmentAmmo:this.s.equipmentAmmo,hack:this.hack?{left:this.hack.left,target:this.hack.target.e.id}:null,flight:!!this.flight};}
}
