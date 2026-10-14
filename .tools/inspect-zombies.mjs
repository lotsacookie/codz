import {chromium} from 'playwright-core';
import fs from 'node:fs';
const out='artifacts/zombies';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await page.goto('http://127.0.0.1:5173/?map=kino');await page.waitForFunction(()=>kino?.debug.getState().ready,null,{timeout:120000});await page.click('#start');
 await page.evaluate(()=>{kino.debug.setInvulnerable(true);kino.debug.step(.6);kino.debug.grantPoints(10000);});
 const perk=await page.evaluate(()=>kino.debug.getEntities().find(e=>e.script_noteworthy==='specialty_quickrevive'));
 await page.evaluate(e=>{kino.debug.teleportPlayer(e.position);kino.debug.lookAt([e.position[0],e.position[1]+45,e.position[2]-70]);kino.debug.interact();kino.debug.step(.6);kino.debug.pause();},perk);
 console.log('Drink',await page.evaluate(()=>kino.debug.specialState().drink));await page.evaluate(()=>document.getElementById('menu').hidden=true);await page.screenshot({path:out+'/drink.png'});
 await page.evaluate(()=>{kino.debug.setActive(true);kino.debug.step(4);});
 const box=await page.evaluate(()=>kino.debug.getEntities().find(e=>e.id===kino.debug.specialState().boxLocation));
 await page.evaluate(e=>{kino.debug.teleportPlayer(e.position);kino.debug.lookAt([e.position[0]+30,e.position[1]+25,e.position[2]]);kino.debug.interact();kino.debug.step(.6);kino.debug.pause();},box);
 console.log('Box',await page.evaluate(()=>kino.debug.specialState()));await page.evaluate(()=>document.getElementById('menu').hidden=true);await page.screenshot({path:out+'/box.png'});
 await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.teleportPlayer([0,100,1120]);kino.debug.step(.6);const p=kino.debug.getState().player.feet;['full_ammo','insta_kill','double_points','nuke','carpenter','fire_sale'].forEach((k,i)=>kino.debug.dropPowerup(k,[p[0]-180+i*72,p[1],p[2]-220]));kino.debug.lookAt([p[0],p[1]+40,p[2]-220]);kino.debug.step(.1);kino.debug.pause();});
 await page.evaluate(()=>document.getElementById('menu').hidden=true);await page.screenshot({path:out+'/powerups.png'});
 console.log('Errors',errors);fs.writeFileSync(out+'/inspection.json',JSON.stringify({errors,state:await page.evaluate(()=>kino.debug.specialState())},null,2));
}finally{await browser.close();}
