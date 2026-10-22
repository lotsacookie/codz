import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const data=JSON.parse(fs.readFileSync('export/web/assets/game-data.json'));
const upgraded=process.argv.includes('--upgraded'),selected=process.argv.slice(2).filter(a=>a!=='--upgraded');
const browser=await chromium.launch({executablePath:['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],checks=[];
fs.mkdirSync('artifacts/weapons',{recursive:true});
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await page.goto('http://127.0.0.1:5173/?map=kino');await page.waitForFunction(()=>kino?.debug.getState().ready,null,{timeout:120000});
 await page.click('#start');
 for(const [id,base]of Object.entries(data.weapons)){
  const def=upgraded?{...base,...base.upgrade}:base;
  if(selected.length&&!selected.includes(id))continue;
  await page.evaluate(id=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.giveWeapon(id);},id);
  await page.waitForFunction(()=>kino.debug.getState().viewmodelReady,null,{timeout:20000});
  if(upgraded){
   await page.evaluate(({power,pap})=>{kino.debug.grantPoints(5000);kino.debug.teleportPlayer(power);kino.debug.interact();kino.debug.teleportPlayer(pap);if(!kino.debug.interact())throw new Error('Pack-a-Punch purchase failed');kino.debug.step(4.5);if(!kino.debug.interact())throw new Error('Pack-a-Punch retrieval failed');},{power:data.entities.find(e=>e.targetname==='use_elec_switch').position,pap:data.entities.find(e=>e.targetname==='zombie_vending_upgrade').position});
   await page.waitForFunction(()=>kino.debug.getState().viewmodelReady,null,{timeout:20000});
  }
  await page.evaluate(duration=>kino.debug.step(duration+.25),def.raiseTime??.5);
  let state=await page.evaluate(()=>kino.debug.getState());assert.equal(state.weapon.id,id);assert.equal(state.weapon.mag,def.clipSize);
  await page.screenshot({path:`artifacts/weapons/${id}${upgraded?'-upgraded':''}.png`});
  await page.mouse.down();await page.waitForTimeout(25);await page.mouse.up();state=await page.evaluate(()=>kino.debug.getState());assert(state.weapon.mag<def.clipSize,id+' fires');
  await page.keyboard.press('KeyR');await page.evaluate(()=>kino.debug.step(8));state=await page.evaluate(()=>kino.debug.getState());assert.equal(state.weapon.mag,def.clipSize,id+' reloads');
  checks.push({id,passed:true,model:def.model,animations:Object.keys(def.animations).length});console.log('PASS',id,'loads, fires, reloads');
 }
 assert.equal(errors.length,0,errors.join('\n'));
}catch(e){checks.push({passed:false,error:String(e),stack:e.stack});console.error(e);process.exitCode=1;}
finally{fs.writeFileSync('artifacts/weapons/'+(upgraded?'upgraded-report':selected.length?'targeted-report':'report')+'.json',JSON.stringify({checks,errors},null,2));await browser.close();}
