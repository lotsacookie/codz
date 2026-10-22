import { Session, roundPopulation, makeWeapon } from './rules.js';

export const MOON_PERKS = {
  specialty_quickrevive:{name:'Quick Revive',price:500,color:'#64bad7',icon:'QR',image:'specialty_quickrevive_zombies'},
  specialty_armorvest:{name:'Juggernog',price:2500,color:'#c84343',icon:'J',image:'specialty_juggernaut_zombies'},
  specialty_fastreload:{name:'Speed Cola',price:3000,color:'#65bd76',icon:'SC',image:'specialty_fastreload_zombies'},
  specialty_rof:{name:'Double Tap',price:2000,color:'#d6a647',icon:'DT',image:'specialty_doubletap_zombies'},
  specialty_longersprint:{name:'Stamin-Up',price:2000,color:'#ebbd4b',icon:'S'},
  specialty_flakjacket:{name:'PhD Flopper',price:2000,color:'#be83da',icon:'PhD'},
  specialty_deadshot:{name:'Deadshot Daiquiri',price:1500,color:'#9da8ac',icon:'DS'},
  specialty_additionalprimaryweapon:{name:'Mule Kick',price:4000,color:'#82a86c',icon:'MK'},
};

// Lunar waves use the common T5 round rules. Area 51 is an endless encounter;
// travelling there suspends the lunar wave and preserves its remaining count.
export class MoonSession extends Session {
  reset() {
    super.reset(); this.area = 'earth'; this.moonStarted = false; this.savedWave = null;
    this.earthTime = 0; this.phase = 'fighting'; this.total = 0; this.nextDogRound = Infinity;
    this.equipment = null; this.equipmentAmmo = 0; this.permanentPerks = this.mods.has('keep_perks');
    this.hacker = false; this.earthVisits = 0; this.pack = null; this.hackedWeapons = new Set();
  }
  update(dt) { const reviving=this.phase==='reviving';super.update(dt);if(reviving&&this.phase==='fighting')this.health=this.maxHealth; if (this.area === 'earth' && this.phase !== 'gameover') this.earthTime += dt; }
  enterArea(lunar) {
    const next = lunar ? 'moon' : 'earth'; if (next === this.area) return;
    if (!lunar) {
      this.savedWave = {round:this.round,total:this.total,killed:this.killed,phase:this.phase,countdown:this.countdown};
      this.area = 'earth'; this.phase = 'fighting'; this.total = 0; this.spawned = this.killed = 0; this.earthTime = 0;
      this.earthVisits++;
    } else {
      this.area = 'moon';
      if (this.savedWave) Object.assign(this,this.savedWave);
      else { this.round = 1; this.killed = 0; this.total = roundPopulation(1,this.data.rules); this.phase = 'preparing'; this.countdown = 6; }
      this.spawned = this.killed; this.moonStarted = true; this.savedWave = null;
    }
  }
  nextRound() { this.nextDogRound = Infinity; super.nextRound(); }
  get def() {
    if(this.effects?.death_machine>this.time&&this.data.weapons.minigun_zm)return this.data.weapons.minigun_zm;
    const w=this.weapon,id=w.id==='microwavegun_zm'&&w.mode==='zap'?'microwavegundw_zm':w.id;
    const d=this.data.weapons[id];return w.upgraded?{...d,...d.upgrade,id,upgraded:true,name:d.name+' • Pack-a-Punch'}:d;
  }
  get canAct(){return !['gameover','reviving'].includes(this.phase)&&!this.drinking&&!this.meleeLeft&&!this.pack&&!(this.effects.death_machine>this.time);}
  buyPerk(id,free=false){
    const p=MOON_PERKS[id];
    if(!p||!this.canAct||this.perks.has(id)||(!free&&this.perks.size>=this.perkLimit)||
       (!free&&id==='specialty_quickrevive'&&this.revives>=3)||
       (!free&&!this.power&&this.area!=='earth'&&id!=='specialty_quickrevive')||(!free&&this.points<p.price))return false;
    if(!this.drink(id))return false;
    if(!free)this.spend(p.price);return true;
  }
  losePerk(id){
    if(this.permanentPerks)return;
    this.perks.delete(id);this.health=Math.min(this.health,this.maxHealth);
    if(id==='specialty_additionalprimaryweapon'&&this.inventory.length>2){this.inventory.splice(2);this.slot=Math.min(1,this.slot);this.cancelReload();}
  }
  damage(n){
    const perks=[...this.perks],changed=super.damage(n);
    if(this.phase==='reviving'){
      if(this.permanentPerks)this.perks=new Set(perks);
      else if(this.inventory.length>2){this.inventory.splice(2);this.slot=Math.min(1,this.slot);}
    }
    return changed;
  }
  giveWeapon(id){
    if(id==='microwavegundw_zm')id='microwavegun_zm';
    if(!this.data.weapons[id])return false;
    if(this.inventory.some(w=>w.id===id)){super.giveWeapon(id);return true;}
    if(this.perks.has('specialty_additionalprimaryweapon')&&this.inventory.length<3){this.inventory.push(makeWeapon(this.data.weapons[id],true));this.slot=this.inventory.length-1;this.cancelReload();}
    else super.giveWeapon(id);
    return true;
  }
  toggleWave(){
    const w=this.weapon;if(!this.canAct||w.id!=='microwavegun_zm'||this.reloadLeft)return false;
    const old=w.mode==='zap'?'zap':'wave',next=old==='wave'?'zap':'wave';
    w[old+'Ammo']={mag:w.mag,reserve:w.reserve};w.mode=next;
    const ammo=w[next+'Ammo']??{mag:this.def.clipSize,reserve:this.def.maxAmmo};Object.assign(w,ammo);
    this.fireLeft=.6;return true;
  }
  giveEquipment(type){if(!this.data.equipment?.[type])return false;this.equipment=type;this.equipmentAmmo=3;return true;}
  powerup(type){
    super.powerup(type);
    if(type==='full_ammo'){
      if(this.equipment)this.equipmentAmmo=3;
      for(const w of this.inventory)if(w.id==='microwavegun_zm'){
        for(const mode of ['wave','zap']){const d=this.data.weapons[mode==='wave'?'microwavegun_zm':'microwavegundw_zm'];if(w[mode+'Ammo'])w[mode+'Ammo'].reserve=w.upgraded?d.upgrade.maxAmmo:d.maxAmmo;}
        const d=this.data.weapons[w.mode==='zap'?'microwavegundw_zm':'microwavegun_zm'];w.reserve=w.upgraded?d.upgrade.maxAmmo:d.maxAmmo;
      }
    }
  }
  beginPack(){
    if(!this.canAct||this.weapon.upgraded||!this.def.upgrade||this.points<5000)return false;
    this.spend(5000);this.cancelReload();this.pack={weapon:this.weapon,readyAt:this.time+5,expires:this.time+20};return true;
  }
  takePack(){
    if(['gameover','reviving'].includes(this.phase)||!this.pack||!this.inventory.includes(this.pack.weapon)||this.time<this.pack.readyAt||this.time>this.pack.expires)return false;
    const w=this.pack.weapon;w.upgraded=true;w.waveAmmo=w.zapAmmo=undefined;
    this.slot=this.inventory.indexOf(w);w.mag=this.def.clipSize;w.reserve=this.def.maxAmmo;this.pack=null;return true;
  }
  fire(){
    if(this.pack)return false;
    if(this.effects.death_machine>this.time){if(['gameover','reviving'].includes(this.phase)||this.fireLeft>0)return false;this.fireLeft=this.def.fireTime;this.shots++;return true;}
    return super.fire();
  }
  reload(){if(this.pack)return false;return super.reload();}
  switchWeapon(slot){if(this.pack||!this.canAct)return;super.switchWeapon(slot);}
  buyDoor(door) {
    if (!this.canAct || this.openDoors.has(door.name) || !this.spend(door.cost)) return false;
    this.openDoors.add(door.name); if (door.flag) this.flags.add(door.flag); return true;
  }
  buyWeapon(id) {
    if (!this.canAct) return false;
    const def = this.data.weapons[id]; if (!def) return false;
    const owned = this.inventory.find(w => w.id === id);
    if (owned) {
      const capacity = owned.upgraded ? def.upgrade.maxAmmo : def.maxAmmo;
      const basePrice=def.ammoPrice??Math.ceil(def.price/2),price=this.hackedWeapons.has(id)?owned.upgraded?basePrice:4500:owned.upgraded?4500:basePrice;
      if (owned.reserve >= capacity || !this.spend(price)) return false;
      owned.reserve = capacity; return true;
    }
    if (!this.spend(def.price)) return false;
    this.giveWeapon(id); return true;
  }
}
