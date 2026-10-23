import { activeModifiers, hasModifier } from './modifiers.js';
import { attachSession, tickMods } from './mods/runtime.js';
// Ported from the locally extracted T5 GSC and mp/zombiemode.csv.
export function zombieHealth(round, rules = {}) {
  let health=rules.zombie_health_start??150;
  for(let i=2;i<=round;i++) health=i>=10?health+Math.trunc(health*(rules.zombie_health_increase_multiplier??.1)):Math.trunc(health+(rules.zombie_health_increase??100));
  return hasModifier('tank_zombies')?health*3:health;
}
export function roundPopulation(round, rules = {}, players=1) {
  let multiplier=Math.max(1,round/5);
  if(round>=10) multiplier*=round*.15;
  const max=(rules.zombie_max_ai??24)+Math.trunc((players===1?.5:players-1)*(rules.zombie_ai_per_player??6)*multiplier);
  return Math.trunc(max*([0,.25,.3,.5,.7,.9][round]??1));
}
export function makeWeapon(def, full=false) {
  return {id:def.id,mag:def.clipSize,reserve:full?def.maxAmmo:def.startAmmo,upgraded:false};
}
// _zombiemode_powerups.gsc and zombie_theater.gsc: shuffled drop deck,
// 3% random chance, growing earned-score threshold and four drops per round.
export class PowerupDirector {
  constructor(session){this.reset(session);}
  reset(s){this.round=s.round;this.count=0;this.deck=[];this.pending=false;this.increment=s.data.rules.zombie_powerup_drop_increment??2000;this.nextScore=s.totalScore+this.increment;}
  observe(s){
    if(this.round!==s.round){this.round=s.round;this.count=0;}
    if(s.totalScore>this.nextScore){this.increment*=1.14;this.nextScore=s.totalScore+this.increment;this.pending=true;}
  }
  tryDrop(s,{playable=true,kind='zombie',destroyedWindows=0,boxMoves=0}={}){
    this.observe(s);
    if(!playable||kind==='dog'||this.count>=(s.data.rules.zombie_powerup_drop_max_per_round??4))return null;
    if(s.random()>=.03&&!this.pending)return null;
    const types=['nuke','insta_kill','double_points','full_ammo','carpenter','fire_sale'];
    for(let attempts=0;attempts<types.length*2;attempts++){
      if(!this.deck.length){this.deck=types.slice();for(let i=this.deck.length-1;i>0;i--){const j=Math.floor(s.random()*(i+1));[this.deck[i],this.deck[j]]=[this.deck[j],this.deck[i]];}}
      const type=this.deck.shift();
      if(s.round===1&&['nuke','fire_sale'].includes(type)||type==='carpenter'&&destroyedWindows<5||type==='fire_sale'&&(!boxMoves||s.effects.fire_sale>s.time))continue;
      this.count++;this.pending=false;return type;
    }
    return null;
  }
}
export const POWERUP_LIFETIME=26.5;
export function powerupVisible(age){
  if(age<15)return true;if(age>=POWERUP_LIFETIME)return false;
  const frame=age<22.5?Math.floor((age-15)/.5):age<25?15+Math.floor((age-22.5)/.25):25+Math.floor((age-25)/.1);
  return frame%2===0;
}
export class Session {
  constructor(data, random=Math.random) {this.data=data;this.random=random;this.reset();}
  get perkLimit(){return this.mods.has('no_perk_limit')?Infinity:4;}
  get quota(){return roundPopulation(this.round,this.data.rules);}
  reset() {
    this.mods=activeModifiers();attachSession(this);
    this.time=0;this.round=1;this.countdown=6;this.phase='preparing';this.health=100;
    this.points=this.data.rules.zombie_score_start_1p??500;this.kills=0;this.headshots=0;this.shots=0;this.hits=0;
    this.inventory=[makeWeapon(this.data.weapons.m1911_zm)];this.slot=0;this.adsShot=false;this.reloadLeft=0;this.reloadStage=null;this.reloadSerial=0;this.reloadDuration=0;this.fireLeft=0;
    this.perks=new Set();this.flags=new Set(['always_on']);this.openDoors=new Set();this.power=false;this.revives=0;this.spectating=false;this.deathRound=0;this.respawned=false;
    this.effects={};this.damageTime=-100;this.grenades=4;this.meleeLeft=0;this.spawned=0;this.killed=0;
    this.bowie=false;this.totalScore=this.points;this.drops=new PowerupDirector(this);this.drinking=null;this.drinkLeft=0;
    this.nextDogRound=5+Math.floor(this.random()*3);this.dogRound=false;this.dogRounds=0;this.total=roundPopulation(1,this.data.rules);
    this.teleporter='unlinked';this.teleportTime=0;this.lastEvent='Survive the night';this.doubleUntil=0;
    if(this.mods.has('rich_start')){this.points+=50000;this.totalScore=this.points;this.drops=new PowerupDirector(this);}
  }
  get weapon(){return this.inventory[this.slot];}
  get def(){const d=this.data.weapons[this.weapon.id];return this.weapon.upgraded?{...d,...d.upgrade,upgraded:true,name:d.name+' • Pack-a-Punch'}:d;}
  // Co-op: a dead player spectates until the next round. `phase` then reads 'reviving' so every player-facing check
  // (input, view model, damage, HUD) treats them as out of action, while `corePhase` keeps the real round state so
  // the host's zombie spawning and round progress carry on underneath.
  get phase(){return this.spectating?'reviving':this._phase;}
  set phase(value){this._phase=value;}
  get corePhase(){return this._phase;}
  get maxHealth(){return this.perks.has('specialty_armorvest')?250:100;}
  addPoints(n){const value=n*(this.effects.double_points>this.time?2:1)*(this.mods.has('double_points')?2:1);this.points+=value;this.totalScore+=value;}
  spend(n){if(this.points<n)return false;this.points-=n;return true;}
  damage(n){
    if(this.phase==='gameover'||this.phase==='reviving'||this.effects.invulnerable>this.time)return false;
    this.health=Math.max(0,this.health-(this.mods.has('glass_cannon')?this.maxHealth*4:n));this.damageTime=this.time;
    if(this.health<=0){
      this.drinking=null;this.drinkLeft=0;
      if(this.perks.has('specialty_quickrevive')){if(!this.mods.has('keep_perks'))this.perks.clear();this.phase='reviving';this.reviveLeft=4;this.revives++;this.lastEvent='Quick Revive';}
      else if(this.coopAlive?.()){if(!this.mods.has('keep_perks'))this.perks.clear();this.spectating=true;this.deathRound=this.round;this.lastEvent='Spectating';}
      else {this.phase='gameover';this.lastEvent='Game over';}
    } return true;
  }
  update(dt){
    if(this.phase==='gameover')return;
    this.time+=dt;this.fireLeft=Math.max(0,this.fireLeft-dt);this.meleeLeft=Math.max(0,this.meleeLeft-dt);
    this.drops.observe(this);
    if(this.mods.has('insta_kill'))this.effects.insta_kill=this.time+999;
    if(this.mods.has('endless')&&this.corePhase==='fighting'&&this.area!=='earth'){
      if(this.total<=this.spawned)this.total=this.spawned+1;
      if(this.killed>=this.quota)this.nextRound();
    }
    if(this.drinking){this.drinkLeft=Math.max(0,this.drinkLeft-dt);if(!this.drinkLeft){this.perks.add(this.drinking);this.drinking=null;this.health=this.maxHealth;}}
    let reloadDt=dt;
    while(this.reloadLeft>0&&reloadDt>=this.reloadLeft){reloadDt-=this.reloadLeft;this.finishReloadStage();}
    if(this.reloadLeft>0)this.reloadLeft-=reloadDt;
    if(this.spectating&&this.round>this.deathRound){this.spectating=false;this.health=this.maxHealth;this.effects.invulnerable=this.time+5;this.respawned=true;this.lastEvent='Back in the fight';}
    if(this.spectating){
      if(this.corePhase==='preparing'){this.countdown-=dt;if(this.countdown<=0){this.phase='fighting';this.lastEvent=this.dogRound?'Fetch their souls':'Round '+this.round;}}
      return;
    }
    if(this.phase==='reviving'){this.reviveLeft-=dt;if(this.reviveLeft<=0){this.health=100;this.phase='fighting';this.effects.invulnerable=this.time+5;}return;}
    if(this.time-this.damageTime>4) this.health=Math.min(this.maxHealth,this.health+dt*this.maxHealth*.25);
    if(this.phase==='preparing'){this.countdown-=dt;if(this.countdown<=0){this.phase='fighting';this.lastEvent=this.dogRound?'Fetch their souls':'Round '+this.round;}}
  }
  fire(){
    if(this.phase==='gameover'||this.phase==='reviving'||this.drinking||this.meleeLeft>0||this.reloadLeft>0||this.fireLeft>0||this.weapon.mag===0)return false;
    if(!this.mods.has('infinite_ammo'))this.weapon.mag--;this.shots++;this.fireLeft=this.def.fireTime/(this.perks.has('specialty_rof')?1.33:1);return true;
  }
  reload(){
    if(this.phase==='gameover'||this.phase==='reviving'||this.drinking||this.meleeLeft>0||this.reloadLeft>0||this.weapon.reserve<=0||this.weapon.mag>=this.def.clipSize)return false;
    this.reloadEmpty=this.weapon.mag===0;this.reloadInterrupted=false;
    this.setReloadStage(this.def.segmentedReload?(this.def.reloadStartTime>0?'start':'shell'):'magazine');return true;
  }
  setReloadStage(stage){
    this.reloadStage=stage;this.reloadSerial++;
    const d=this.def,duration=stage==='start'?d.reloadStartTime:stage==='end'?d.reloadEndTime:stage==='magazine'&&this.reloadEmpty?d.reloadEmptyTime:d.reloadTime;
    this.reloadDuration=this.reloadLeft=Math.max(.01,duration)/(this.perks.has('specialty_fastreload')?2:1);
  }
  finishReloadStage(){
    const stage=this.reloadStage,d=this.def;
    const add=stage==='start'?d.reloadStartAdd:stage==='shell'?Math.max(1,d.reloadAmmoAdd):stage==='magazine'?d.clipSize:0;
    const amount=Math.min(add,d.clipSize-this.weapon.mag,this.weapon.reserve);this.weapon.mag+=amount;this.weapon.reserve-=amount;
    if(stage==='end'||stage==='magazine'){this.cancelReload();return;}
    this.setReloadStage(this.reloadInterrupted||this.weapon.mag===d.clipSize||this.weapon.reserve===0?'end':'shell');
  }
  interruptReload(){if(this.def.segmentedReload&&this.reloadLeft>0&&this.weapon.mag>0)this.reloadInterrupted=true;}
  cancelReload(){this.reloadLeft=0;this.reloadStage=null;}
  switchWeapon(slot){if(this.drinking||this.meleeLeft>0||this.inventory.length<2)return;this.slot=(slot??(this.slot+1))%this.inventory.length;this.cancelReload();this.fireLeft=Math.max(.2,this.def.raiseTime??0);}
  drink(perk){
    const d=this.data.perkDrinks?.[perk];if(!d||this.drinking||this.perks.has(perk)||this.phase==='gameover'||this.phase==='reviving')return false;
    this.cancelReload();this.drinking=perk;this.drinkLeft=d.raiseTime+d.dropTime;return true;
  }
  giveWeapon(id){
    const owned=this.inventory.find(w=>w.id===id);
    if(owned){this.slot=this.inventory.indexOf(owned);owned.mag=this.def.clipSize;owned.reserve=this.def.maxAmmo;this.cancelReload();return;}
    const w=makeWeapon(this.data.weapons[id],true);
    if(this.inventory.length<2){this.inventory.push(w);this.slot=this.inventory.length-1;}else this.inventory[this.slot]=w;
    this.cancelReload();
  }
  scoreHit(killed=false,head=false,melee=false){
    this.hits++;
    if(killed){this.kills++;this.killed++;if(head)this.headshots++;this.addPoints(melee?130:head?100:60);}
    else this.addPoints(this.adsShot?15:10);// zombie_damage_ads: Int(10*1.25) rounded up to 5
  }
  nextRound(){
    this.round++;this.dogRound=!this.mods.has('endless')&&this.round===this.nextDogRound;
    if(this.dogRound){this.nextDogRound=this.round+4+Math.floor(this.random()*2);this.dogRounds++;}
    this.total=this.dogRound?(this.dogRounds<3?6:8):roundPopulation(this.round,this.data.rules);
    this.spawned=0;this.killed=0;this.phase='preparing';this.countdown=this.mods.has('endless')?.5:10;this.grenades=Math.min(4,this.grenades+2);
    this.lastEvent='Round survived';
  }
  powerup(type){
    if(type==='full_ammo'){for(const w of this.inventory){const d=this.data.weapons[w.id];w.reserve=w.upgraded?d.upgrade?.maxAmmo??d.maxAmmo:d.maxAmmo;}this.grenades=4;}
    if(type==='double_points'||type==='insta_kill'||type==='fire_sale')this.effects[type]=this.time+30;
    if(type==='nuke')this.addPoints(400);
    if(type==='carpenter')this.addPoints(200);
  }
  snapshot(){return {totalScore:this.totalScore,drinking:this.drinking,drinkLeft:this.drinkLeft,dropCount:this.drops.count,nextDogRound:this.nextDogRound,round:this.round,phase:this.phase,time:this.time,health:this.health,maxHealth:this.maxHealth,points:this.points,kills:this.kills,headshots:this.headshots,total:this.total,spawned:this.spawned,killed:this.killed,weapon:{...this.weapon,name:this.def.name},inventory:this.inventory.map(w=>({...w})),reloadLeft:this.reloadLeft,reloadStage:this.reloadStage,reloadDuration:this.reloadDuration,meleeLeft:this.meleeLeft,bowie:this.bowie,perks:[...this.perks],power:this.power,flags:[...this.flags],openDoors:[...this.openDoors],effects:{...this.effects},teleporter:this.teleporter,grenades:this.grenades,dogRound:this.dogRound};}
}
