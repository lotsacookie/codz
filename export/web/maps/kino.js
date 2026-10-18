import * as THREE from 'three';
import { PlayerController } from '../player-controller.js';
import { World, vector, zoneNames } from '../world.js';
import { ViewWeapon } from '../animation.js';
import { Enemies } from '../enemies.js';
import { KinoSession as Session } from '../kino-session.js';
import { KinoFeatures } from '../kino-features.js';
import { GameAudio } from '../audio.js';
import { Powerups } from '../powerups.js';
import { PerkDrink } from '../perk-drink.js';
import { MysteryBox } from '../mystery-box.js';
import { createZombieTouch } from '../zombies-touch.js';
import { ChalkHud, powerupVisible, spawnScorePopup, bo1Prompt, renderAmmoIcons } from '../hud.js';
import { TheaterLighting, pickLightLevels, SHADOW_BACKOFF, SHADOW_CASCADES } from '../lighting.js';
import { AutoGraphics, gpuName } from '../graphics.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { BloodFx } from '../blood.js';
import { WallImpacts, fadeParticle } from '../impact-fx.js';
import { configureKinoAssets, assetDiagnostics } from '../runtime-assets.js';
import { assets, rfetch } from '../asset-loader.js';
import { preloadShared } from '../shared-assets.js';
import { ensureTextures as sharedEnsureTextures, prewarm as sharedPrewarm, kinoPack } from '../load-flow.js';
import { smoothingEnabled } from '../steering.js';
import { AdaptiveResolution, createPerfOverlay } from '../quality.js';
import { GradePass } from '../grade.js';
import { OcclusionCuller } from '../occlusion.js';
import { THEATER_FOG, THEATER_WORLD, fogDensityFromHalfDistance, sunTravelDirection, verticalFovFromCgFov } from '../vision.js';
import { disposeObject } from '../dispose.js';

export async function mount(ctx){
const CONTROLS='WASD · Move   Mouse · Fire / Aim   Shift · Sprint\nSpace · Jump   Ctrl / C · Crouch   F / E · Interact\nR · Reload   V · Knife   G · Grenade   1 / 2 / Q · Weapon\n4 · Claymore   X · Monkey Bomb   5 · Alt fire   M · Sound   Esc · Pause';
const addEventListener=(type,handler,options)=>ctx.listen(window,type,handler,options);let disposed=false;
const $=id=>document.getElementById(id), keys=new Set(),audio=new GameAudio();
const chalk=new ChalkHud();let lastPoints=null,perkKey='';
const perkIcons={specialty_quickrevive:'specialty_quickrevive_zombies',specialty_fastreload:'specialty_fastreload_zombies',specialty_rof:'specialty_doubletap_zombies',specialty_armorvest:'specialty_juggernaut_zombies'};
const profile=configureKinoAssets();
audio.maxBufferBytes=profile.mobile?16*1024*1024:Infinity;audio.preload=!profile.mobile;
const gradeOn=!profile.mobile&&!/[?&]grade=0\b/.test(location.search);
const graphics=ctx.useGraphics();
profile.shadows=!profile.mobile&&!/[?&]shadows=0\b/.test(location.search);
const renderer=new THREE.WebGLRenderer({antialias:!profile.mobile&&!gradeOn,powerPreference:profile.mobile?'default':'high-performance'});
const basePixelRatio=Math.min(devicePixelRatio,profile.mobile?1:2),adapt=new AdaptiveResolution({min:profile.mobile?.6:.65,targetMs:profile.mobile?1000/30:1000/60,enabled:!/[?&]adaptive=0\b/.test(location.search)}),perf=createPerfOverlay();
const noFxQuery=/[?&]fx=0\b/.test(location.search);if(noFxQuery)document.body.classList.add('no-fx');
graphics.assessGpu(gpuName(renderer.getContext()));
const ratio=()=>basePixelRatio*graphics.preset.resolution;
renderer.setPixelRatio(ratio());profile.anisotropy=Math.min(profile.mobile||graphics.level==='low'?2:16,renderer.capabilities.getMaxAnisotropy());renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
let lastLookYaw=0,lastLookPitch=0,previous=performance.now(),lastRendered=0,renderedFrames=0,contextLost=false,resizeTimer;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.4;renderer.autoClear=false;
let grade=null;
function syncGrade(){const want=gradeOn&&graphics.preset.postProcess;if(want&&!grade)grade=new GradePass(renderer);else if(!want&&grade){try{grade.dispose();}catch{}grade=null;}}
syncGrade();console.info('[kino] graphics build 2026-10-15: level '+graphics.level+', grade pass '+(grade?'on':'off')+', shadows '+(profile.shadows?'on':'off')+', pixel ratio cap '+(profile.mobile?1:2)+', anisotropy '+profile.anisotropy);
ctx.attach(renderer);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x101319);scene.fog=new THREE.FogExp2(0x14181b,fogDensityFromHalfDistance(THEATER_FOG.halfDist));
const lightLevels=pickLightLevels(location.search);let theaterFx=null;
const ambient=new THREE.AmbientLight(new THREE.Color(...THEATER_WORLD.ambientColor),lightLevels.ambient);scene.add(ambient,new THREE.HemisphereLight(0xd2d9e3,0x574236,lightLevels.hemi));
const keyLight=new THREE.DirectionalLight(new THREE.Color(...THEATER_WORLD.sunColor),lightLevels.sun);keyLight.position.set(.4,1,.2);scene.add(keyLight,keyLight.target);
const keyDirection=new THREE.Vector3(...sunTravelDirection()).normalize();keyLight.position.copy(keyDirection).multiplyScalar(-SHADOW_BACKOFF);
let csm=null;
if(profile.shadows){renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;keyLight.visible=false;}
const fill=new THREE.DirectionalLight(0x8cabc9,lightLevels.fill);fill.position.set(-1,.5,-.5);scene.add(fill);
const cgFov=Math.min(120,Math.max(30,Number(/[?&]fov=(\d+(?:\.\d+)?)/.exec(location.search)?.[1])||THEATER_WORLD.cgFov)),hipFov=verticalFovFromCgFov(cgFov);
const camera=new THREE.PerspectiveCamera(hipFov,innerWidth/innerHeight,1,14000);camera.rotation.order='YXZ';camera.position.set(-101,168,1256);camera.lookAt(160,170,850);
audio.camera=camera;
if(profile.shadows){csm=new CSM({camera,parent:scene,lightDirection:keyDirection.clone(),lightIntensity:lightLevels.sun,...SHADOW_CASCADES});csm.fade=true;csm.lights.forEach(l=>{l.color.setRGB(...THEATER_WORLD.sunColor);l.shadow.normalBias=1.5;l.shadow.radius=3;});profile.csm=csm;}
// Graphics setting (Auto / High / Medium / Low) from the pause menu drives shadows, god rays and sun brightness.
const autoGraphics=new AutoGraphics({targetMs:profile.mobile?1000/30:1000/60});
function applyGraphics(){
  const preset=graphics.preset,shadowsOn=!!profile.shadows&&preset.shadows;
  if(csm){
    if(preset.shadows&&preset.shadowMapSize&&csm.shadowMapSize!==preset.shadowMapSize){csm.shadowMapSize=preset.shadowMapSize;for(const l of csm.lights){l.shadow.mapSize.set(preset.shadowMapSize,preset.shadowMapSize);l.shadow.dispose();l.shadow.map=null;l.shadow.mapPass=null;}}
    csm.lights.forEach(l=>{l.visible=shadowsOn;l.castShadow=shadowsOn;});
  }
  keyLight.visible=!shadowsOn;keyLight.intensity=lightLevels.sun*preset.sunScale;
  if(culler)culler.shadows=shadowsOn;
  theaterFx?.setGodRays(preset.godRays);
  autoGraphics.reset();
  adapt.min=profile.mobile?Math.min(.6,preset.minResolution):preset.minResolution;
  adapt.scale=adapt.max;adapt.stable=0;adapt.probed=false;adapt.holdWindows=4;renderer.setPixelRatio(ratio());
  syncGrade();
  muzzle.visible=preset.muzzleLight;
  camera.far=14000*preset.farScale;camera.updateProjectionMatrix();
  document.body.classList.toggle('no-fx',noFxQuery||!preset.overlay);
}
const viewScene=new THREE.Scene(),viewCamera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.01,200);
viewScene.add(new THREE.AmbientLight(0xe1d9c7,2.0));const vl=new THREE.DirectionalLight(0xffefc8,1.5);vl.position.set(0,4,2);viewScene.add(vl);
const muzzle=new THREE.PointLight(0xffc276,0,240,1);scene.add(muzzle);
let culler=null,cullReady=false;
const stopGraphics=graphics.onChange(applyGraphics);applyGraphics();
let data,world,session,player,enemies,view,powerups,perkDrink,mysteryBox,features,ready=false,active=false,started=false,primary=false,primaryPressed=false,ads=false;
let prompt=null,promptText='',toastUntil=0,announcementUntil=0,hitUntil=0,flashUntil=0,spawn;
let lastPhase='',lastRound=0,frameTime=0,frameCount=0,fps=0,debugVisible=false,teleportPending=0,linkUntil=0,returnAt=0,cooldownUntil=0,repairLeft=0,burstLeft=0;
const particles=[],grenades=[],traps=[],gasClouds=[],meteors=new Set();const blood=new BloodFx(scene);const impacts=new WallImpacts(scene);
const perkInfo={specialty_quickrevive:{name:'Quick Revive',price:500,color:'#509ebc',icon:'QR'},specialty_fastreload:{name:'Speed Cola',price:3000,color:'#478450',icon:'SC'},specialty_rof:{name:'Double Tap',price:2000,color:'#b37528',icon:'DT'},specialty_armorvest:{name:'Juggernog',price:2500,color:'#a53835',icon:'J'}};
const powerupNames={nuke:'Nuke',insta_kill:'Insta-Kill',double_points:'Double Points',full_ammo:'Max Ammo',carpenter:'Carpenter',fire_sale:'Fire Sale'};
const errors=[];
let lastShot=null;
let pendingMelee=null,lastReloadSerial=0,reloadShot=false;
let mousePrimary=false,mouseAim=false;
const touchControls=createZombieTouch({ctx,
  menuSettings:false,
  onLook:(x,y,sensitivity)=>{
    if(!active||session.phase==='reviving')return;
    const scale=.005*sensitivity*(ads?.5:1);
    camera.rotation.y-=x*scale;camera.rotation.x=THREE.MathUtils.clamp(camera.rotation.x-y*scale,-1.5,1.5);
  },
  onAction:action=>{
    if(!active||session.phase==='reviving')return;
    if(action==='reload')reload();if(action==='melee')melee();if(action==='grenade')throwGrenade();if(action==='use')interact();
    // Controller X: use whatever is in reach, reload otherwise.
    if(action==='usereload'){findPrompt();if(prompt)interact();else reload();}
    if(action==='weapon'){session.switchWeapon();equipView();}
    if(action==='claymore')features.placeClaymore();if(action==='equipment')features.throwMonkey();
    if(action==='attachment'&&session.toggleAttachment())equipView();
  },
  onPause:()=>ctx.pause(),
});
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
ctx.onDispose(()=>{
  disposed=true;renderer.setAnimationLoop(null);clearTimeout(resizeTimer);
  try{stopProgress();}catch{}
  try{touchControls.destroy();}catch{}
  try{audio.dispose();}catch{}
  try{enemies?.reset();}catch{}
  try{blood.clear();}catch{}
  try{chalk.reset();}catch{}
  try{grade?.dispose?.();}catch{}
  try{if(!noFxQuery)document.body.classList.remove('no-fx');}catch{}
  try{stopGraphics();}catch{}
  try{csm?.dispose?.();}catch{}
  try{culler?.dispose?.();}catch{}
  try{perf?.remove?.();}catch{}
  for(const group of [particles,grenades,traps,gasClouds])group.length=0;
  for(const root of [scene,viewScene]){try{disposeObject(root);}catch(error){console.warn(error);}}
  document.body.classList.remove('no-fx');
});
function progress(text,percent){ctx.progress(text,percent/100);}
// Real byte progress for the big downloads, instead of a bar parked at 15%.
let byteProgress=false;
const stopProgress=assets.onProgress(s=>{
  if(!byteProgress)return;
  let loaded=0,total=0;for(const f of s.files)if(!/\.(?:png|webp|jpe?g)(?:[?#].*)?$/i.test(f.url)){loaded+=f.got;total+=f.total;}
  if(!total)return;
  const mb=n=>(n/1048576).toFixed(0);
  ctx.progress(`Loading the theater · ${mb(loaded)} / ${mb(total)} MB`,(10+Math.min(1,loaded/total)*70)/100);
});
const ensureTextures=()=>sharedEnsureTextures(ctx,{at:.89});
const prewarm=()=>sharedPrewarm({ctx,renderer,mobile:profile.mobile,scenes:[[scene,camera],[viewScene,viewCamera]],withTarget:grade?{begin(){grade.sync();renderer.setRenderTarget(grade.target);},end(){renderer.setRenderTarget(null);}}:null});
function toast(text,duration=2.5){$('toast').textContent=text;toastUntil=(session?.time??0)+duration;}
function announce(title,small='KINO DER TOTEN',duration=4){$('announcement-title').textContent=title;$('announcement-small').textContent=small;$('announcement').style.opacity=1;announcementUntil=session.time+duration;}
function setActive(value){
  active=!!value&&ready&&session.phase!=='gameover';keys.clear();primary=false;primaryPressed=false;ads=false;reloadShot=false;
  mousePrimary=mouseAim=false;touchControls.reset();touchControls.setEnabled(active&&session.phase!=='reviving',active);
  if(active&&audio.ctx)audio.start();else if(!active)audio.pause();
  if(active&&!started){started=true;audio.play('round');}
}
function prepare(){if(!ready||contextLost)return;audio.start();warmViewAudio();}
function suspendRendering(){renderer.setAnimationLoop(null);if(ready)ctx.pause();audio.pause();}
function resumeRendering(){previous=performance.now();lastRendered=0;if(!document.hidden&&!contextLost)renderer.setAnimationLoop(renderFrame);}
ctx.listen(document,'visibilitychange',()=>{if(document.hidden)suspendRendering();else resumeRendering();});
addEventListener('pagehide',suspendRendering);
addEventListener('pageshow',resumeRendering);
renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;suspendRendering();ctx.setHint('Graphics paused. Waiting for Safari to restore the game…');});
renderer.domElement.addEventListener('webglcontextrestored',()=>{contextLost=false;ctx.setHint('Graphics restored · tap to resume');resumeRendering();});
addEventListener('blur',()=>{keys.clear();primary=false;ads=false;});
addEventListener('mousemove',e=>{if(!active||document.pointerLockElement!==renderer.domElement)return;const sensitivity=(ads?.0012:.002)*ctx.sensitivity();camera.rotation.y-=e.movementX*sensitivity;camera.rotation.x=THREE.MathUtils.clamp(camera.rotation.x-e.movementY*sensitivity,-1.5,1.5);});
addEventListener('mousedown',e=>{if(!active||e.sourceCapabilities?.firesTouchEvents||e.target.closest('#touch-controls'))return;if(e.button===0){mousePrimary=primary=true;primaryPressed=true;}if(e.button===2)mouseAim=ads=true;});
addEventListener('mouseup',e=>{if(e.sourceCapabilities?.firesTouchEvents)return;if(e.button===0)mousePrimary=primary=false;if(e.button===2)mouseAim=ads=false;});
addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('keydown',e=>{
  if(['Space','Tab','F3'].includes(e.code))e.preventDefault();
  keys.add(e.code);if(e.repeat||!active)return;
  if(e.code==='KeyR')reload();if(e.code==='KeyV')melee();if(e.code==='KeyG')throwGrenade();if(e.code==='KeyF'||e.code==='KeyE')interact();
  if(e.code==='Digit4')features.placeClaymore();if(e.code==='KeyX')features.throwMonkey();
  if(e.code==='Digit5'&&session.toggleAttachment())equipView();
  if(e.code==='Digit1'||e.code==='Digit2'){session.switchWeapon(e.code==='Digit1'?0:1);equipView();}
  if(e.code==='KeyQ'){session.switchWeapon();equipView();}
  if(e.code==='KeyM'){audio.enabled=!audio.enabled;toast(audio.enabled?'Sound on':'Sound off');}
  if(e.code==='F3'){debugVisible=!debugVisible;$('debug').hidden=!debugVisible;}
  if(e.code==='Escape')ctx.pause();
});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('wheel',()=>{if(active){session.switchWeapon();equipView();}});
addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{const width=innerWidth,height=innerHeight,current=renderer.getSize(new THREE.Vector2());if(current.x===width&&current.y===height)return;camera.aspect=viewCamera.aspect=width/height;camera.updateProjectionMatrix();viewCamera.updateProjectionMatrix();if(csm)csm.updateFrustums();renderer.setSize(width,height);},profile.mobile?150:0);});

function damage(n){
  if(!session.damage(n))return;audio.play('hit');
  if(!session.drinking)perkDrink?.stop();
  if(session.phase==='gameover'){
    primary=false;ads=false;ctx.gameOver({status:'GAME OVER · You survived '+session.round+(session.round===1?' Round':' Rounds'),results:session.kills+' kills · '+session.headshots+' headshots · '+Math.floor(session.time/60)+'m '+Math.floor(session.time%60)+'s'});
    try{const best=Math.max(session.round,+(localStorage.getItem('kino.best')||0));localStorage.setItem('kino.best',String(best));}catch{}
  }else if(session.phase==='reviving')announce('A second chance','QUICK REVIVE',4);
}
function effect(position,color=0x9e3023,count=7){
  for(let i=0;i<count;i++){
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,1.5),new THREE.MeshBasicMaterial({color}));mesh.position.copy(position);scene.add(mesh);
    particles.push({mesh,velocity:new THREE.Vector3((Math.random()-.5)*100,Math.random()*90,(Math.random()-.5)*100),life:.45+Math.random()*.3});
  }
}
function hit(z,head){hitUntil=session.time+.12;$('hitmarker').style.color=head?'#db5140':'#eee';{const p=head?enemies.headPosition(z):z.root.position.clone().add(new THREE.Vector3(0,z.kind==='zombie'?42:25,0));if(blood.ready())blood.spray(p,camera.position,{head});else effect(p);}}
function kill(z,force,position){
  if(z?.root&&blood.ready())blood.spray(z.root.position.clone().add(new THREE.Vector3(0,z.kind==='zombie'?40:22,0)),camera.position,{kill:true});
  if(z?.gasDeath){
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(75,12,8),new THREE.MeshBasicMaterial({color:0x8ca345,transparent:true,opacity:.14,depthWrite:false}));
    mesh.scale.set(1.65,.6,1.65);mesh.position.copy(z.root.position).add(new THREE.Vector3(0,28,0));scene.add(mesh);gasClouds.push({mesh,position:z.root.position.clone(),life:7});
    effect(mesh.position,0x9eb652,15);audio.play('explosion');
    for(const other of [...enemies.list])if(other.root.position.distanceTo(z.root.position)<96)enemies.hurt(other,other.maxHealth,false,false,'explosion');
    if(player.getFeetPosition().distanceTo(z.root.position)<96)damage(45);
  }
  if(force){dropPowerup(force,position??player.getFeetPosition());return;}
  if(z){const type=session.drops.tryDrop(session,{kind:z.kind,playable:z.state!=='barricade'&&!!world.zoneAt(z.root.position.clone().add(new THREE.Vector3(0,40,0))),destroyedWindows:world.barriers.filter(b=>b.count===0).length,boxMoves:mysteryBox.moves});if(type)dropPowerup(type,z.root.position);}
}
function dropPowerup(type,position){
  return powerups.spawn(type,position);
}
function collect(type){
  if(!powerupNames[type])return;
  session.powerup(type);toast(powerupNames[type],3);audio.event('powerup/grab/grab_00',.75);
  audio.play(type);
  if(type==='full_ammo')audio.event('powerup/max_ammo/max_ammo_00',.7);
  if(type==='nuke'){flashUntil=session.time+.8;audio.event('nuke/nuke_flash',.8);enemies.nuke(z=>effect(z.root.position,0xc7dba4));}
  if(type==='carpenter'){for(const b of world.barriers)world.setBoards(b,b.boards.length||6,true);audio.event('powerup/carpenter/end/end_00',.7);}
}
function shoot(){
  if(!active||features.events.room||!view.ready||view.mode==='raise'||session.busy||session.weaponUnavailable)return false;
  if(session.reloadLeft>0&&session.def.segmentedReload&&session.weapon.mag>0){session.interruptReload();reloadShot=true;return false;}
  if(!session.fire()){if(session.weapon.mag===0&&primaryPressed){audio.weapon('empty',session.def);reload();}return false;}
  view.shoot({ads:ads&&!session.def.dualWield,empty:session.weapon.mag===0,hand:session.def.dualWield&&session.shots%2?'left':'right'});audio.weapon('shot',session.def);muzzle.position.copy(camera.position);muzzle.intensity=160;camera.rotation.x=Math.min(1.48,camera.rotation.x+(ads?.008:.015));
  const forward=camera.getWorldDirection(new THREE.Vector3());
  if(session.weapon.id==='thundergun_zm'){
    for(const z of [...enemies.list]){const d=z.root.position.clone().add(new THREE.Vector3(0,40,0)).sub(camera.position);if(d.length()<600&&d.normalize().dot(forward)>.65&&world.lineClear(camera.position,z.root.position.clone().add(new THREE.Vector3(0,40,0))))enemies.hurt(z,100000,false,false,'thunder');}
    effect(camera.position.clone().addScaledVector(forward,100),0xb9d8e5,22);return true;
  }
  if(session.def.projectileSpeed>0){features.shoot(session.def,forward);return true;}
  const pellets=Math.max(1,session.def.pellets);
  for(let i=0;i<pellets;i++){
    const direction=forward.clone();if(pellets>1||!ads){const spread=pellets>1?.055:.012;direction.x+=(Math.random()-.5)*spread;direction.y+=(Math.random()-.5)*spread;direction.z+=(Math.random()-.5)*spread;direction.normalize();}
    const ray=new THREE.Ray(camera.position.clone(),direction),wall=world.raycast(ray,1,6000),target=enemies.rayHit(ray,wall?.distance??6000);
    lastShot={origin:ray.origin.toArray(),direction:direction.toArray(),wallDistance:wall?.distance??null,target:target?{id:target.z.id,head:target.head,distance:target.distance}:null};
    if(target){const d=target.distance>session.def.range?session.def.minDamage:session.def.damage;enemies.hurt(target.z,d*(target.head?Math.max(1,session.def.headMultiplier):1),target.head,false,session.def.explosionRadius?'explosion':'bullet');}
    else if(wall)impacts.strike(wall,ray,particles);
    if(session.def.explosionRadius&&(target||wall)){
      const p=target?.point??wall.position,radius=session.def.explosionRadius;
      effect(p,session.weapon.id==='ray_gun_zm'?0x93ed62:0xffb44e,18);audio.play('explosion',.3);
      for(const z of [...enemies.list]){const d=z.root.position.distanceTo(p);if(d<radius&&world.lineClear(p.clone().addScaledVector(direction,-3),z.root.position.clone().add(new THREE.Vector3(0,25,0))))enemies.hurt(z,THREE.MathUtils.lerp(session.def.explosionInnerDamage,session.def.explosionOuterDamage,d/radius),false,false,'explosion');}
      const distance=player.getFeetPosition().distanceTo(p);if(distance<radius)damage(100*(1-distance/radius));
    }
  }
  return true;
}
function warmViewAudio(){if(view?.ready)audio.warmWeapon(session.def,Object.values(view.rig.data).flatMap(d=>(d.notifies??[]).map(n=>n.name)));}
async function equipView(){reloadShot=false;await view.equip(session.def);warmViewAudio();}
function reload(){if(!view.ready)return;const empty=session.weapon.mag===0;if(session.reload()){burstLeft=0;ads=false;lastReloadSerial=session.reloadSerial;view.reload(empty,session.reloadDuration,session.reloadStage);}}
function melee(){
  if(!active||session.busy||session.weaponUnavailable||features.events.room||!view.ready)return false;
  const charge=!!meleeTarget(),type=session.bowie?'bowie':'knife',strike=view.melee(type,charge);
  if(!strike)return false;
  session.cancelReload();session.meleeLeft=strike.duration;burstLeft=0;reloadShot=false;ads=false;primaryPressed=false;
  pendingMelee={at:session.time+strike.delay,damage:session.weapon.id==='knife_ballistic_zm'&&session.bowie?(session.weapon.upgraded?1500:1000):strike.damage,bowie:session.bowie};
  audio.knife('swing',session.bowie);return true;
}
function meleeTarget(){
  const direction=camera.getWorldDirection(new THREE.Vector3());let nearest=null;
  for(const z of enemies.list){const target=z.root.position.clone().add(new THREE.Vector3(0,z.kind==='zombie'?45:22,0)),delta=target.clone().sub(camera.position);if(delta.length()<94&&delta.normalize().dot(direction)>.45&&world.lineClear(camera.position,target)){if(!nearest||z.root.position.distanceTo(camera.position)<nearest.root.position.distanceTo(camera.position))nearest=z;}}
  return nearest;
}
function resolveMelee(){
  if(!pendingMelee||session.time<pendingMelee.at)return;
  const strike=pendingMelee;pendingMelee=null;
  if(session.phase==='reviving'||session.phase==='gameover')return;
  const nearest=meleeTarget();
  if(nearest){enemies.hurt(nearest,strike.damage,false,true);audio.knife('hit',strike.bowie);}
  else {const ray=new THREE.Ray(camera.position.clone(),camera.getWorldDirection(new THREE.Vector3())),wall=world.raycast(ray,0,94);if(wall){audio.knife('wall');impacts.dust(wall,ray,particles);}}
}
function throwGrenade(){
  if(!active||session.grenades<=0||session.busy||features.events.room)return false;session.grenades--;
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(3.5,8,6),new THREE.MeshStandardMaterial({color:0x4a5039,roughness:.8}));mesh.position.copy(camera.position);scene.add(mesh);grenades.push({mesh,velocity:camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(480).add(new THREE.Vector3(0,140,0)),life:3});
}
function findPrompt(){
  prompt=null;promptText='';let distance=115;
  for(const e of world.interactions){
    if(e.targetname?.startsWith('trigger_movie_reel_')&&!features.events.available(e.id))continue;
    if(e.targetname==='meteor_egg_trigger'&&meteors.has(e.id))continue;
    if(e.targetname==='treasure_chest_use'&&!mysteryBox.available(e))continue;
    if(e.targetname==='zombie_door'){const d=world.doors.get(e.target);if(session.openDoors.has(e.target)||(d.electric&&session.power))continue;}
    if(e.targetname==='use_elec_switch'&&session.power)continue;
    if(e.targetname==='weapon_upgrade'&&!data.weapons[e.zombie_weapon_upgrade])continue;
    const dist=camera.position.distanceTo(vector(e.position));if(dist<distance){distance=dist;prompt=e;}
  }
  for(const b of world.barriers){const d=camera.position.distanceTo(b.position.clone().add(new THREE.Vector3(0,25,0)));if(d<100&&d<distance){prompt={barrier:b};distance=d;}}
  if(!prompt)return;
  if(prompt.barrier){promptText=prompt.barrier.count<(prompt.barrier.boards.length||6)?'Hold F to rebuild barricade':'Barricade secured';return;}
  const e=prompt;
  if(e.targetname==='zombie_door'){const d=world.doors.get(e.target);promptText=d.electric?'The power must be activated':'Open door · '+d.cost;}
  if(e.targetname==='weapon_upgrade'){const d=data.weapons[e.zombie_weapon_upgrade],owned=session.inventory.find(w=>w.id===d.id&&!w.lost);promptText=owned?d.name+' ammo · '+(owned.upgraded?4500:d.ammoPrice??Math.ceil(d.price/2)):d.name+' · '+d.price;}
  if(e.targetname==='zombie_vending'){const p=perkInfo[e.script_noteworthy];if(!p)return;promptText=session.perks.has(e.script_noteworthy)?p.name+' equipped':!session.power&&e.script_noteworthy!=='specialty_quickrevive'?'The power must be activated':p.name+' · '+p.price;}
  if(e.targetname==='use_elec_switch')promptText='Turn on the power';
  if(e.targetname==='meteor_egg_trigger')promptText='Listen to the meteor fragment';
  if(e.targetname==='bowie_upgrade')promptText=session.bowie?'Bowie Knife equipped':'Bowie Knife · 3000';
  if(e.targetname==='treasure_chest_use'){const roll=mysteryBox.at(e);promptText=roll?(roll.ready?(roll.teddy?'The Mystery Box is moving…':'Take '+(data.weapons[roll.weapon]??data.equipment[roll.weapon]).name):'Choosing your weapon…'):'Mystery Box · '+(session.effects.fire_sale>session.time?10:950);}
  if(e.targetname==='trigger_teleport_pad_0')promptText=!session.power?'The power must be activated':session.teleporter==='linked'?'Teleport to the projection room':session.teleporter==='cooldown'?'Teleporter cooling down':session.teleporter==='linking'?'Link the pad in the lobby':'Initiate teleporter link';
  if(e.targetname==='pf16_auto1')promptText=session.teleporter==='linking'?'Link with the mainframe':'Link the teleporter on the stage first';
  if(e.targetname==='zombie_vending_upgrade')promptText=session.pack?(session.time>=session.pack.readyAt?'Take '+data.weapons[session.pack.weapon.id].upgrade.name+' · '+Math.ceil(session.pack.expires-session.time)+'s':'Upgrading weapon…'):session.weapon.upgraded?'Weapon already upgraded':'Pack-a-Punch · 5000';
  if(e.targetname?.endsWith('_room_trap'))promptText=!session.power?'The power must be activated':'Activate electric trap · 1000';
  promptText=features.prompt(e)??promptText;
}
function interact(){
  if(!active||session.busy)return false;findPrompt();if(!prompt)return false;
  if(prompt.barrier)return repair(prompt.barrier);
  const e=prompt,t=e.targetname;
  if(t==='claymore_purchase'){const ok=features.interact(e);if(ok)world.revealWallGun(e);return ok;}
  if(e.script_noteworthy==='auto_turret_trigger'||t?.startsWith('trigger_movie_reel_')||t==='trigger_change_projector_reels')return features.interact(e);
  if(t==='meteor_egg_trigger'){meteors.add(e.id);audio.play('buy');toast('Meteor fragment '+meteors.size+' / 3');if(meteors.size===3){audio.playMusic('115');announce('115','MUSICAL EASTER EGG');}return true;}
  const pay=n=>{if(!session.spend(n)){toast('Not enough points');return false;}audio.play('buy');return true;};
  if(t==='bowie_upgrade'){if(session.bowie||!pay(3000))return false;session.bowie=true;toast('Bowie Knife');return true;}
  if(t==='zombie_door'){
    const d=world.doors.get(e.target);if(d.electric){toast('Turn on the power');return false;}if(session.openDoors.has(e.target)||!pay(d.cost))return false;
    session.openDoors.add(e.target);if(d.flag)session.flags.add(d.flag);world.setDoors(session);toast('Door opened');return true;
  }
  if(t==='weapon_upgrade'){
    const d=data.weapons[e.zombie_weapon_upgrade];if(!d||session.pack?.weapon===session.weapon)return false;
    session.leaveAttachment();const owned=session.inventory.find(w=>w.id===d.id&&!w.lost);
    const cost=owned?(owned.upgraded?4500:d.ammoPrice??Math.ceil(d.price/2)):d.price;
    if(!pay(cost))return false;
    if(owned)owned.reserve=owned.upgraded?d.upgrade?.maxAmmo??d.maxAmmo:d.maxAmmo;
    else {session.giveWeapon(d.id);equipView();}world.revealWallGun(e);toast(owned?'Ammo replenished':d.name);return true;
  }
  if(t==='zombie_vending'){
    const id=e.script_noteworthy,p=perkInfo[id];if(!p||session.perks.has(id)||(!session.power&&id!=='specialty_quickrevive'))return false;
    if(id==='specialty_quickrevive'&&session.revives>=3){toast('Quick Revive is depleted');return false;}if(!pay(p.price))return false;
    if(!session.drink(id))return false;primary=false;primaryPressed=false;ads=false;burstLeft=0;reloadShot=false;perkDrink.start(id,view);toast(p.name);audio.play(id,1,e.position);return true;
  }
  if(t==='use_elec_switch'&&!session.power){
    session.power=true;session.flags.add('power_on');world.setDoors(session);ambient.intensity=lightLevels.powered;audio.play('round');return true;
  }
  if(t==='treasure_chest_use'){
    if(mysteryBox.at(e)){if(session.pack?.weapon===session.weapon)return false;const weapon=mysteryBox.take(e);if(!weapon)return false;if(weapon==='zombie_cymbal_monkey'){session.giveMonkeys();toast('Monkey Bombs · X to throw');}else{session.giveWeapon(weapon);equipView();toast(data.weapons[weapon].name);}return true;}
    const cost=session.effects.fire_sale>session.time?10:950;
    if(session.points<cost){toast('Not enough points');return false;}
    if(!mysteryBox.start(e))return false;session.spend(cost);audio.play('buy');return true;
  }
  if(t==='zombie_vending_upgrade'){
    if(session.pack){if(!session.takePack())return false;equipView();toast(session.def.name);return true;}
    if(!session.beginPack())return false;ads=false;primary=false;burstLeft=0;reloadShot=false;audio.play('buy');audio.play('packapunch');toast('Upgrading… retrieve your weapon when it is ready.');return true;
  }
  if(t==='trigger_teleport_pad_0'&&session.power){
    if(session.teleporter==='unlinked'){session.teleporter='linking';linkUntil=session.time+30;toast('Link the mainframe pad in the lobby',5);return true;}
    if(session.teleporter==='linked'&&!teleportPending){teleportPending=session.time+2;toast('Teleporting…');return true;}return false;
  }
  if(t==='pf16_auto1'&&session.teleporter==='linking'){session.teleporter='linked';toast('Teleporter linked',4);audio.play('buy');return true;}
  if(t?.endsWith('_room_trap')&&session.power){
    if(traps.some(tr=>tr.name===t&&tr.cooldown>session.time)){toast('Trap cooling down');return false;}if(!pay(1000))return false;
    const p=vector(e.position),mesh=new THREE.Mesh(new THREE.CylinderGeometry(60,60,100,12,1,true),new THREE.MeshBasicMaterial({color:0x8cbbff,transparent:true,opacity:.24,wireframe:true}));mesh.position.copy(p);scene.add(mesh);traps.push({name:t,position:p,mesh,end:session.time+30,cooldown:session.time+90});return true;
  }
  return false;
}
function repair(b){if(b.count>=(b.boards.length||6)||repairLeft>0)return false;repairLeft=.75;world.setBoards(b,b.count+1,true);if(b.rewardRound!==session.round){b.rewardRound=session.round;b.reward=0;}if(b.reward<50*session.round){session.addPoints(10);b.reward+=10;}audio.play('board');return true;}
function reset(){
  pendingMelee=null;lastReloadSerial=0;reloadShot=false;
  touchControls.reset();mousePrimary=mouseAim=false;toastUntil=0;announcementUntil=0;hitUntil=0;flashUntil=0;primary=false;primaryPressed=false;ads=false;keys.clear();
  session.reset();enemies.reset();world.reset(session);player.setSpawn(vector(spawn.position));player.respawn();camera.rotation.set(0,spawn.yaw-Math.PI/2,0);
  powerups.reset();perkDrink.stop();mysteryBox.reset();
  features?.reset();
  blood.clear();
  impacts.clear();
  for(const group of [particles,grenades,traps,gasClouds]){for(const item of group){item.mesh.removeFromParent();item.mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}group.length=0;}
  meteors.clear();renderer.domElement.style.filter='';if(audio.ctx)audio.playMusic('ambience');
  started=false;chalk.reset();lastPoints=null;teleportPending=0;returnAt=0;linkUntil=0;cooldownUntil=0;repairLeft=0;burstLeft=0;lastPhase='';lastRound=0;ambient.intensity=lightLevels.ambient;view.currentId=null;equipView();ctx.setHint(touchControls.mode?'Tap to start':'Click to capture the mouse · Esc to pause');
}
function returnToLobby(){
  const dest=data.entities.find(e=>e.targetname==='theater_teleport_player0');player.setPosition(vector(dest.position));camera.rotation.set(0,dest.yaw-Math.PI/2,0);cooldownUntil=session.time+90;flashUntil=session.time+.8;
}
function update(dt){
  if(!ready)return;
  touchControls.setEnabled(active&&session.phase!=='reviving'&&session.phase!=='gameover',active&&session.phase!=='gameover');
  const touch=touchControls.input.read();
  primary=mousePrimary||touch.fire;primaryPressed ||= touch.firePressed;ads=mouseAim||touch.aim;
  if(active){
    session.update(dt);
    if(session.phase!=='gameover'){
      resolveMelee();
      if(session.reloadLeft>0&&session.reloadSerial!==lastReloadSerial){lastReloadSerial=session.reloadSerial;view.reload(false,session.reloadDuration,session.reloadStage);}
      const forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS'))+touch.forward,strafe=Number(keys.has('KeyD'))-Number(keys.has('KeyA'))+touch.strafe;
      const moving=Math.hypot(forward,strafe)>.01,sprint=((keys.has('ShiftLeft')||keys.has('ShiftRight'))&&keys.has('KeyW')||touch.sprint)&&!ads&&!session.reloadLeft&&!session.meleeLeft&&!session.drinking;
      player.update(dt,session.phase==='reviving'?{}:{forward,strafe,sprint,crouch:keys.has('ControlLeft')||keys.has('ControlRight')||keys.has('KeyC')||touch.crouch,jump:keys.has('Space'),jumpPressed:touch.jump});
      const base=view.lookBase(camera);
      const lookYaw=Math.atan2(Math.sin(base.yaw-lastLookYaw),Math.cos(base.yaw-lastLookYaw)),lookPitch=base.pitch-lastLookPitch;lastLookYaw=base.yaw;lastLookPitch=base.pitch;
      view.update(dt,{moving,sprint,ads:ads&&!session.def.dualWield,reloading:session.reloadLeft>0,empty:session.weapon.mag===0,time:session.time,look:{yaw:lookYaw,pitch:lookPitch},camera,viewCamera,worldScene:scene});
      view.pivot.visible=!session.weaponUnavailable&&!features.events.room;
      perkDrink.update(dt,session);
      if(!sprint&&session.phase!=='reviving'&&(primaryPressed||(primary&&session.def.automatic)||burstLeft>0||reloadShot)){
        if(shoot()){reloadShot=false;if(burstLeft>0)burstLeft--;else if(session.def.fireType==='3-Round Burst')burstLeft=2;}
      }
      primaryPressed=false;
      enemies.update(dt,player.getFeetPosition());
      features.update(dt);
      repairLeft=Math.max(0,repairLeft-dt);findPrompt();if((keys.has('KeyF')||keys.has('KeyE')||touch.use)&&prompt?.barrier)repair(prompt.barrier);
      if(session.round!==lastRound||session.phase!==lastPhase){if(session.phase==='fighting'){audio.play(session.dogRound?'dog_round':'round');if(session.dogRound)audio.play('dog_announce');}else if(session.phase==='preparing'&&session.round>1){audio.play('round_end');}lastRound=session.round;lastPhase=session.phase;}
      mysteryBox.update(dt);
      if(session.teleporter==='linking'&&session.time>linkUntil){session.teleporter='unlinked';toast('Teleporter link timed out');}
      if(teleportPending&&session.time>=teleportPending){teleportPending=0;const dest=data.entities.find(e=>e.targetname==='projroom_teleport_player0');player.setPosition(vector(dest.position));returnAt=session.time+30;session.teleporter='cooldown';flashUntil=session.time+.8;toast('Projection room · 30 seconds',4);}
      if(returnAt&&session.time>=returnAt){
        returnAt=0;const room=features.events.chooseRoom();
        if(room){features.events.room=room;features.events.roomUntil=session.time+5.8;player.setPosition(vector(room.position));camera.rotation.set(0,room.yaw-Math.PI/2,0);toast('A room outside time… find a film reel.',5);}
        else returnToLobby();flashUntil=session.time+.8;
      }
      if(features.events.room&&session.time>=features.events.roomUntil){features.events.room=null;returnToLobby();}
      if(cooldownUntil&&session.time>cooldownUntil){cooldownUntil=0;session.teleporter='unlinked';}
      for(const tr of traps)if(session.time<tr.end){tr.mesh.rotation.y+=dt*3;for(const z of [...enemies.list])if(z.root.position.distanceTo(tr.position)<100)enemies.hurt(z,99999,false,false,'electric');if(player.getFeetPosition().distanceTo(tr.position)<75)damage(dt*100);}else tr.mesh.visible=false;
      let gassed=false;
      for(const g of [...gasClouds]){g.life-=dt;g.mesh.material.opacity=.14*Math.min(1,g.life/2);g.mesh.rotation.y+=dt*.2;if(player.getFeetPosition().distanceTo(g.position)<125)gassed=true;if(g.life<=0){g.mesh.removeFromParent();g.mesh.geometry.dispose();g.mesh.material.dispose();gasClouds.splice(gasClouds.indexOf(g),1);}}
      renderer.domElement.style.filter=gassed?'blur(3px)':'';
      powerups.update(dt,player.getFeetPosition(),session.phase!=='reviving',(a,b)=>world.lineClear(a,b));
      for(const g of [...grenades]){
        g.life-=dt;g.velocity.y-=650*dt;const travel=g.velocity.clone().multiplyScalar(dt),ray=new THREE.Ray(g.mesh.position.clone(),travel.clone().normalize()),hit=world.raycast(ray,0,travel.length()+4);
        if(hit){g.velocity.y=Math.abs(g.velocity.y)*.4;g.velocity.x*=-.4;g.velocity.z*=-.4;}else g.mesh.position.add(travel);
        if(g.life<=0){effect(g.mesh.position,0xffb347,30);audio.play('explosion');for(const z of [...enemies.list]){const d=z.root.position.distanceTo(g.mesh.position);if(d<300&&world.lineClear(g.mesh.position,z.root.position.clone().add(new THREE.Vector3(0,30,0))))enemies.hurt(z,Math.max(75,1500*(1-d/300)),false,false,'explosion');}const d=camera.position.distanceTo(g.mesh.position);if(d<160)damage(180*(1-d/160));g.mesh.removeFromParent();g.mesh.geometry.dispose();g.mesh.material.dispose();grenades.splice(grenades.indexOf(g),1);}
      }
      for(const p of [...particles]){p.life-=dt;p.velocity.y-=200*dt;p.mesh.position.addScaledVector(p.velocity,dt);fadeParticle(p);if(p.life<=0){p.mesh.removeFromParent();p.mesh.geometry.dispose();p.mesh.material.dispose();particles.splice(particles.indexOf(p),1);}}
    }
  }
  muzzle.intensity=Math.max(0,muzzle.intensity-dt*2200);camera.fov=THREE.MathUtils.damp(camera.fov,ads&&!session.def.dualWield&&!session.drinking&&!session.meleeLeft&&!session.reloadLeft?verticalFovFromCgFov(session.def.adsFov||56):hipFov,12,dt);camera.updateProjectionMatrix();
  hud();
}
// HUD writes compare against the live DOM first so unchanged frames cause no style/layout work.
const hudEls={},hudEl=id=>hudEls[id]??=$(id);
function text(id,v){const e=hudEl(id),t=String(v);if(e.textContent!==t)e.textContent=t;}
function opacity(id,v){const e=hudEl(id),t=String(v);if(e.style.opacity!==t)e.style.opacity=t;}
function hide(id,v){const e=hudEl(id);if(e.hidden!==v)e.hidden=v;}
function hud(){
  const s=session,w=s.weapon;
  chalk.update(s,started);
  if(lastPoints===null||s.points===0&&lastPoints>0&&s.phase==='gameover')lastPoints=s.points;
  if(s.points!==lastPoints){spawnScorePopup($('score-popups'),s.points-lastPoints);lastPoints=s.points;}
  text('points',s.points);
  const unavailable=s.weaponUnavailable,cap=s.def.magSize||s.def.clip||s.def.ammoClip||s.def.mag||8;
  text('mag',unavailable?'—':w.mag);text('reserve',unavailable?'—':w.reserve);
  $('mag').classList.toggle('low',!unavailable&&w.mag<=Math.floor(cap/3));
  renderAmmoIcons($('ammo-icons'),s.def,unavailable?0:w.mag);
  text('grenade-count',s.grenades);
  hide('claymore',!s.claymoresOwned);text('claymore-count',s.claymores);
  hide('monkey',!s.monkeysOwned);text('monkey-count',s.monkeys);
  text('reload-label',!unavailable&&s.reloadLeft<=0&&w.mag===0&&w.reserve>0?'Reload':'');
  opacity('hurt',s.health<s.maxHealth?(1-s.health/s.maxHealth)*.8:0);opacity('hitmarker',hitUntil>s.time?1:0);opacity('flash',Math.max(0,flashUntil-s.time));
  text('prompt',active&&promptText?bo1Prompt(promptText,touchControls.mode,touchControls.pad.active):'');
  if(toastUntil<s.time)text('toast','');if(announcementUntil<s.time)opacity('announcement',0);
  const nextPerkKey=[...s.perks].join();if(nextPerkKey!==perkKey){perkKey=nextPerkKey;$('perks').innerHTML=[...s.perks].filter(id=>perkIcons[id]).map(id=>`<img alt="${perkInfo[id].name}" src="textures/${perkIcons[id]}.png">`).join('');}
  const nowSeconds=performance.now()/1000;
  for(const k of ['double_points','insta_kill','fire_sale']){const left=(s.effects[k]??0)-s.time;hide('pu-'+k,!(left>0&&powerupVisible(left,nowSeconds)));}
  text('return-timer',returnAt?Math.ceil(returnAt-s.time):'');
  if(debugVisible)$('debug').textContent=`${fps} FPS · ${renderer.info.render.calls} calls\n${camera.position.toArray().map(v=>v.toFixed(1)).join(', ')}\n${enemies.list.length} enemies · ${world.navDisabled.size} blocked polygons`;
}

function getState(){return {ready,active,started,input:{touch:touchControls.getState(),primary,ads},...(session?session.snapshot():{}),player:player?{...player.state,rotation:camera.rotation.toArray().slice(0,3),position:camera.position.toArray(),feet:player.getFeetPosition().toArray()}:null,enemies:enemies?.snapshot()??[],prompt:promptText,barriers:world?.barriers.map(b=>({id:b.id,count:b.count,position:b.position.toArray(),inside:b.inside.toArray(),group:b.group}))??[],doors:world?[...world.doors.values()].map(d=>({name:d.name,cost:d.cost,flag:d.flag,open:session.openDoors.has(d.name),triggers:d.triggers.map(e=>e.position),parts:d.parts.length})):[],performance:{fps,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles},viewmodelReady:view?.ready??false,errors:[...errors]};}
const kinoApi={debug:{getState,setActive,pause:()=>setActive(false),resume:()=>setActive(true),reset,teleportPlayer:p=>player.setPosition(vector(p)),lookAt:p=>camera.lookAt(vector(p)),damagePlayer:damage,grantPoints:n=>session.points+=n,interact,shoot,reload,melee,giveWeapon:id=>{session.giveWeapon(id);equipView();},spawnEnemy:(p,kind)=>enemies.spawn(vector(p),null,kind).id,clearEnemies:()=>{for(const z of [...enemies.list])enemies.hurt(z,999999);},collectPowerup:collect,step:(seconds)=>{for(let t=0;t<seconds;t+=1/60)update(Math.min(1/60,seconds-t));},navigationPath:(a,b)=>world.path(vector(a),vector(b)).map(v=>v.toArray()),getEntities:()=>data.entities.filter(e=>e.classname==='trigger_use'||e.targetname==='initial_spawn_points'),showCollision:value=>{world.collision.setDebugVisible(value);scene.add(world.collision.mesh);}}};
Object.assign(kinoApi.debug,{
  memoryState:()=>{
    const textures=new Set(),sources=new Set(),geometries=new Set();let textureBytes=0,geometryBytes=0;
    for(const root of [scene,viewScene])root.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of [object.material].flat().filter(Boolean))for(const value of Object.values(material))if(value?.isTexture)textures.add(value);});
    for(const texture of textures){if(sources.has(texture.source))continue;sources.add(texture.source);const image=texture.image;if(image)textureBytes+=(image.width??0)*(image.height??0)*4*(texture.generateMipmaps?4/3:1);}
    for(const geometry of geometries){for(const attribute of Object.values(geometry.attributes))geometryBytes+=(attribute.array??attribute.data?.array)?.byteLength??0;geometryBytes+=geometry.index?.array.byteLength??0;}
    return {...assetDiagnostics(),textureBytes:Math.round(textureBytes),geometryBytes,collisionBytes:world?.collision.metadata.byteLength,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,renderedFrames,contextLost,antialias:renderer.getContext().getContextAttributes()?.antialias};
  },
  cullState:()=>culler?{...culler.stats,enabled:culler.enabled}:null,
  setCulling:value=>{if(culler)culler.setEnabled(value);return !!culler;},
  simulateContextLoss:()=>renderer.forceContextLoss(),
  simulateContextRestore:()=>renderer.forceContextRestore(),
  completionState:()=>features.snapshot(),
  setAutoSpawn:value=>{enemies.autoSpawn=value;enemies.autoRounds=value;},
  useEquipment:kind=>kind==='claymores'?features.placeClaymore():features.throwMonkey(),
  giveMonkeys:()=>session.giveMonkeys(),
  toggleAttachment:()=>{if(session.toggleAttachment()){equipView();return true;}return false;},
  pickSurface:(x,y)=>{const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x/innerWidth*2-1,1-y/innerHeight*2),camera);const meshes=[];scene.traverseVisible(o=>{if(o.isMesh)meshes.push(o);});return ray.intersectObjects(meshes,false).slice(0,4).map(h=>({object:h.object.name,material:(Array.isArray(h.object.material)?h.object.material[h.face.materialIndex]:h.object.material).name,point:h.point.toArray()}));},
  audioState:()=>audio.snapshot(),
  weaponVisual:()=>view.snapshot(),
  lastShot:()=>lastShot,
  setInvulnerable:value=>{session.effects.invulnerable=value?Infinity:0;},
  aimAtEnemy:(id,head=true)=>{const z=enemies.list.find(z=>z.id===id);if(z)camera.lookAt(head?enemies.headPosition(z):z.root.position.clone().add(new THREE.Vector3(0,z.kind==='zombie'?40:25,0)));},
  specialState:()=>({meteors:meteors.size,gasClouds:gasClouds.length,boxLocation:world.activeBox.id,box:mysteryBox.snapshot().find(b=>b.id===world.activeBox.id)?.roll??null,boxes:mysteryBox.snapshot(),boxMoves:mysteryBox.moves,fireSale:!!world.fireSale,pickups:powerups.snapshot(),drink:perkDrink.snapshot()}),
  dropPowerup:(type,p)=>{dropPowerup(type,vector(p));return powerups.snapshot();},
  damageEnemy:(id,n=999999)=>{const z=enemies.list.find(z=>z.id===id);if(z)enemies.hurt(z,n);},
  grantScore:n=>session.addPoints(n),
  setBoards:(id,count)=>world.setBoards(world.barriers.find(b=>b.id===id),count),
  spawnCandidates:()=>world.spawnBarriers(session).map(b=>({id:b.id,inside:b.inside.toArray(),outside:b.outside.toArray(),path:world.path(b.inside,player.getFeetPosition()).map(v=>v.toArray())})),
  setRound:n=>{enemies.reset();while(session.round<n)session.nextRound();session.countdown=0;session.spawned=0;session.killed=0;},
});
ctx.expose('kino',kinoApi);
try{
  progress('Loading game data',5);{const m=document.querySelector('meta[name="kino-asset-manifest"]');if(m)await assets.loadManifest(m.content||'asset-manifest.json');}const packLoad=/[?&]pack=0\b/.test(location.search)?Promise.resolve(false):(byteProgress=true,Promise.all([preloadShared(),assets.loadPack(kinoPack(profile.mobile))]));data=await rfetch('game-data.json').then(r=>r.json());session=new Session(data);world=new World(scene,data);await packLoad;byteProgress=true;await world.load(progress);byteProgress=false;try{const fxData=await rfetch('theater-fx.json').then(r=>r.json());theaterFx=new TheaterLighting({scene,world,sunColor:THEATER_WORLD.sunColor,fxData});theaterFx.setGodRays(graphics.preset.godRays);}catch(error){console.warn('[kino] theater light fx unavailable',error);}
  spawn=data.entities.find(e=>e.targetname==='initial_spawn_points'&&e.script_int==='1');
  player=new PlayerController(camera,world.physics,{spawn:vector(spawn.position),spawnIsEye:false,radius:14,height:70,eyeHeight:60,moveSpeed:190,sprintSpeed:285,crouchSpeed:95,gravity:800,jumpHeight:39,fallResetY:-800,maxSubSteps:12,groundSnapSpeed:10,smoothCamera:smoothingEnabled()});
  camera.rotation.set(0,spawn.yaw-Math.PI/2,0);world.setDoors(session);
  progress('Loading weapons and the undead',85);view=new ViewWeapon(viewScene,data,(name,def)=>audio.notify(name,def));enemies=new Enemies(scene,world,data,session,{damage,kill,hit,sound:(kind,p)=>audio.play(kind,Math.max(0,1-p.distanceTo(camera.position)/1000)),voice:(z,gait)=>audio.voice(gait,()=>z.root.position)});
  world.actors=()=>enemies.list;
  powerups=new Powerups(scene,data,audio,collect);perkDrink=new PerkDrink(viewScene,data,audio);mysteryBox=new MysteryBox(scene,world,data,session,audio,toast);
  features=new KinoFeatures({scene,world,data,session,enemies,player,camera,audio,effect,damage,toast});
  await Promise.all([enemies.load(),equipView(),audio.load(),powerups.load(),perkDrink.load(),mysteryBox.load(),features.load()]);player.update(.05,{});ready=true;
  progress('Checking textures',88);await ensureTextures();
  progress('Preparing graphics',90);await prewarm();
  if(!/[?&]cull=0\b/.test(location.search)&&world.staticRoot){try{culler=new OcclusionCuller({root:world.staticRoot,lightDirection:keyDirection,shadows:!!profile.shadows&&graphics.preset.shadows});}catch(error){console.warn('[kino] culling unavailable',error);culler=null;}}cullReady=true;
  progress('Ready',100);ctx.hud.combat(true);ctx.hud.crosshair(true);ctx.setControls(CONTROLS);
  {let hint=contextLost?'Graphics paused. Waiting for Safari to restore the game…':touchControls.mode?'Tap to enter the theater':'Click to capture the mouse · Esc to pause';const missing=assetDiagnostics().failedTextures;if(missing)hint+=` · ${missing} texture${missing>1?'s':''} could not be loaded (see console)`;ctx.setHint(hint);}
}catch(error){console.error(error);errors.push(String(error));byteProgress=false;throw error;}
renderer.info.autoReset=false;
function renderFrame(now){
  if(disposed||document.hidden||contextLost)return;
  const interval=profile.mobile?(active?1000/30:200):0;
  if(lastRendered&&now-lastRendered<interval-1)return;
  lastRendered=now;const dt=Math.min((now-previous)/1000,.06);previous=now;frameTime+=dt;
  if(ready&&started&&active){const scale=adapt.sample(dt*1000);if(scale!==null)renderer.setPixelRatio(ratio()*scale);if(graphics.setting==='auto'&&autoGraphics.sample(dt*1000,adapt.scale<adapt.max-.15))graphics.stepDown();}frameCount++;renderedFrames++;
  if(frameTime>.75){fps=Math.round(frameCount/frameTime);frameTime=0;frameCount=0;perf?.(fps,adapt.scale,renderer.info.render.calls,renderer.info.render.triangles);}
  update(dt);if(theaterFx)theaterFx.update(dt,camera);blood.update(dt);if(world)world.updateBoards(dt);if(csm){camera.updateMatrixWorld();csm.update();}if(culler&&cullReady){culler.update(camera);if(enemies)culler.cullDynamic([...enemies.list.map(z=>z.root),...enemies.dead.map(d=>d.root)],100,40,1600,camera.position);}renderer.info.reset();if(grade)grade.render(scene,camera,viewScene,viewCamera,ready&&started);else{renderer.clear();renderer.render(scene,camera);if(ready&&started){renderer.clearDepth();renderer.render(viewScene,viewCamera);}}
}
resumeRendering();
return {setActive,prepare,restart:async()=>{reset();}};
}
