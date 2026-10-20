import * as THREE from 'three';
import { loadModel } from './animation.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { registerWarm } from './load-flow.js';
import { cleanBoxMessage, packBoxStart } from './net/box-sync.js';

const cycleTime=3.9,offerTime=12;
export class MysteryBox {
  constructor(scene,world,data,session,audio,toast){Object.assign(this,{scene,world,data,session,audio,toast});this.boxes=new Map();this.models={};this.centers={};this.moves=0;this.uses=0;this.net=null;}
  attachNet(net){this.net=net;}
  isOwner(roll){return !this.net||!roll?.owner||roll.owner===this.net.selfId;}
  ownerLabel(roll){return roll?.owner&&this.net?this.net.nameOf(roll.owner):'Another player';}
  takeLabel(roll,name){return this.isOwner(roll)?'Take '+name:this.ownerLabel(roll)+"'s "+name;}
  boxFor(id){for(const [key,box] of this.boxes)if(String(key)===String(id))return box;return null;}
  receiveNet(from,raw){
    const message=cleanBoxMessage(raw);if(!message)return false;
    const b=this.boxFor(message.box);if(!b)return false;
    if(message.type==='take'){if(!b.roll||b.roll.owner!==from)return false;this.close(b);return true;}
    if(b.roll||b.closing)return false;
    const pool=message.pool.filter(k=>k!=='teddy'&&this.models[k]),weapon=this.models[message.weapon]&&message.weapon!=='teddy'?message.weapon:pool[0];
    if(!weapon||!pool.length)return false;
    const t=this.session.time;
    b.roll={weapon,ready:false,time:t+cycleTime,expires:t+cycleTime+offerTime,started:t,sale:message.sale,teddy:message.teddy,pool,dest:message.dest,owner:from};
    if(message.uses!==undefined)this.uses=message.uses;
    b.opening=0;this.world.openBoxes.add(b.id);this.world.updateBox();this.audio.event('box/open/open_00',1,b.display.position);this.audio.event('box/music_box/music_box_00',.7,b.display.position);return true;
  }
  async load(){
    await Promise.all(Object.entries(this.data.weapons).map(async([id,d])=>{this.models[id]=await loadModel(d.worldModel);}));
    if(this.data.equipment?.zombie_cymbal_monkey)this.models.zombie_cymbal_monkey=await loadModel(this.data.equipment.zombie_cymbal_monkey.projectileModel);
    this.models.teddy=await loadModel(this.data.boxTeddy);
    // Measure every display model once. Box3.setFromObject on a skinned mesh walks every vertex,
    // so doing it on each roll step (up to ~20 times a second) was the main source of the lag.
    for(const id of Object.keys(this.models))this.measure(id);
    registerWarm((renderer,scenes)=>this.warm(renderer,scenes));
    this.world.openBoxes=new Set();
    for(const e of this.world.boxLocations){
      const prefix=e.script_noteworthy,entity=this.data.entities.find(n=>n.targetname===prefix+'_org'),lidEntity=this.data.entities.find(n=>n.targetname===prefix+'_lid');
      const lid=this.world.entities.get(lidEntity?.id);if(!entity||!lid)continue;
      const display=new THREE.Group();display.position.fromArray(entity.position);display.rotation.y=entity.yaw+Math.PI/2;this.scene.add(display);
      const glow=new THREE.Mesh(new THREE.PlaneGeometry(65,22),new THREE.MeshBasicMaterial({color:0xd8eaff,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}));glow.rotation.x=-Math.PI/2;glow.position.y=12;display.add(glow);
      this.boxes.set(e.id,{id:e.id,entity:e,lid,closed:lid.quaternion.clone(),display,glow,roll:null,opening:0,closing:0,model:null,shown:null});
    }
  }
  available(e){const b=this.boxes.get(e.id);return !!b&&(e.id===this.world.activeBox.id||this.world.fireSale||!!b.roll);}
  at(e){return this.boxes.get(e.id)?.roll;}
  start(e){
    const b=this.boxes.get(e.id);if(!b||b.roll||b.closing)return false;
    const sale=this.session.effects.fire_sale>this.session.time;
    const pool=(this.data.boxPool??Object.keys(this.models)).filter(k=>k!=='teddy'&&this.models[k]&&!this.session.inventory.some(w=>w.id===k&&!w.lost)&&!(k==='zombie_cymbal_monkey'&&this.session.monkeysOwned));
    if(!pool.length)return false;
    if(!sale)this.uses++;
    const chance=this.uses<4?0:this.uses<8?.15:!this.moves?1:this.uses<13?.3:.5;
    const teddy=!sale&&this.world.boxLocations.length>1&&this.session.random()<chance;
    b.roll={weapon:pool[Math.floor(this.session.random()*pool.length)],ready:false,time:this.session.time+cycleTime,expires:this.session.time+cycleTime+offerTime,started:this.session.time,sale,teddy,pool};
    if(this.net){const choices=this.world.boxLocations.filter(l=>l.id!==this.world.activeBox.id);b.roll.dest=teddy?choices[Math.floor(this.session.random()*choices.length)]?.id:undefined;b.roll.owner=this.net.selfId;this.net.send(packBoxStart({box:b.id,roll:b.roll,uses:this.uses}));}
    b.opening=0;this.world.openBoxes.add(b.id);this.world.updateBox();this.audio.event('box/open/open_00',1,b.display.position);this.audio.event('box/music_box/music_box_00',.7,b.display.position);if(!teddy)this.onOffer?.(b.roll.weapon);return true;
  }
  take(e){
    const b=this.boxes.get(e.id);if(!b?.roll?.ready||b.roll.teddy)return null;
    if(!this.isOwner(b.roll)){this.toast(this.ownerLabel(b.roll)+' bought this weapon',3);return null;}
    const weapon=b.roll.weapon;this.close(b);this.net?.send({a:'take',b:b.id});return weapon;
  }
  measure(id){
    const source=this.models[id];if(!source)return null;
    const probe=clone(source);
    for(const name of this.data.weapons[id]?.hideTags??[]){const bone=probe.getObjectByName(name);if(bone)bone.scale.setScalar(.000001);}
    this.centers[id]=new THREE.Box3().setFromObject(probe).getCenter(new THREE.Vector3());
    return this.centers[id];
  }
  // Each box keeps one ready-made display per weapon, built the first time it is needed and then
  // only shown or hidden. Rolling through the pool no longer clones, measures or disposes anything.
  display_(b,id){
    b.cache??=new Map();
    let entry=b.cache.get(id);
    if(entry)return entry;
    const source=this.models[id];if(!source)return null;
    const model=clone(source);
    for(const name of this.data.weapons[id]?.hideTags??[]){const bone=model.getObjectByName(name);if(bone)bone.scale.setScalar(.000001);}
    model.position.sub(this.centers[id]??this.measure(id)??new THREE.Vector3());
    const float=new THREE.Group();float.add(model);float.visible=false;b.display.add(float);
    entry={model,float};b.cache.set(id,entry);return entry;
  }
  show(b,id){
    if(b.shown===id)return;
    if(b.wrapper)b.wrapper.visible=false;
    b.shown=id;
    const entry=this.display_(b,id);
    if(!entry){b.model=null;b.wrapper=null;return;}
    b.model=entry.model;b.wrapper=entry.float;b.float=entry.float;b.wrapper.visible=true;
  }
  hide(b){if(b.wrapper)b.wrapper.visible=false;b.wrapper=null;b.model=null;b.float=null;b.shown=null;}
  fill(){
    if(!this.queue){
      const active=this.world.activeBox?.id,order=[...this.boxes.values()].sort((a,b)=>(b.id===active)-(a.id===active));
      this.queue=[];for(const b of order)for(const id of Object.keys(this.models))this.queue.push([b,id]);this.queue.reverse();
    }
    while(this.queue.length){const [b,id]=this.queue.pop();if(!b.cache?.has(id)){this.display_(b,id);return;}}
  }
  close(b){b.roll=null;b.closing=.5;this.hide(b);this.audio.event('box/close/close_00',.8,b.display.position);}
  // Compile shaders and upload textures for every display model behind the loading screen.
  async warm(renderer,scenes){
    const holders=[],culled=[];
    try{
      for(const b of this.boxes.values())for(const id of Object.keys(this.models)){const e=this.display_(b,id);if(e){e.float.visible=true;holders.push(e.float);}}
      for(const f of holders)f.traverse(o=>{if(o.frustumCulled){o.frustumCulled=false;culled.push(o);}});
      for(const [scene,camera] of scenes.slice(0,1)){
        await Promise.race([renderer.compileAsync(scene,camera),new Promise(r=>setTimeout(r,6000))]);
        renderer.render(scene,camera);
      }
      const seen=new Set();
      for(const f of holders)f.traverse(o=>{for(const m of [o.material].flat())if(m)for(const v of Object.values(m))if(v?.isTexture&&!seen.has(v.source)){seen.add(v.source);renderer.initTexture(v);}});
    }catch(error){console.warn('Mystery box pre-warm skipped',error);}
    finally{for(const o of culled)o.frustumCulled=true;for(const f of holders)f.visible=false;}
  }
  update(dt){
    const sale=this.session.effects.fire_sale>this.session.time;
    if(this.world.fireSale!==sale){this.world.fireSale=sale;this.world.updateBox();this.audio.fireSale(sale);}
    let busy=false;
    for(const b of this.boxes.values()){
      if(b.roll){
        busy=true;
        const r=b.roll,age=this.session.time-r.started;b.opening=Math.min(.5,b.opening+dt);
        if(this.session.time>=r.time&&!r.ready){r.ready=true;this.show(b,r.teddy?'teddy':r.weapon);this.toast(r.teddy?'The Mystery Box is moving…':this.isOwner(r)?(this.data.weapons[r.weapon]??this.data.equipment[r.weapon]).name+' — press F to take':this.ownerLabel(r)+"'s "+(this.data.weapons[r.weapon]??this.data.equipment[r.weapon]).name,4);
          if(r.teddy){if(this.isOwner(r))this.session.points+=950;this.audio.event('box/whoosh/whoosh_00',1,b.display.position);}}
        if(!r.ready){const step=age<1?Math.floor(age/.05):age<2?20+Math.floor((age-1)/.1):age<3?30+Math.floor((age-2)/.2):35+Math.floor((age-3)/.3);this.show(b,r.pool[step%r.pool.length]);}
        if(b.wrapper){const sink=THREE.MathUtils.clamp((this.session.time-r.time)/offerTime,0,1);b.wrapper.position.y=r.teddy&&r.ready?40+Math.max(0,this.session.time-r.time-1)*80:r.ready?40*(1-sink*sink*(3-2*sink)):Math.min(64,age/3*64);}
        if(r.teddy&&this.session.time>r.time+5){this.close(b);this.moves++;this.uses=0;const choices=this.world.boxLocations.filter(e=>e.id!==this.world.activeBox.id);this.world.activeBox=(r.dest!==undefined&&this.world.boxLocations.find(l=>String(l.id)===String(r.dest)))||choices[Math.floor(this.session.random()*choices.length)];this.world.updateBox();this.toast('The Mystery Box has moved');}
        else if(this.session.time>r.expires)this.close(b);
      }
      if(b.closing){b.closing=Math.max(0,b.closing-dt);b.opening=b.closing;if(!b.closing){this.world.openBoxes.delete(b.id);this.world.updateBox();}}
      const t=b.opening/.5,angle=t*t*(3-2*t)*105*Math.PI/180;
      b.lid.quaternion.copy(b.closed).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),angle));b.glow.material.opacity=t*.2;
    }
    if(!busy)this.fill();
  }
  reset(){for(const b of this.boxes.values()){b.roll=null;b.opening=b.closing=0;this.hide(b);b.lid.quaternion.copy(b.closed);b.glow.material.opacity=0;}this.moves=this.uses=0;this.world.openBoxes.clear();this.world.fireSale=false;this.world.updateBox();this.audio.fireSale(false);}
  snapshot(){return [...this.boxes.values()].map(b=>({id:b.id,open:b.opening/.5,shown:b.shown,roll:b.roll?{weapon:b.roll.weapon,ready:b.roll.ready,teddy:b.roll.teddy,time:b.roll.time,expires:b.roll.expires}:null}));}
}
