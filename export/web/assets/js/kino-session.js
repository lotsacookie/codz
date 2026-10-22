import { Session } from './rules.js';

// Kino-only inventory rules; Moon keeps its separate progression state.
export class KinoSession extends Session {
  reset(){super.reset();this.pack=null;this.claymoresOwned=false;this.claymores=0;this.monkeysOwned=false;this.monkeys=0;this.equipmentLeft=0;this.attachmentMode=false;}
  get def(){
    const w=this.weapon,d=this.data.weapons[w.id],base=w.upgraded?{...d,...d.upgrade,id:w.id,upgraded:true}:d;
    if(w.lost)return {...base,name:'No weapon',clipSize:0,maxAmmo:0};
    return this.attachmentMode&&base.attachment?{...base.attachment,id:base.id,name:base.name+' · '+base.attachment.name,attachmentActive:true}:base;
  }
  get weaponUnavailable(){return !!this.weapon.lost||!!(this.pack?.weapon===this.weapon);}
  get busy(){return ['gameover','reviving'].includes(this.phase)||!!this.drinking||this.meleeLeft>0||this.equipmentLeft>0;}
  update(dt){
    if(this.phase==='gameover')return;
    this.equipmentLeft=Math.max(0,this.equipmentLeft-dt);super.update(dt);
    if(this.pack&&this.time>=this.pack.expires){this.pack.weapon.lost=true;this.pack.weapon.mag=0;this.pack.weapon.reserve=0;this.pack=null;this.lastEvent='Pack-a-Punch weapon expired';}
  }
  damage(n){const changed=super.damage(n);if(['reviving','gameover'].includes(this.phase)){this.cancelReload();this.meleeLeft=0;this.equipmentLeft=0;}return changed;}
  fire(){return !this.busy&&!this.weaponUnavailable&&super.fire();}
  reload(){return !this.busy&&!this.weaponUnavailable&&super.reload();}
  switchWeapon(slot){if(this.busy)return false;this.leaveAttachment();super.switchWeapon(slot);return true;}
  giveWeapon(id){
    if(this.busy||!this.data.weapons[id])return false;
    this.leaveAttachment();
    // A reserved slot cannot be replaced until the machine returns or loses it.
    if(this.pack?.weapon===this.weapon)return false;
    const lost=this.inventory.findIndex(w=>w.lost);
    if(this.pack?.weapon.id===id)return false;
    if(lost>=0){this.inventory[lost]={id,mag:this.data.weapons[id].clipSize,reserve:this.data.weapons[id].maxAmmo,upgraded:false};this.slot=lost;this.cancelReload();return true;}
    super.giveWeapon(id);return true;
  }
  beginPack(){
    if(this.busy||this.pack||this.weaponUnavailable||!this.power||this.weapon.upgraded||!this.data.weapons[this.weapon.id].upgrade||!this.spend(5000))return false;
    this.leaveAttachment();this.cancelReload();this.pack={weapon:this.weapon,readyAt:this.time+4.35,expires:this.time+19.35};return true;
  }
  takePack(){
    if(this.busy||!this.pack||this.time<this.pack.readyAt||this.time>=this.pack.expires)return false;
    this.leaveAttachment();const w=this.pack.weapon;w.upgraded=true;this.slot=this.inventory.indexOf(w);this.pack=null;
    w.mag=this.def.clipSize;w.reserve=this.def.maxAmmo;this.cancelReload();this.fireLeft=this.def.raiseTime??.4;return true;
  }
  buyClaymores(){if(this.busy||this.claymoresOwned||!this.spend(1000))return false;this.claymoresOwned=true;this.claymores=2;return true;}
  giveMonkeys(){if(this.busy)return false;this.monkeysOwned=true;this.monkeys=3;return true;}
  useEquipment(kind){if(!['claymores','monkeys'].includes(kind)||this.busy||this[kind]<=0)return false;this[kind]--;this.equipmentLeft=.8;this.cancelReload();return true;}
  nextRound(){super.nextRound();if(this.claymoresOwned)this.claymores=Math.min(2,this.claymores+2);}
  powerup(type){
    super.powerup(type);
    if(type==='full_ammo'){
      if(this.claymoresOwned)this.claymores=2;if(this.monkeysOwned)this.monkeys=3;
      for(const w of this.inventory){const a=this.data.weapons[w.id].upgrade?.attachment;if(w.upgraded&&a&&w.attachmentAmmo)w.attachmentAmmo.reserve=a.maxAmmo;}
      if(this.attachmentMode){this.weapon.primaryAmmo.reserve=this.data.weapons[this.weapon.id].upgrade.maxAmmo;this.weapon.reserve=this.def.maxAmmo;}
    }
  }
  toggleAttachment(){
    if(this.busy||this.weaponUnavailable)return false;
    if(this.attachmentMode){this.leaveAttachment();this.fireLeft=.3;return true;}
    const a=this.def.attachment;if(!a)return false;
    const w=this.weapon;w.primaryAmmo={mag:w.mag,reserve:w.reserve};w.attachmentAmmo??={mag:a.clipSize,reserve:a.maxAmmo};
    Object.assign(w,w.attachmentAmmo);this.attachmentMode=true;this.cancelReload();this.fireLeft=.3;return true;
  }
  leaveAttachment(){if(!this.attachmentMode)return;const w=this.weapon;w.attachmentAmmo={mag:w.mag,reserve:w.reserve};Object.assign(w,w.primaryAmmo);this.attachmentMode=false;this.cancelReload();}
  snapshot(){return {...super.snapshot(),claymores:this.claymores,claymoresOwned:this.claymoresOwned,monkeys:this.monkeys,monkeysOwned:this.monkeysOwned,equipmentLeft:this.equipmentLeft,attachmentMode:this.attachmentMode,weaponUnavailable:this.weaponUnavailable,pack:this.pack?{id:this.pack.weapon.id,ready:this.time>=this.pack.readyAt,readyIn:Math.max(0,this.pack.readyAt-this.time),expiresIn:this.pack.expires-this.time}:null};}
}
