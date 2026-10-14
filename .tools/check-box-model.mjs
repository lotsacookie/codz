import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1000,height:600}});
try{
 await page.goto('http://127.0.0.1:5173/?map=kino');await page.waitForFunction(()=>kino?.debug.getState().ready);
 const result=await page.evaluate(async()=>{
  const THREE=await import('three'),{MysteryBox}=await import('./mystery-box.js'),data=await fetch('game-data.json').then(r=>r.json());
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x1c2125);scene.add(new THREE.HemisphereLight(0xffffff,0x4a4130,3));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(0,20,40);scene.add(light);
  const boxes=new MysteryBox(scene,{boxLocations:[]},data,{},{});await boxes.load();const b={display:new THREE.Group()};scene.add(b.display);boxes.show(b,'m16_zm');
  const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.1,1000);camera.position.set(0,7,65);camera.lookAt(0,0,0);const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.domElement.style.cssText='position:fixed;inset:0;z-index:9999';document.body.append(renderer.domElement);renderer.render(scene,camera);
  return ['tag_scope_colt','tag_suppressor','tag_m203'].map(name=>({name,scale:b.model.getObjectByName(name).scale.x}));
 });assert(result.every(b=>b.scale<.00001));await page.screenshot({path:'artifacts/zombies/box-m16-attachments.png'});console.log('Native world-model hidden attachments verified',result);
}finally{await browser.close();}
