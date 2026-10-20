import { GameAudio } from './audio.js';

export class MoonAudio extends GameAudio {
  constructor(){super();this.music={stop(){}};this.ambientKey=null;this.ambientToken=0;}
  async load(){await super.load();const r=await fetch('moon/audio/manifest.json');if(!r.ok)throw new Error('Missing Moon audio. Run build:moon.');Object.assign(this.manifest,await r.json());}
  cue(path,volume=1){this.play('moon/evt/zombie_moon/'+path,volume);}
  shotKey(def){
    this.shotKeys??=new Map();
    if(this.shotKeys.has(def.id))return this.shotKeys.get(def.id);
    let key=def.id==='microwavegun_zm'?'moon/wpn/microwave/rifle/plr/microwave_rifle_shot':def.id==='microwavegundw_zm'?'moon/wpn/microwave/dw/plr/microwave_shot':null;
    if(!key){
      const alias=def.sounds?.fireSound??def.sounds?.fireSoundPlayer,name=alias?.replace(/_plr$/,'');
      key=name&&Object.keys(this.manifest).find(k=>k.endsWith('/'+name)||k.endsWith('/'+name+'_00'))||null;
    }
    if(!key){
      const base=def.id.replace(/_zm$/,'').replace(/_acog|_lps|dw/g,'');
      key=Object.keys(this.manifest).find(k=>k.startsWith('moon/wpn/')&&k.includes('/'+base+'/')&&k.includes('/plr/shot/'))||null;
    }
    this.shotKeys.set(def.id,key);return key;
  }
  warmWeapon(def,notifies=[]){
    super.warmWeapon(def,notifies);
    const key=this.ctx&&this.shotKey(def);if(key)this.buffer(key).catch(()=>{});
  }
  weapon(kind,def,position=null,gain=1){
    if(kind==='shot'){const key=this.shotKey(def);if(key){this.play(key,.8*gain,position);return;}}
    super.weapon(kind,def,position,gain);
  }
  environment(env){
    if(!this.ctx)return;
    const key=env.lunar?(env.breathable?env.zone==='forest_zone'?'moon/evt/zombie_moon/amb/biodome_bg_l':/tower|forest_east/.test(env.zone??'')?'moon/evt/zombie_moon/amb/lab_bg_l':'moon/evt/zombie_moon/amb/airlock_bg_l':'moon/mus/zombie/moon/underscore_l'):null;
    if(key===this.ambientKey)return;this.ambientKey=key;const token=++this.ambientToken;this.ambient?.stop();this.ambient=null;
    if(key)this.native(key,.13,true).then(source=>{if(token!==this.ambientToken)source.stop();else this.ambient=source;}).catch(console.error);
  }
  reset(){this.musicToken++;this.music?.stop();this.music={stop(){}};this.ambientToken++;this.ambient?.stop();this.ambient=null;this.ambientKey=null;}
}
