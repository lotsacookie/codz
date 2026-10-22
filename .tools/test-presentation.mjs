import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const out='artifacts/presentation';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const check=(name,value)=>{assert(value,name);checks.push({name,passed:true});};
const step=async(seconds,options={})=>page.evaluate(({seconds,options})=>{for(let t=0;t<seconds;t+=1/120)lab.view.update(Math.min(1/120,seconds-t),options);lab.draw();return lab.view.snapshot();},{seconds,options});
const snap=async name=>page.screenshot({path:`${out}/${name}.png`});
try{
 await page.route('**/presentation-test.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>body{margin:0;background:#20252a}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/assets/js/vendor/three.module.js","three/addons/":"/assets/js/vendor/jsm/"}}</script><script type="module">
 import * as THREE from 'three';import {ViewWeapon} from '/assets/js/animation.js';import {GameAudio} from '/assets/js/audio.js';
 const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);document.body.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x30383e);scene.add(new THREE.HemisphereLight(0xffffff,0x8899aa,3));
 const light=new THREE.DirectionalLight(0xffefce,2);light.position.set(0,4,2);scene.add(light);
 const camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.01,200);
 const data=await fetch('/assets/game-data.json').then(r=>r.json()),audio=new GameAudio();await audio.load();
 const notes=[],view=new ViewWeapon(scene,data,(name,def)=>{notes.push(name);audio.notify(name,def);});
 await view.equip(data.weapons.m1911_zm);
 window.lab={view,data,notes,audio,camera,renderer,draw:()=>renderer.render(scene,camera)};lab.draw();
 </script>`}));
 await page.goto('http://127.0.0.1:5173/presentation-test.html');await page.waitForFunction(()=>window.lab,null,{timeout:60000});
 const ids=await page.evaluate(()=>Object.keys(lab.data.weapons));
 const poses={};
 for(const id of ids){
  await page.evaluate(id=>lab.view.equip(lab.data.weapons[id]),id);
  const raiseTime=await page.evaluate(id=>lab.data.weapons[id].raiseTime,id);
  const hip=await step(raiseTime+.25);check(id+' rests at the native hip torso',hip.mode==='idle');poses[id]=hip.gun;
  await snap(id+'-hip');
  const aim=await step(.6,{ads:true});check(id+' completes native ADS',aim.aim===1);await snap(id+'-ads');
  await page.evaluate(()=>lab.view.shoot({ads:true}));const fire=await step(.04,{ads:true});check(id+' plays aimed fire',fire.mode==='fire');
  await page.evaluate(()=>{lab.notes.length=0;lab.view.reload(true,2);});await step(.75,{reloading:true});await snap(id+'-reload');
  await step(1.3,{reloading:true});await step(.2);check(id+' finishes reload', (await page.evaluate(()=>lab.view.snapshot())).mode==='idle');
  const sprint=await step(1.2,{sprint:true,moving:true});check(id+' uses its native sprint presentation',sprint.mode==='sprint'&&(sprint.animation.includes('Loop')||id==='ray_gun_zm'));await snap(id+'-sprint');
  await step(.8);check(id+' lowers from sprint', (await page.evaluate(()=>lab.view.snapshot())).mode==='idle');
 }
 // Switch from an aimed/recoiling pose and compare with a clean equip.
 await step(.6,{ads:true});await page.evaluate(()=>lab.view.shoot({ads:true}));await step(.02,{ads:true});
 await page.evaluate(()=>lab.view.equip(lab.data.weapons.mp40_zm));const clean=await step(1);
 check('switching during ADS cannot bake the old pivot into a gun',clean.gun.every((v,i)=>Math.abs(v-poses.mp40_zm[i])<1e-4));
 for(const type of ['knife','bowie'])for(const charge of [false,true]){
  const name=type+(charge?'-stab':'-swipe');
  await page.evaluate(({type,charge})=>lab.view.melee(type,charge),{type,charge});await step(.08);await snap(name+'-early');const strike=await step(.1);
  check(name+' shows the original knife model',strike.knifeVisible.length===1&&strike.knifeVisible[0]===type);
  await snap(name);await step(.2);await snap(name+'-followthrough');await step(1.5);const idle=await page.evaluate(()=>lab.view.snapshot());check(name+' restores the gun and hides the knife',idle.mode==='idle'&&!idle.knifeVisible.length);
 }
 await page.evaluate(()=>{lab.notes.length=0;lab.view.reload(true,2);});await step(2.1,{reloading:true});
 const notes=await page.evaluate(()=>lab.notes);check('reload emits magazine and chamber sounds from native notifies',notes.some(n=>/mag_out/.test(n))&&notes.some(n=>/mag_in/.test(n)));
 check('reload events are emitted once per action',new Set(notes.filter(n=>n.startsWith('sndnt#'))).size===notes.filter(n=>n.startsWith('sndnt#')).length);
 await page.click('canvas');
 const audio=await page.evaluate(async()=>{
  lab.audio.start();await lab.audio.ctx.resume();const results=[];
  const keys=Object.keys(lab.audio.manifest).filter(k=>/knife_whoosh\/|knife_stab_00$|bowie_swing_00$|bowie_stab_00$|m1911\/plr\/shot\/shot_00$|fly_mp40_mag_in$/.test(k));
  for(const key of keys){const buffer=await lab.audio.buffer(key),samples=buffer.getChannelData(0);let peak=0;for(const v of samples)peak=Math.max(peak,Math.abs(v));results.push({key,duration:buffer.duration,peak});}
  lab.audio.knife('swing');lab.audio.knife('hit',true);lab.audio.weapon('shot',lab.data.weapons.m1911_zm);lab.audio.notify('sndnt#fly_mp40_mag_in',lab.data.weapons.mp40_zm);
  return results;
 });
 check('recovered knife, Bowie, gunshot and reload audio decodes into audible samples',audio.length>=6&&audio.every(a=>a.duration>0&&a.peak>.001&&Number.isFinite(a.peak)));
 await page.waitForFunction(()=>lab.audio.played.filter(k=>k.startsWith('resident/')).length>=4);
 check('game sound routes play native resident cues',true);fs.writeFileSync(`${out}/audio.json`,JSON.stringify(audio,null,2));
 check('browser has no rendering or loading errors',!errors.length);
}catch(error){checks.push({passed:false,error:String(error),stack:error.stack});console.error(error);process.exitCode=1;}
finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify({checks,errors},null,2));console.log(checks.filter(c=>c.passed).length,'presentation checks passed',errors);await browser.close();}
