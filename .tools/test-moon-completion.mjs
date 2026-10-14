import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const out=path.resolve(import.meta.dirname,'../artifacts/moon/completion');fs.mkdirSync(out,{recursive:true});
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
const check=(name,passed,details=null)=>{checks.push({name,passed:!!passed,details});if(!passed)throw new Error(name+': '+JSON.stringify(details));console.log('PASS',name);};
async function approach(kind,id=null){
  const result=await page.evaluate(async({kind,id})=>{
    const T=await import('/vendor/three.module.js'),m=moon,f=m.features,t=f.targets.find(t=>t.kind===kind&&(id===null||t.e.id===id));if(!t)return {error:'missing '+kind+' '+id};
    const center=new T.Vector3(...t.e.position),region=center.x>10000?'earth':'moon';
    if(m.combat.session.area!==region){m.debug.relocate(region==='earth'?'area51':'receiving');m.combat.enemies.reset();}
    m.combat.enemies.spawnDelay=1e9;m.combat.enemies.nextAstroRound=Infinity;
    for(const radius of [64,85,105])for(let i=0;i<24;i++){
      const a=i/24*Math.PI*2,guess=center.clone().add(new T.Vector3(Math.cos(a)*radius,0,Math.sin(a)*radius));
      const floor=f.raycast(new T.Ray(guess.clone().add(new T.Vector3(0,100,0)),new T.Vector3(0,-1,0)),0,260);
      if(!floor)continue;const at=floor.position.clone().add(new T.Vector3(0,3,0));
      m.player.setPosition(at);for(let frame=0;frame<10;frame++)m.player.update(.02,{});m.camera.lookAt(center);const got=f.findTarget();
      if(got?.e.id===t.e.id)return {id:t.e.id,position:at.toArray(),label:got.label};
    }
    return {error:'unreachable interaction',kind,id:t.e.id,position:t.e.position,nearest:f.findTarget()?.label};
  },{kind,id});
  check('Reach '+kind+(id===null?'':' '+id),!result.error,result);return result;
}
async function use(kind,id=null,hold=0){await approach(kind,id);await page.keyboard.down('KeyF');if(hold>=5){await page.waitForTimeout(150);check('Hack starts',await page.evaluate(()=>!!moon.features.hack),await page.evaluate(()=>({target:moon.debug.target()?.kind,notice:document.querySelector('#notice').textContent})));await page.waitForFunction(()=>!moon.features.hack,null,{timeout:15000});}else if(hold)await page.waitForTimeout(hold*1000);else await page.waitForTimeout(80);await page.keyboard.up('KeyF');await page.waitForTimeout(100);}
async function prepare(){await page.evaluate(()=>{const s=moon.combat.session;s.effects.invulnerable=Infinity;s.points=100000;moon.state.equipSuit();moon.combat.enemies.reset();moon.combat.enemies.spawnDelay=1e9;moon.combat.enemies.nextAstroRound=Infinity;for(const d of moon.data.doors){s.openDoors.add(d.name);if(d.flag)s.flags.add(d.flag);moon.opened.add(d.name);}for(let i=0;i<30;i++)moon.debug.update(.05);});}
try{
  await page.goto(process.env.MOON_URL??'http://127.0.0.1:5173/?map=moon',{waitUntil:'load',timeout:180000});
  await page.waitForFunction(()=>window.moon?.ready||document.querySelector('#error').textContent,null,{timeout:180000});
  check('Complete build loads',await page.evaluate(()=>!!window.moon?.features.box),await page.locator('#error').textContent());
  await page.locator('#start').click();await page.waitForFunction(()=>moon.debug.snapshot().active);await prepare();
  await page.evaluate(()=>{moon.state.power=true;moon.combat.session.power=true;});
  if(process.env.MOON_TEST_FROM!=='hack'){
  const perks=await page.evaluate(()=>moon.features.targets.filter(t=>t.kind==='perk').map(t=>({id:t.e.id,perk:t.perk})));
  for(const {id,perk}of perks){
    await page.evaluate(perk=>{const s=moon.combat.session;s.perks.clear();s.drinking=null;s.drinkLeft=0;if(perk==='specialty_fastreload')s.earthVisits=1;else if(perk==='specialty_armorvest')s.earthVisits=0;moon.features.syncPerkMachine();},perk);
    await use('perk',id);check('Drink starts: '+perk,await page.evaluate(p=>moon.combat.session.drinking===p,perk));
    await page.waitForFunction(p=>moon.combat.session.perks.has(p),perk,{timeout:6000});check('Perk equipped: '+perk,true);
  }
  await page.screenshot({path:path.join(out,'perks.png')});
  const boxId=await page.evaluate(()=>{moon.combat.session.random=()=>.37;return moon.features.box.world.activeBox.id;});await use('box',boxId);
  check('Box roll starts',await page.evaluate(id=>!!moon.features.box.boxes.get(id).roll,boxId));
  await page.waitForFunction(id=>moon.features.box.at(moon.features.targets.find(t=>t.kind==='box'&&t.e.id===id).e)?.ready,boxId,{timeout:15000});
  check('Mystery Box displays native offered item',await page.evaluate(id=>!!moon.features.box.boxes.get(id).model,boxId));
  await page.screenshot({path:path.join(out,'box.png')});await use('box',boxId);check('Mystery Box item collected',await page.evaluate(id=>!moon.features.box.boxes.get(id).roll,boxId));
  const moved=await page.evaluate(id=>{const f=moon.features,s=moon.combat.session,b=f.box.boxes.get(id);f.box.update(1);f.box.uses=7;const points=s.points;moon.debug.interact();s.time+=9.1;f.box.update(9.1);return {moved:f.box.world.activeBox.id!==id,refunded:s.points===points};},boxId);
  check('Teddy bear refunds points and relocates the box',moved.moved&&moved.refunded,moved);
  await page.evaluate(async()=>{moon.combat.session.giveWeapon('galil_zm');await moon.combat.equip();});
  await use('pack');check('Pack-a-Punch blocks firing during upgrade',await page.evaluate(()=>!!moon.combat.session.pack&&!moon.combat.session.fire()));
  await page.waitForTimeout(5200);await use('pack');check('Pack-a-Punch retrieves upgraded weapon',await page.evaluate(()=>moon.combat.session.weapon.upgraded));
  }
  const hacker=await page.evaluate(()=>moon.features.quest.hackerId);await use('hacker',hacker);
  check('Hacker replaces the suit',await page.evaluate(()=>moon.combat.session.hacker&&!moon.state.hasSuit&&!moon.state.suit));
  await page.evaluate(()=>moon.features.quest.activateDigger('hangar'));await use('digger',1576,1);
  check('Releasing F cancels hack',await page.evaluate(()=>!moon.features.hack&&moon.features.quest.diggers.hangar.phase==='warning'));
  await use('digger',1576,5.5);check('Holding F retracts excavator',await page.evaluate(()=>moon.features.quest.diggers.hangar.phase==='idle'));
  await page.evaluate(()=>{moon.state.equipSuit();moon.combat.session.hacker=false;});
  const weaponIds=await page.evaluate(()=>Object.keys(moon.combat.data.weapons).filter(id=>!['minigun_zm','microwavegundw_zm'].includes(id)));
  for(const id of weaponIds){
    const result=await page.evaluate(async id=>{const c=moon.combat;c.session.effects.death_machine=0;c.session.perks.clear();c.session.giveWeapon(id);await c.equip();for(let i=0;i<100;i++)c.view.update(.05);const before=c.session.weapon.mag;c.session.fireLeft=0;const fired=c.shot();return {ready:c.view.ready,fired,spent:before-c.session.weapon.mag};},id);
    check('Native weapon loads and fires: '+id,result.ready&&result.fired&&result.spent===1,result);
  }
  await page.evaluate(async()=>{moon.combat.session.giveWeapon('microwavegun_zm');await moon.combat.equip();});await page.keyboard.press('KeyB');await page.waitForTimeout(1200);
  check('B splits Wave Gun into Zap Guns',await page.evaluate(()=>moon.combat.session.def.id==='microwavegundw_zm'&&moon.combat.view.ready));await page.screenshot({path:path.join(out,'zap-guns.png')});
  const dualBefore=await page.evaluate(()=>{moon.combat.session.fireLeft=0;return moon.combat.session.weapon.mag;});await page.mouse.click(720,450,{button:'right'});await page.waitForTimeout(100);
  check('Right mouse fires the left Zap Gun',await page.evaluate(before=>moon.combat.session.weapon.mag===before-1&&!moon.combat.ads,dualBefore));
  await page.evaluate(()=>{moon.combat.session.giveEquipment('zombie_black_hole_bomb');});await page.keyboard.press('KeyX');await page.waitForTimeout(100);
  check('X throws native equipment and consumes a charge',await page.evaluate(()=>moon.combat.session.equipmentAmmo===2&&moon.combat.grenades.some(g=>g.equipment)));
  await page.evaluate(()=>{const g=moon.combat.grenades.find(g=>g.equipment);g.life=.01;});await page.waitForTimeout(200);check('Gersh Device creates a black hole',await page.evaluate(()=>moon.features.portals.length===1));
  const actors=await page.evaluate(async()=>{const T=await import('/vendor/three.module.js'),c=moon.combat;moon.debug.relocate('receiving');moon.state.equipSuit();c.enemies.reset();c.enemies.spawnDelay=1e9;c.enemies.nextAstroRound=Infinity;const p=moon.player.getFeetPosition();return ['astronaut','nova','dog'].map((kind,i)=>{const at=moon.navigation.closest(p.clone().add(new T.Vector3(100+i*70,0,0)),{x:180,y:160,z:180})??moon.navigation.closest(p);const z=c.enemies.spawn(at,null,kind);return {kind:z.kind,meshes:z.root.children.length,actions:Object.keys(z.rig.actions)};});});
  check('Special enemies have native models and animation',actors.every(a=>a.meshes>0&&a.actions.includes('walk')),actors);await page.screenshot({path:path.join(out,'special-enemies.png')});
  const special=await page.evaluate(()=>{const c=moon.combat,s=c.session,astro=c.enemies.list.find(z=>z.kind==='astronaut'),nova=c.enemies.list.find(z=>z.kind==='nova');
    c.enemies.hurt(astro,1e9,false,false,'wave');const immune=c.enemies.list.includes(astro);c.enemies.hurt(nova,nova.health);const gas=moon.features.fx.some(f=>f.gas);const points=s.points;c.collect('nuke');return {immune,gas,nukePoints:s.points-points,remaining:c.enemies.list.map(z=>z.kind)};});
  check('Astronaut immunity, Nova gas and fixed Nuke reward',special.immune&&special.gas&&special.nukePoints===400&&special.remaining.join()==='astronaut',special);
  await page.evaluate(()=>{moon.combat.enemies.reset();moon.combat.enemies.spawnDelay=1e9;moon.combat.enemies.nextAstroRound=Infinity;moon.combat.session.effects.invulnerable=Infinity;});
  await use('bowie');check('Bowie wall buy equips upgraded knife',await page.evaluate(()=>moon.combat.session.bowie));
  const barrier=await page.evaluate(()=>{const f=moon.features,b=f.barriers.find(b=>b.boards.length===6);f.setBoards(b,0);return b.id;});
  await use('barrier',barrier,1.6);check('Holding F repairs native boards',await page.evaluate(id=>moon.features.barriers.find(b=>b.id===id).count>=1,barrier));
  const carpenter=await page.evaluate(()=>{const f=moon.features;for(const b of f.barriers)f.setBoards(b,0);moon.combat.collect('carpenter');return f.barriers.every(b=>b.count===b.boards.length);});check('Carpenter repairs every barricade',carpenter);
  const jumps=await page.evaluate(()=>{const f=moon.features,s=moon.combat.session;s.power=true;return f.all('trig_jump_pad').map(pad=>{
    f.flight=null;f.padCooldown=0;moon.player.setPosition(new (moon.camera.position.constructor)(...pad.position));f.updateJump(.01);if(!f.flight)return {id:pad.id,error:'did not launch'};
    const end=f.flight.to.clone();for(let n=0;n<300&&f.flight;n++)f.updateJump(.05);return {id:pad.id,landed:!f.flight&&moon.player.getFeetPosition().distanceTo(end)<.01,position:end.toArray()};});});
  check('All eleven jump pads launch and reach their destinations',jumps.length===11&&jumps.every(p=>p.landed),jumps);
  await page.evaluate(()=>{moon.debug.relocate('receiving');moon.combat.enemies.reset();moon.combat.enemies.spawnDelay=1e9;moon.combat.enemies.nextAstroRound=Infinity;});
  await page.keyboard.press('Tab');check('Objective journal opens',await page.locator('#journal').isVisible());
  await page.keyboard.press('Escape');const time=await page.evaluate(()=>moon.features.quest.elapsed);await page.waitForTimeout(250);check('Pause freezes quest timers',await page.evaluate(t=>moon.features.quest.elapsed===t,time));
  await page.locator('#new-run').click();await page.waitForFunction(()=>moon.debug.snapshot().active);check('New run resets quest, equipment, perks and hazards',await page.evaluate(()=>{const s=moon.combat.session,q=moon.features.quest;return q.stage==='power'&&!s.equipment&&!s.perks.size&&!s.hacker&&!q.breaches.size;}));
  check('No browser errors or missing resources',errors.length===0,errors);
}catch(e){console.error(e);errors.push(String(e));await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));await browser.close();}
