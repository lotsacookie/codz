import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { assetManager, disposeSkeletons } from './runtime-assets.js';
import { assets, rfetch } from './asset-loader.js';
import { CameraEffects } from './camera-effects.js';
import { MuzzleSmoke, createMuzzleFlash } from './muzzle-fx.js';
import { weaponFxProfile } from './fx-profile.js';

const loader=new GLTFLoader(assetManager), models=new Map(), clips=new Map();
export async function loadModel(url){if(!url)return null;if(!models.has(url))models.set(url,assets.buffer(url).then(bytes=>loader.parseAsync(bytes,THREE.LoaderUtils.extractUrlBase(assets.abs(url)))).then(gltf=>gltf.scene));return clone(await models.get(url));}
export async function releaseModelCache(){
  const pending=[...models.values()];models.clear();clips.clear();
  for(const entry of pending){
    let scene;try{scene=await entry;}catch{continue;}
    scene.traverse(o=>{o.geometry?.dispose();for(const m of [o.material].flat())if(m){for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose();}});
  }
}
export async function loadAnimation(url){if(!clips.has(url))clips.set(url,rfetch(url).then(r=>{if(!r.ok)throw new Error('Animation '+url+': '+r.status);return r.json();}));return clips.get(url);}
const IDENTITY=new THREE.Quaternion();
// Bones of the gun model hang under tag_weapon (or tag_weapon1 for a left-hand gun); knives under tag_knife_attach.
function isGunBone(node){for(let p=node.parent;p;p=p.parent){if(p.name==='tag_knife_attach')return false;if(p.name==='tag_weapon'||p.name==='tag_weapon1')return true;}return false;}
function noteAnchored(options,name){options.anchored??=new Set();if(!options.anchored.has(name)){options.anchored.add(name);console.info('[viewmodel] anchored keyed offsets to rest pose:',name);}}
export function makeClip(root, data, locomotion=false, options={}){
  const tracks=[];const nodes=new Map();
  root.traverse(n=>{if(!nodes.has(n.name))nodes.set(n.name,[]);nodes.get(n.name).push(n);});
  for(const b of data.bones){
    if(b.name==='tag_origin'||b.name==='tag_sync')continue;
    for(const node of nodes.get(b.name)??[]){
      if(node.userData.animationAnchor)continue;
      const gun=isGunBone(node);
      if(b.rot){
        let rot=b.rot.values;
        // Some gun bones (the magazine tag, the slide) are keyed as offsets from rest: their first key is the
        // identity. Applied as absolute values they replace the bone's real rest rotation, so keep the keyed
        // motion but compose it onto the rest rotation. A no-op when the rest rotation is already identity.
        if(gun&&b.rot.values.length>=4){
          const first=new THREE.Quaternion().fromArray(b.rot.values,0);
          if(first.angleTo(IDENTITY)<.05&&node.quaternion.angleTo(IDENTITY)>.05){
            rot=b.rot.values.slice();const q=new THREE.Quaternion();
            for(let i=0;i<rot.length;i+=4){q.fromArray(rot,i);q.premultiply(node.quaternion).toArray(rot,i);}
            noteAnchored(options,b.name+'.rot');
          }
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(node.uuid+'.quaternion',b.rot.frames.map(f=>f/data.fps),rot));
      }
      if(b.pos){
        const values=b.pos.values.slice();
        // Gun bones such as the magazine tag and the slide are keyed as offsets that start at ~0 (rest). Applied
        // as absolute values they snap the bone to its parent's origin instead of its real rest position, which
        // dropped the slide and left every gun's magazine out of its well and out of the hand. Keep the keyed
        // motion and anchor it to the bone's rest position. A no-op when the rest position is already ~0.
        if(gun&&values.length>=3&&Math.hypot(values[0],values[1],values[2])<.01&&node.position.length()>.05){
          const rest=node.position;
          for(let i=0;i<values.length;i+=3){values[i]+=rest.x;values[i+1]+=rest.y;values[i+2]+=rest.z;}
          noteAnchored(options,b.name+'.pos');
        }
        // T5 locomotion stores j_mainroot translations as displacement from
        // the bind pelvis, unlike the absolute viewmodel pose tracks.
        if(locomotion&&b.name==='j_mainroot')for(let i=0;i<values.length;i+=3){values[i]=node.position.x;values[i+1]=node.position.y;values[i+2]+=node.position.z;}
        tracks.push(new THREE.VectorKeyframeTrack(node.uuid+'.position',b.pos.frames.map(f=>f/data.fps),values));
      }
    }
  }
  return new THREE.AnimationClip(data.name,Math.max(1/data.fps,data.duration),tracks);
}
export class Rig {
  constructor(root,onNotify=()=>{}){this.root=root;this.mixer=new THREE.AnimationMixer(root);this.actions={};this.data={};this.options={};this.current=null;this.onNotify=onNotify;this.elapsed=0;}
  add(key,data,locomotion=false){this.data[key]=data;this.actions[key]=this.mixer.clipAction(makeClip(this.root,data,locomotion,this.options));}
  play(key,loop=true,speed=1,fade=.1){
    const a=this.actions[key];if(!a)return false;if(this.current===key&&loop)return true;
    const old=this.actions[this.current];
    // Fading a short firing action into itself erased most of its recoil.
    if(old&&old!==a){if(fade)old.fadeOut(fade);else old.stop();}
    a.stop().reset().setEffectiveWeight(1).setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);
    a.clampWhenFinished=!loop;a.timeScale=speed;if(fade)a.fadeIn(fade);a.play();this.current=key;this.elapsed=-1e-6;return true;
  }
  update(dt){
    const action=this.actions[this.current],data=this.data[this.current],before=this.elapsed;
    if(action){this.elapsed+=dt*action.timeScale;for(const n of data.notifies??[])if(n.time>before&&n.time<=this.elapsed)this.onNotify(n.name,this.current);}
    this.mixer.update(dt);
  }
}

const basis=new THREE.Matrix4().makeBasis(new THREE.Vector3(0,0,-1),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0));
export class ViewWeapon {
  constructor(scene,data,onSound=()=>{}){
    this.scene=scene;this.data=data;this.onSound=onSound;this.pivot=new THREE.Group();scene.add(this.pivot);
    this.token=0;this.currentId=null;this.recoil=0;this.aim=0;this.mode='idle';this.meleeLeft=0;this.sprintBlend=0;
    this.cameraFx=new CameraEffects();this.smoke=null;this.flashes=[];this.pendingFx=null;
  }
  async equip(def){
    const key=def.id+(def.upgraded?':upgraded':'')+(def.attachmentActive?':attachment':'');
    if(this.currentId===key&&this.ready)return;this.currentId=key;this.ready=false;const token=++this.token;
    this.pivot.visible=false;
    const [hands,gun,leftGun,...knives]=await Promise.all([
      loadModel(def.handsModel??this.data.characters.viewmodel_usa_pow_arms??this.data.characters.viewhands_usmc),loadModel(def.model),
      def.leftModel?loadModel(def.leftModel):Promise.resolve(null),
      ...Object.values(this.data.melee).map(d=>loadModel(d.model))]);
    const entries=await Promise.all(Object.entries(def.animations).map(async([key,url])=>[key,await loadAnimation(url)]));
    if(def.leftAnimations){
      const left=new Map(await Promise.all(Object.entries(def.leftAnimations).filter(([key])=>key.endsWith('AnimLeft')).map(async([key,url])=>[key,await loadAnimation(url)])));
      const right=new Map(entries),combine=(a,b,name)=>a&&b?{...a,name,duration:Math.max(a.duration,b.duration),bones:[...a.bones,...b.bones.filter(n=>!a.bones.some(r=>r.name===n.name))]}:a;
      for(const [key,clip]of right){const l=(key.startsWith('reload')?left.get('reloadAnimLeft'):left.get('idleAnimLeft'));if(l&&['idleAnim','fireAnim','lastShotAnim','reloadAnim','reloadEmptyAnim'].includes(key))entries.push([key,combine(clip,l,clip.name+'-dual')]);}
      if(left.has('fireAnimLeft'))entries.push(['leftFireAnim',combine(left.get('fireAnimLeft'),right.get('idleAnim'),'dual-left-fire')]);
    }
    const meleeEntries=await Promise.all(Object.entries(this.data.melee).flatMap(([type,d])=>
      Object.entries(d.animations).filter(([k])=>k.startsWith('melee')).map(async([key,url])=>[type+':'+key,await loadAnimation(url)])));
    if(token!==this.token){for(const model of [hands,gun,leftGun,...knives])disposeSkeletons(model);return;}
    if(this.rig)this.rig.mixer.uncacheRoot(this.rig.root);
    disposeSkeletons(this.root);
    if(!hands||!gun)throw new Error('Missing viewmodel for '+def.id);
    this.def=def;this.pivot.clear();this.pivot.position.set(0,0,0);this.pivot.rotation.set(0,0,0);
    // Assemble outside the scene. Using matrixWorld under the previous gun's
    // ADS/recoil pivot baked that pose into every subsequent weapon attachment.
    this.root=new THREE.Group();this.root.add(hands);this.gun=gun;this.hands=hands;
    const view=hands.getObjectByName('tag_view'),tag=hands.getObjectByName('tag_weapon');
    if(!view||!tag)throw new Error('Missing viewmodel attachment bones');
    view.userData.animationAnchor=true;
    this.root.updateMatrixWorld(true);
    const cameraBasis=new THREE.Matrix4().multiplyMatrices(basis,view.matrixWorld.clone().invert());
    const attach=(model,parent,boneName)=>{
      model.updateMatrixWorld(true);
      let bone=model.getObjectByName(boneName);model.traverse(n=>{if(!bone&&n.isBone)bone=n;});
      if(!bone)throw new Error('Missing attachment root '+boneName);
      bone.userData.animationAnchor=true;
      model.matrixAutoUpdate=false;model.matrix.copy(bone.matrixWorld).invert();parent.add(model);
    };
    attach(gun,tag,'j_gun');
    this.leftGun=leftGun;
    if(leftGun){const leftTag=hands.getObjectByName('tag_weapon1');if(leftTag)attach(leftGun,leftTag,leftGun.getObjectByName('j_gun1')?'j_gun1':'j_gun');}
    for(const flash of this.flashes)flash?.dispose();
    this.pendingFx=null;
    this.flashes=[gun.getObjectByName('tag_flash'),leftGun?(leftGun.getObjectByName('tag_flash1')??leftGun.getObjectByName('tag_flash')):null].map(tag=>tag?createMuzzleFlash(tag):null);
    // Bottles animate j_gun relative to tag_weapon throughout opening/drinking.
    // Freezing that root leaves the bottle behind while the hands move away.
    if(def.id.startsWith('zombie_perk_bottle_')){gun.getObjectByName('j_gun').userData.animationAnchor=false;gun.matrix.identity();}
    this.knives={};const knifeTag=hands.getObjectByName('tag_knife_attach');
    if(knifeTag)Object.keys(this.data.melee).forEach((type,i)=>{attach(knives[i],knifeTag,'tag_knife');knives[i].visible=false;this.knives[type]=knives[i];});
    this.hiddenTags=[];
    for(const name of def.hideTags??[]){const bone=gun.getObjectByName(name);if(bone){bone.scale.setScalar(.000001);this.hiddenTags.push(name);}}
    this.root.matrixAutoUpdate=false;this.root.matrix.copy(cameraBasis);this.pivot.add(this.root);
    this.rig=new Rig(this.root,(name)=>this.onSound(name,this.meleeType?this.data.melee[this.meleeType]:this.def));
    this.rig.options={};
    for(const [key,clip] of [...entries,...meleeEntries])this.rig.add(key,clip);
    // ADS is a separate native animation of tag_torso. Its first frame also
    // defines each gun's HIP pose; the arms' bind torso is only right for M1911.
    const aimData=entries.find(([key])=>key==='adsUpAnim')?.[1];
    this.aimTracks=[];this.aimDuration=aimData?.duration??0;
    for(const b of aimData?.bones??[]){const node=hands.getObjectByName(b.name);if(!node)continue;
      if(b.pos)this.aimTracks.push({node,property:'position',sample:new THREE.VectorKeyframeTrack('',b.pos.frames.map(f=>f/aimData.fps),b.pos.values).createInterpolant()});
      if(b.rot)this.aimTracks.push({node,property:'quaternion',sample:new THREE.QuaternionKeyframeTrack('',b.rot.frames.map(f=>f/aimData.fps),b.rot.values).createInterpolant()});
    }
    this.aim=0;this.recoil=0;this.meleeLeft=0;this.meleeType=null;this.sprintBlend=0;this.applyAim();
    this.rig.play('idleAnim',true,1,0);this.rig.update(0);
    this.mode=this.rig.play('raiseAnim',false,this.clipSpeed('raiseAnim',def.raiseTime),.04)?'raise':'idle';
    this.root.traverse(o=>{o.frustumCulled=false;});
    this.ready=true;this.pivot.visible=true;
  }
  clipSpeed(key,duration){return duration>0?(this.rig.data[key]?.duration??duration)/duration:1;}
  applyAim(restOnly=false){
    for(const t of this.aimTracks){
      const b=this.rig.data[this.rig.current]?.bones.find(b=>b.name===t.node.name);
      if(restOnly&&b?.[t.property==='position'?'pos':'rot'])continue;
      t.node[t.property].fromArray(t.sample.evaluate(restOnly?0:this.aim*this.aimDuration));
    }
  }
  shoot({ads=false,empty=false,hand='right'}={}){
    if(!this.ready||this.meleeLeft>0)return;
    let key=ads?(empty?'adsLastShotAnim':'adsFireAnim'):(empty?'lastShotAnim':'fireAnim');
    if(hand==='left'&&this.rig.actions.leftFireAnim)key='leftFireAnim';
    if(!this.rig.actions[key])key='fireAnim';this.recoil=1;this.mode='fire';this.rig.play(key,false,1,0);
    const profile=weaponFxProfile(this.def);
    if(profile){
      const index=hand==='left'&&this.flashes[1]?1:0;
      this.cameraFx.fire();this.flashes[index]?.fire(profile,ads);this.pendingFx={profile,ads,index};
    }
  }
  reload(empty,duration,stage='magazine'){
    if(!this.ready)return;const key=stage==='start'?'reloadStartAnim':stage==='end'?'reloadEndAnim':empty&&this.rig.actions.reloadEmptyAnim?'reloadEmptyAnim':'reloadAnim';
    this.mode='reload';this.aim=0;this.rig.play(key,false,this.clipSpeed(key,duration),.06);
    this.cameraFx.reload(duration,stage,empty);
  }
  melee(type='knife',charge=false){
    if(!this.ready||this.meleeLeft>0)return null;
    if(this.def.melee){
      const d=this.def.melee,key=charge?'meleeChargeAnim':'meleeAnim',duration=Math.max(charge?d.meleeChargeTime:d.meleeTime,this.rig.data[key]?.duration??0);
      this.meleeType=null;this.meleeLeft=duration;this.mode='melee';this.aim=0;this.rig.play(key,false,this.clipSpeed(key,duration),0);
      const delay=charge?d.meleeChargeDelay:d.meleeDelay;this.cameraFx.melee(duration,delay);
      return {duration,delay,damage:d.meleeDamage};
    }
    const def=this.data.melee[type],key=type+':'+(charge?'meleeChargeAnim':'meleeAnim');
    const duration=Math.max(charge?def.chargeTime:def.time,this.rig.data[key].duration);
    this.meleeType=type;this.meleeLeft=duration;this.mode='melee';this.aim=0;
    for(const [k,model] of Object.entries(this.knives))model.visible=k===type;
    this.rig.play(key,false,this.clipSpeed(key,duration),0);
    const delay=charge?def.chargeDelay:def.delay;this.cameraFx.melee(duration,delay);
    return {duration,delay,damage:def.damage};
  }
  lookBase(camera){return this.cameraFx.lookBase(camera);}
  updateFx(dt,camera){
    if(camera)this.cameraFx.apply(camera,dt);
    for(const flash of this.flashes)flash?.update(dt);
    this.smoke?.update(dt);
  }
  emitFx(camera,viewCamera,worldScene){
    const fx=this.pendingFx;if(!fx||!camera||!viewCamera||!worldScene)return;
    this.pendingFx=null;
    const flash=this.flashes[fx.index]??this.flashes[0];
    const ndc=flash?flash.ndc(viewCamera):new THREE.Vector3(.2,-.14,0);
    if(!this.smoke||this.smoke.scene!==worldScene){this.smoke?.dispose();this.smoke=new MuzzleSmoke(worldScene);}
    this.smoke.emit(ndc,camera,fx.profile,fx.ads);
  }
  update(dt,{moving=false,sprint=false,ads=false,reloading=false,empty=false,time=0,look=null,camera=null,viewCamera=null,worldScene=null}={}){
    this.updateFx(dt,camera);
    if(!this.ready)return;
    this.rig.update(dt);this.meleeLeft=Math.max(0,this.meleeLeft-dt);
    const action=this.rig.actions[this.rig.current],finished=!action?.isRunning();
    const sprintKey=phase=>{const key='sprint'+phase+(empty?'Empty':'')+'Anim';return this.rig.actions[key]?key:'sprint'+phase+'Anim';};
    if(this.mode==='melee'&&this.meleeLeft===0){for(const model of Object.values(this.knives))model.visible=false;this.meleeType=null;this.mode='idle';}
    if(this.mode==='reload'&&!reloading)this.mode='idle';
    if(['fire','raise','sprintOut'].includes(this.mode)&&finished)this.mode='idle';
    if(this.mode==='sprintIn'&&finished){this.mode='sprint';this.rig.play(sprintKey('Loop'),true,this.clipSpeed(sprintKey('Loop'),this.def.sprintLoopTime),.04);}
    if(['idle','fire'].includes(this.mode)&&sprint){this.mode='sprintIn';if(!this.rig.play(sprintKey('In'),false,this.clipSpeed(sprintKey('In'),this.def.sprintInTime),.06)){this.mode='sprint';this.rig.play(this.rig.actions[sprintKey('Loop')]?sprintKey('Loop'):'idleAnim');}}
    if(['sprint','sprintIn'].includes(this.mode)&&!sprint){this.mode='sprintOut';if(!this.rig.play(sprintKey('Out'),false,this.clipSpeed(sprintKey('Out'),this.def.sprintOutTime),.04))this.mode='idle';}
    if(this.mode==='idle')this.rig.play(empty&&this.rig.actions.emptyIdleAnim?'emptyIdleAnim':'idleAnim',true,1,.06);
    const aiming=ads&&['idle','fire'].includes(this.mode);
    this.aim=THREE.MathUtils.clamp(this.aim+(aiming?dt/Math.max(.01,this.def.adsInTime):-dt/Math.max(.01,this.def.adsOutTime)),0,1);
    this.applyAim(!['idle','fire'].includes(this.mode));
    this.recoil=Math.max(0,this.recoil-dt*8);
    const bob=moving&&this.mode!=='melee'?(1-this.aim)*.13:0;
    this.pivot.position.set(Math.sin(time*(sprint?13:9))*bob,Math.cos(time*(sprint?26:18))*bob*.7,this.recoil*.25);
    this.pivot.rotation.set(this.recoil*.012,0,0);
    // Ray Gun uses authored weapon offsets in place of sprint XAnims.
    const offsetSprint=sprint&&!this.rig.actions.sprintLoopAnim&&this.mode==='sprint';
    this.sprintBlend=THREE.MathUtils.damp(this.sprintBlend,offsetSprint?1:0,16,dt);
    if(this.sprintBlend>.001){this.pivot.position.addScaledVector(new THREE.Vector3(...this.def.sprintOffset),this.sprintBlend);const r=this.def.sprintRotation;this.pivot.rotation.set(r[0]*this.sprintBlend,r[1]*this.sprintBlend,r[2]*this.sprintBlend);}
    const swayScale=1-this.aim*.7,safeDt=Math.max(dt,1e-3);
    const yawRate=THREE.MathUtils.clamp((look?.yaw??0)/safeDt,-12,12),pitchRate=THREE.MathUtils.clamp((look?.pitch??0)/safeDt,-12,12);
    this.swayYaw=THREE.MathUtils.damp(this.swayYaw??0,-yawRate*.011*swayScale,7,dt);
    this.swayPitch=THREE.MathUtils.damp(this.swayPitch??0,-pitchRate*.011*swayScale,7,dt);
    this.pivot.rotation.y+=this.swayYaw;this.pivot.rotation.x+=this.swayPitch;
    this.pivot.rotation.z+=this.swayYaw*.5;
    this.pivot.position.x+=this.swayYaw*.5;this.pivot.position.y+=this.swayPitch*.35;
    this.root.updateMatrixWorld(true);
    this.emitFx(camera,viewCamera,worldScene);
  }
  snapshot(){
    const position=name=>this.root?.getObjectByName(name)?.getWorldPosition(new THREE.Vector3()).toArray();
    return {ready:this.ready,id:this.currentId,hiddenTags:this.hiddenTags??[],mode:this.mode,animation:this.rig?.current,
      time:this.rig?.actions[this.rig.current]?.time,aim:this.aim,melee:this.meleeType,meleeLeft:this.meleeLeft,
      knifeVisible:Object.entries(this.knives??{}).filter(([,m])=>m.visible).map(([k])=>k),
      gun:position('j_gun'),knife:position('tag_knife_attach'),torso:this.hands?.getObjectByName('tag_torso')?.position.toArray()};
  }
}
