import * as THREE from 'three';
import { loadModel } from './animation.js';
import { POWERUP_LIFETIME, powerupVisible } from './rules.js';
import { cleanDrop, cleanGrab, cleanTake, packDrop, packGrab, packTake } from './net/powerup-sync.js';

// Native pickup meshes with a browser rendition of fx_zombie_powerup_on/grab.
export class Powerups {
  constructor(scene,data,audio,onCollect){Object.assign(this,{scene,data,audio,onCollect});this.items=[];this.bursts=[];this.templates={};this.net=null;this.nextId=1;
    const size=64,pixels=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4,r=Math.hypot(x-31.5,y-31.5)/31.5;pixels.set([180,255,105,Math.round(255*Math.pow(Math.max(0,1-r),2.5))],i);}
    this.texture=new THREE.DataTexture(pixels,size,size);this.texture.needsUpdate=true;
    this.spriteMaterial=new THREE.SpriteMaterial({map:this.texture,color:0x43ee0c,transparent:true,opacity:.6,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
  }
  async load(){await Promise.all(Object.entries(this.data.powerups).map(async([type,def])=>{
    const model=await loadModel(def.model);model.traverse(o=>{if(!o.isMesh)return;o.frustumCulled=false;
      const tune=m=>{const c=m.clone();c.color.setHex(0x9e761d);c.emissive.setHex(0x362305);c.emissiveIntensity=.35;c.roughness=.38;return c;};o.material=Array.isArray(o.material)?o.material.map(tune):tune(o.material);
    });this.templates[type]=model;
  }));}
  attachNet(net){this.net=net;}
  localArea(){return String(this.net?.area?.()??'').slice(0,24);}
  spawn(type,position,remote=null){
    if(!this.templates[type])return null;
    if(this.net&&!remote&&this.net.role!=='host')return null;
    if(remote&&this.items.some(p=>p.id===remote.id))return null;
    const root=new THREE.Group(),model=this.templates[type].clone(true),aura=new THREE.Sprite(this.spriteMaterial);aura.scale.set(94,94,1);root.add(aura,model);
    const motes=[];for(let i=0;i<9;i++){const p=new THREE.Sprite(this.spriteMaterial);p.scale.setScalar(10);root.add(p);motes.push(p);}
    root.position.copy(position).y+=40;this.scene.add(root);
    const item={type,id:remote?remote.id:this.nextId++,root,model,aura,motes,age:0,from:new THREE.Quaternion(),to:new THREE.Quaternion(),turn:0,duration:0};this.items.push(item);
    if(this.net&&!remote)this.net.send('pdrop',packDrop({id:item.id,type,position,area:this.localArea()}));
    this.audio.event('powerup/spawn/spawn_00',.65);return item;
  }
  claim(p){
    if(this.net.role==='host'){this.resolve(p,this.net.selfId);return;}
    if(p.asked!==undefined&&p.age-p.asked<1.5)return;
    const host=this.net.hostId?.();
    if(!host)return;
    p.asked=p.age;
    this.net.send('ptake',packTake(p.id),host);
  }
  resolve(p,by){
    const position=p.root.position.clone();
    this.remove(p);this.burst(position);
    this.net.send('pgrab',packGrab({id:p.id,type:p.type,position,by}));
    this.onCollect(p.type,position,{by,mine:by===this.net.selfId,host:true});
  }
  receiveNet(type,from,raw){
    if(!this.net)return false;
    const host=this.net.hostId?.();
    if(type==='pdrop'){
      if(!from||from!==host)return false;
      const drop=cleanDrop(raw);
      if(!drop||drop.area!==this.localArea())return false;
      return !!this.spawn(drop.type,new THREE.Vector3(drop.position.x,drop.position.y,drop.position.z),{id:drop.id});
    }
    if(type==='ptake'){
      if(this.net.role!=='host')return false;
      const take=cleanTake(raw),item=take&&this.items.find(p=>p.id===take.id);
      if(!item)return false;
      this.resolve(item,from);return true;
    }
    if(type==='pgrab'){
      if(!from||from!==host)return false;
      const grab=cleanGrab(raw);
      if(!grab)return false;
      const item=this.items.find(p=>p.id===grab.id),position=new THREE.Vector3(grab.position.x,grab.position.y,grab.position.z);
      if(item)this.remove(item);
      this.burst(position);
      this.onCollect(grab.type,position,{by:grab.by,mine:grab.by===this.net.selfId,host:false});
      return true;
    }
    return false;
  }
  burst(position){const sprite=new THREE.Sprite(this.spriteMaterial.clone());sprite.position.copy(position);this.scene.add(sprite);this.bursts.push({sprite,age:0});}
  update(dt,feet,canCollect=true,lineClear=()=>true){
    for(const p of [...this.items]){
      p.age+=dt;p.turn+=dt;
      if(p.turn>=p.duration){p.from.copy(p.model.quaternion);p.to.setFromEuler(new THREE.Euler((Math.random()-.5)*2.1,Math.random()*Math.PI*2,(Math.random()-.5)*1.57));p.duration=2.5+Math.random()*2.5;p.turn=0;}
      const t=p.turn/p.duration;p.model.quaternion.slerpQuaternions(p.from,p.to,t*t*(3-2*t));p.model.visible=powerupVisible(p.age);
      p.aura.scale.setScalar(88+Math.sin(p.age*3)*7);
      p.motes.forEach((m,i)=>{const a=p.age*1.4+i*2.4;m.position.set(Math.cos(a)*(16+i%3*4),((p.age*24+i*7)%65)-30,Math.sin(a)*(16+i%3*4));});
      if(p.age>=POWERUP_LIFETIME){this.remove(p);continue;}
      if(canCollect&&feet.distanceTo(p.root.position)<64&&lineClear(feet.clone().add(new THREE.Vector3(0,40,0)),p.root.position)){
        if(this.net){this.claim(p);continue;}
        const position=p.root.position.clone();this.remove(p);this.burst(position);this.onCollect(p.type,position);
      }
    }
    for(const b of [...this.bursts]){b.age+=dt;b.sprite.scale.setScalar(30+b.age*240);b.sprite.material.opacity=Math.max(0,1-b.age*1.8);if(b.age>.6){b.sprite.removeFromParent();b.sprite.material.dispose();this.bursts.splice(this.bursts.indexOf(b),1);}}
  }
  remove(p){p.root.removeFromParent();this.items.splice(this.items.indexOf(p),1);}
  reset(){for(const p of [...this.items])this.remove(p);for(const b of this.bursts){b.sprite.removeFromParent();b.sprite.material.dispose();}this.bursts=[];}
  snapshot(){return this.items.map(p=>({id:p.id,type:p.type,model:this.data.powerups[p.type].model,position:p.root.position.toArray(),age:p.age,life:POWERUP_LIFETIME-p.age,visible:p.model.visible}));}
}
