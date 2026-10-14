import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out='artifacts/melee';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const check=(name,ok)=>{assert(ok,name);checks.push({name,passed:true});};
async function fresh(){
 await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.teleportPlayer([0,100,1120]);});
 await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);await page.evaluate(()=>kino.debug.step(.6));
}
try{
 await page.goto('http://127.0.0.1:5173/?map=kino');await page.waitForFunction(()=>kino?.debug.getState().ready,null,{timeout:120000});await page.click('#start');
 await fresh();
 const strike=await page.evaluate(()=>{
  const p=kino.debug.getState().player.feet,id=kino.debug.spawnEnemy([p[0],p[1],p[2]-60]);kino.debug.aimAtEnemy(id,false);
  const started=kino.debug.melee(),second=kino.debug.melee(),fired=kino.debug.shoot(),before=kino.debug.getState();
  kino.debug.step(.17);return {started,second,fired,before,after:kino.debug.getState(),visual:kino.debug.weaponVisual()};
 });
 check('knife starts with no immediate damage',strike.started&&strike.before.kills===0);
 check('one swing blocks a second swing and firing',!strike.second&&!strike.fired&&strike.after.weapon.mag===8);
 check('native strike delay produces one 150-damage knife kill and 130 points',strike.after.kills===1&&strike.after.points===630);
 check('successful melee uses the original stab animation',strike.visual.animation==='knife:meleeChargeAnim');
 await page.screenshot({path:`${out}/knife-hit.png`});
 await page.evaluate(()=>kino.debug.step(1.3));check('knife recovery restores the gun',!(await page.evaluate(()=>kino.debug.weaponVisual())).knifeVisible.length);
 await fresh();
 await page.evaluate(()=>{kino.debug.shoot();kino.debug.reload();});await page.keyboard.press('KeyV');
 const interrupt=await page.evaluate(()=>({state:kino.debug.getState(),visual:kino.debug.weaponVisual()}));
 check('V cancels reload and plays the native miss slash',interrupt.state.reloadLeft===0&&interrupt.visual.animation==='knife:meleeAnim');
 await page.evaluate(()=>kino.debug.step(2));const ammo=await page.evaluate(()=>kino.debug.getState().weapon);
 check('cancelled reload cannot add ammunition later',ammo.mag===7&&ammo.reserve===32);
 await fresh();const miss=await page.evaluate(()=>{
  const p=kino.debug.getState().player.feet,id=kino.debug.spawnEnemy([p[0],p[1],p[2]-210]);kino.debug.aimAtEnemy(id,false);kino.debug.melee();kino.debug.step(.18);
  return {state:kino.debug.getState(),visual:kino.debug.weaponVisual()};
 });check('out-of-range swipe cannot damage a zombie',miss.state.enemies[0].health===150&&miss.visual.animation==='knife:meleeAnim');
 await fresh();await page.evaluate(()=>{kino.debug.grantPoints(3000);const e=kino.debug.getEntities().find(e=>e.targetname==='bowie_upgrade');kino.debug.teleportPlayer(e.position);kino.debug.step(.2);});
 await page.keyboard.press('KeyF');check('Bowie purchase equips the upgrade',(await page.evaluate(()=>kino.debug.getState())).bowie);
 await page.evaluate(()=>{kino.debug.teleportPlayer([0,100,1120]);kino.debug.step(.6);kino.debug.setRound(10);const p=kino.debug.getState().player.feet,id=kino.debug.spawnEnemy([p[0],p[1],p[2]-60]);kino.debug.aimAtEnemy(id,false);kino.debug.melee();kino.debug.step(.17);});
 const bowie=await page.evaluate(()=>({state:kino.debug.getState(),visual:kino.debug.weaponVisual()}));
 check('Bowie uses its own blade and animation',bowie.visual.melee==='bowie'&&bowie.visual.animation==='bowie:meleeChargeAnim');
 check('native Bowie damage is 1000; a round-ten zombie survives at 45 health',bowie.state.enemies.some(z=>z.health===45));
 await page.screenshot({path:`${out}/bowie-hit.png`});
 await page.waitForFunction(()=>kino.debug.audioState().played.some(k=>k.includes('/bowie/bowie_stab/')));
 check('melee impacts reach the native audio playback path',true);
 await page.evaluate(()=>{kino.debug.reset();});await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);
 check('reset clears the knife action',!(await page.evaluate(()=>kino.debug.weaponVisual())).knifeVisible.length);
 check('no browser errors',errors.length===0);
}catch(e){checks.push({passed:false,error:String(e),stack:e.stack});console.error(e);process.exitCode=1;}
finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify({checks,errors},null,2));console.log(checks.filter(c=>c.passed).length,'melee checks passed');await browser.close();}
