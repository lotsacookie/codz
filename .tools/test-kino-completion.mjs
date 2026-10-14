import { chromium } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out='artifacts/kino-completion';fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync('export/web/game-data.json'));
const browser=await chromium.launch({executablePath:['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
const state=()=>page.evaluate(()=>kino.debug.getState()),features=()=>page.evaluate(()=>kino.debug.completionState()),step=n=>page.evaluate(n=>kino.debug.step(n),n);
const pass=name=>{checks.push({name,passed:true});console.log('PASS',name);};
async function ready(){await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);await step(2.5);}
async function fresh(){await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.setAutoSpawn(false);kino.debug.grantPoints(100000);kino.debug.teleportPlayer([0,100,1120]);});await ready();}
async function station(e){assert(e);await page.evaluate(p=>{kino.debug.teleportPlayer(p);kino.debug.step(.15);},e.position);}
async function use(e){await station(e);return page.evaluate(()=>kino.debug.interact());}
const entity=name=>data.entities.find(e=>e.targetname===name);
const power=()=>use(entity('use_elec_switch'));
async function snap(name){await page.evaluate(()=>{kino.debug.pause();document.getElementById('menu').hidden=true;document.body.classList.remove('menu-open');});await page.screenshot({path:out+'/'+name+'.png'});await page.evaluate(()=>kino.debug.resume());}
try{
  await page.goto(process.env.KINO_URL??'http://127.0.0.1:5173/?map=kino');await page.waitForFunction(()=>kino?.debug.getState().ready,null,{timeout:120000});await page.click('#start');await fresh();
  assert(await use(entity('claymore_purchase')));assert.equal((await state()).claymores,2);
  await page.evaluate(()=>{kino.debug.teleportPlayer([0,100,1120]);kino.debug.lookAt([0,150,800]);kino.debug.step(.5);});await page.keyboard.press('Digit4');assert.equal((await state()).claymores,1);let f=await features();assert.equal(f.mines.length,1);
  await step(1);const mine=f.mines[0];const victim=await page.evaluate(m=>kino.debug.spawnEnemy(m.position.map((x,i)=>x+m.forward[i]*55)),mine);await step(.6);f=await features();assert.equal(f.mines.length,0);assert((await state()).enemies.find(z=>z.id===victim)?.health<150||!(await state()).enemies.some(z=>z.id===victim));pass('Claymore purchase, keyboard placement, direction sensor and timed blast');
  await fresh();await page.evaluate(()=>{kino.debug.giveMonkeys();kino.debug.lookAt([0,110,850]);});await page.keyboard.press('KeyX');assert.equal((await state()).monkeys,2);assert.equal((await features()).projectiles.length,1);await step(3);f=await features();assert(f.projectiles[0].stuck,'monkey settles on floor');const bomb=f.projectiles[0].position,feet=(await state()).player.feet;
  const lureVictim=await page.evaluate(({bomb,feet})=>kino.debug.spawnEnemy(bomb.map((n,i)=>i===1?feet[1]:(n+feet[i])/2)),{bomb,feet});
  const beforeLure=(await state()).enemies.find(z=>z.id===lureVictim).position;await step(1);const afterLure=(await state()).enemies.find(z=>z.id===lureVictim).position;
  assert(Math.hypot(afterLure[0]-bomb[0],afterLure[2]-bomb[2])<Math.hypot(beforeLure[0]-bomb[0],beforeLure[2]-bomb[2]),'monkey attracts zombies away from the player');await snap('monkey');await step(6);assert.equal((await features()).projectiles.length,0);pass('Monkey Bomb throw, fuse and cleanup use separate ammunition');
  await fresh();for(const id of ['ray_gun_zm','m72_law_zm','china_lake_zm','crossbow_explosive_zm','knife_ballistic_zm']){
    await page.evaluate(id=>{kino.debug.clearEnemies();kino.debug.giveWeapon(id);kino.debug.teleportPlayer([0,100,1120]);},id);await ready();
    const target=await page.evaluate(()=>{const p=kino.debug.getState().player.feet,id=kino.debug.spawnEnemy([p[0],p[1],p[2]-210]);kino.debug.aimAtEnemy(id,false);return id;});
    const fired=await page.evaluate(()=>kino.debug.shoot());assert(fired,id+' fires');assert((await features()).projectiles.some(p=>p.id===id));await step(.5);const z=(await state()).enemies.find(z=>z.id===target);assert(!z||z.health<150,id+' hits after flight');await step(2);pass(id+' has projectile flight and impact damage');
  }
  await fresh();await page.evaluate(()=>{kino.debug.giveWeapon('knife_ballistic_zm');kino.debug.setRound(3);});await ready();
  const bladeVictim=await page.evaluate(()=>{const p=kino.debug.getState().player.feet,id=kino.debug.spawnEnemy([p[0],p[1],p[2]-65]);kino.debug.aimAtEnemy(id,false);return id;});
  assert(await page.evaluate(()=>kino.debug.melee()));await step(.3);assert(!(await state()).enemies.some(z=>z.id===bladeVictim));pass('Ballistic Knife uses its native melee clip and 500 damage');
  await fresh();assert(!await use(data.entities.find(e=>e.script_noteworthy==='auto_turret_trigger')));assert(await power());const turret=data.entities.find(e=>e.script_noteworthy==='auto_turret_trigger');assert(await use(turret));const before=(await state()).points;assert(!await use(turret));assert.equal((await state()).points,before);
  const base=data.entities.find(e=>e.classname==='misc_turret'&&e.targetname===turret.target);const tid=await page.evaluate(p=>kino.debug.spawnEnemy([p[0]+120,p[1],p[2]+40]),base.position);await step(1.2);assert(!(await state()).enemies.some(z=>z.id===tid));await snap('turret');await step(30);assert((await features()).turrets.every(t=>!t.active));pass('Powered turret charges once, fires at visible enemies and shuts down');
  await fresh();await power();const pap=entity('zombie_vending_upgrade');assert(await use(pap));assert((await state()).pack);assert(!await page.evaluate(()=>kino.debug.shoot()));await step(4.5);await snap('pack-ready');assert(await use(pap));await ready();assert.equal((await state()).weapon.name,'Mustang & Sally');assert.equal((await state()).weapon.mag,12);await snap('mustang-sally');pass('Pack-a-Punch reserves, displays and returns Mustang & Sally');
  for(const id of ['m16_zm','aug_acog_zm','hs10_zm','pm63_zm','cz75dw_zm','crossbow_explosive_zm']){
    await page.evaluate(id=>kino.debug.giveWeapon(id),id);await ready();assert(await use(pap));await step(4.5);assert(await use(pap));await ready();assert((await state()).weapon.upgraded);await snap('upgrade-'+id);
    if(['m16_zm','aug_acog_zm'].includes(id)){await page.keyboard.press('Digit5');await ready();assert((await state()).attachmentMode);assert(await page.evaluate(()=>kino.debug.shoot()));await page.keyboard.press('Digit5');await ready();assert(!(await state()).attachmentMode);}
    pass(id+' native upgrade model and controls');
  }
  await fresh();await power();const reels=(await features()).events.reels;
  for(const reel of reels){assert(await use(data.entities.find(e=>e.id===reel.id)));assert((await features()).events.carried);await step(.5);assert((await state()).player.feet[1]>-500,'hidden rooms do not trigger fall reset');await snap('reel-'+reel.film);assert(await use(entity('trigger_change_projector_reels')));}
  assert.equal((await features()).events.installed.length,3);await page.evaluate(()=>{kino.debug.teleportPlayer([0,70,-750]);kino.debug.lookAt([0,232,-1424]);});await step(7);await snap('projector');pass('All three randomized reels can be reached, carried and projected');
  await fresh();await power();assert(await use(entity('trigger_teleport_pad_0')));assert(await use(data.entities.find(e=>e.targetname==='pf16_auto1'&&e.classname==='trigger_use')));assert(await use(entity('trigger_teleport_pad_0')));await step(2.1);assert((await state()).player.feet[1]>300);await step(31);await step(6);assert((await state()).player.feet[2]>1000);pass('Teleporter round trip returns safely after projection and optional hidden room');
  await fresh();assert.equal((await features()).mines.length,0);assert.equal((await features()).projectiles.length,0);assert.equal((await features()).events.installed.length,0);assert(!(await state()).pack);assert.equal(errors.length,0,errors.join('\n'));pass('Restart clears all new features; no browser or asset errors');
}catch(e){console.error(e);checks.push({name:'Failure',passed:false,error:String(e),stack:e.stack,state:await state(),features:await features()});process.exitCode=1;await snap('failure');}
finally{fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));await browser.close();}
