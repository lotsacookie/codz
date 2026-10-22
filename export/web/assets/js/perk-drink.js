import { ViewWeapon } from './animation.js';

// Cache the four native viewmodels so a purchase never waits for asset loading.
export class PerkDrink {
  constructor(scene,data,audio){Object.assign(this,{scene,data,audio});this.views={};this.current=null;}
  async load(){await Promise.all(Object.entries(this.data.perkDrinks).map(async([id,def])=>{
    const view=new ViewWeapon(this.scene,this.data,(name,d)=>this.audio.notify(name,d));await view.equip(def);view.pivot.visible=false;this.views[id]=view;
  }));}
  start(id,weapon){
    this.stop();this.current=id;this.elapsed=0;this.weapon=weapon;weapon.pivot.visible=false;
    const view=this.views[id];view.mode='raise';view.aim=0;view.pivot.visible=true;
    view.rig.play('raiseAnim',false,view.clipSpeed('raiseAnim',view.def.raiseTime),0);view.rig.update(0);
    this.audio.event('perksacola/bottle/dispensemn_00',.7);
  }
  update(dt,session){
    if(!this.current)return;
    if(session.drinking!==this.current){this.stop();return;}
    const v=this.views[this.current],before=this.elapsed;this.elapsed+=dt;
    if(before<v.def.raiseTime&&this.elapsed>=v.def.raiseTime){v.rig.play('dropAnim',false,v.clipSpeed('dropAnim',v.def.dropTime),0);v.mode='drinkLower';}
    v.update(dt);this.weapon.pivot.visible=false;
  }
  stop(){
    if(!this.current)return;
    this.views[this.current].pivot.visible=false;this.current=null;
    if(this.weapon){this.weapon.pivot.visible=true;this.weapon.mode='raise';this.weapon.rig.play('raiseAnim',false,this.weapon.clipSpeed('raiseAnim',this.weapon.def.raiseTime),.04);}
  }
  snapshot(){return this.current?{perk:this.current,elapsed:this.elapsed,...this.views[this.current].snapshot()}:null;}
}
