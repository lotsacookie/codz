// Rendered integration playthrough. Uses controlled placement, supplied inventory,
// accelerated waits and combat events; never assigns a quest stage or completion.
import {chromium} from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const out=path.resolve(import.meta.dirname,'../artifacts/moon/quest');fs.mkdirSync(out,{recursive:true});
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
function check(name,pass,details=null){checks.push({name,passed:!!pass,details});if(!pass)throw Error(name+': '+JSON.stringify(details));console.log('PASS',name);}
async function stage(name){const actual=await page.evaluate(()=>moon.features.quest.stage);check('Quest reaches '+name,actual===name,actual);}
async function use(kind,id=null,hold=0){const r=await page.evaluate(({kind,id,hold})=>qa.use(kind,id,hold),{kind,id,hold});check('Interact '+kind+(id===null?'':' '+id),r.ok,r);}
async function simon(){
  const r=await page.evaluate(()=>{const q=moon.features.quest,start=q.stage;let presses=0,limit=80;
    while(q.stage===start&&limit--){q.update(Math.max(0,q.sequenceShowUntil-q.elapsed)+.01);for(const color of q.sequence.slice(0,q.sequenceLength)){
      const e=q.all('sq_ss_button').find(e=>Number(e.script_int)===color),r=qa.use('sq_ss_button',e.id);if(!r.ok)return r;presses++;
    }}return {ok:q.stage!==start,presses,stage:q.stage};});check('Color sequence controls advance quest',r.ok,r);
}
async function blast(type,entity){const r=await page.evaluate(({type,entity})=>qa.blast(type,moon.features.one(entity).position),{type,entity});check('Throw '+type+' at '+entity,r.ok,r);}
async function souls(all=false){const r=await page.evaluate(all=>{
  const c=moon.combat,q=moon.features.quest,T=qa.T;c.enemies.reset();c.enemies.spawnDelay=1e9;c.enemies.nextAstroRound=Infinity;
  const tanks=[q.one('sq_first_tank'),...(all?q.all('sq_second_tank'):[])];
  for(const tank of tanks)for(let i=0;i<25;i++){const z=c.enemies.spawn(new T.Vector3(...tank.position));c.enemies.hurt(z,z.health,false,false,'bullet');}
  return {stage:q.stage,tanks:q.tanks};},all);check(all?'Four collectors count 100 actual enemy deaths':'First collector counts 25 actual enemy deaths',r.stage===(all?'swap':'switch'),r);}
try{
  await page.goto(process.env.MOON_URL??'http://127.0.0.1:5173/?map=moon',{waitUntil:'load',timeout:180000});
  await page.waitForFunction(()=>window.moon?.ready||document.querySelector('#error').textContent,null,{timeout:180000});
  check('Moon loads',await page.evaluate(()=>!!window.moon?.ready),await page.locator('#error').textContent());
  await page.locator('#start').click();await page.waitForFunction(()=>moon.debug.snapshot().active);
  await page.evaluate(async()=>{
    const T=await import('/vendor/three.module.js'),m=moon,f=m.features,s=m.combat.session;
    s.random=()=>.37;s.points=100000;s.effects.invulnerable=Infinity;m.state.equipSuit();
    for(const d of m.data.doors){s.openDoors.add(d.name);if(d.flag)s.flags.add(d.flag);m.opened.add(d.name);}
    m.debug.relocate('receiving');m.combat.enemies.reset();m.combat.enemies.spawnDelay=1e9;m.combat.enemies.nextAstroRound=Infinity;
    for(let i=0;i<30;i++)m.debug.update(.05);
    window.qa={T,approach(kind,id=null){
      const t=kind==='power'?{e:m.data.entities.find(e=>e.targetname==='use_elec_switch'),kind}:f.targets.find(t=>t.kind===kind&&(id===null||t.e.id===id));
      if(!t)return {ok:false,error:'missing',kind,id};
      const center=new T.Vector3(...t.e.position),area=center.x>10000?'earth':'moon';
      if(s.area!==area){m.debug.relocate(area==='earth'?'area51':'receiving');m.combat.enemies.reset();m.combat.enemies.spawnDelay=1e9;m.combat.enemies.nextAstroRound=Infinity;}
      for(const radius of [50,65,85,105])for(let i=0;i<24;i++){
        const angle=i/24*Math.PI*2,guess=center.clone().add(new T.Vector3(Math.cos(angle)*radius,0,Math.sin(angle)*radius));
        const floor=f.raycast(new T.Ray(guess.clone().add(new T.Vector3(0,100,0)),new T.Vector3(0,-1,0)),0,280);if(!floor)continue;
        m.player.setPosition(floor.position.clone().add(new T.Vector3(0,3,0)));for(let j=0;j<10;j++)m.player.update(.02,{});m.camera.lookAt(center);
        m.debug.update(.001);const target=m.debug.target();
        if(kind==='power'?target?.kind==='power':target?.feature?.e.id===t.e.id)return {ok:true,id:t.e.id,position:m.player.getFeetPosition().toArray()};
      }
      return {ok:false,error:'unreachable',kind,id:t.e.id,center:center.toArray(),target:m.debug.target()?.feature?.e.id};
    },use(kind,id=null,hold=0){
      const r=this.approach(kind,id);if(!r.ok)return r;
      dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'}));
      if(hold){for(let remaining=hold;remaining>0;remaining-=.05)m.debug.update(Math.min(.05,remaining));}
      dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF'}));m.debug.update(.001);
      return {...r,stage:f.quest.stage,hack:f.hack?.left};
    },blast(type,position){
      s.effects.death_machine=0;s.meleeLeft=0;s.drinking=null;s.pack=null;
      if(type==='grenade'){s.grenades=4;m.combat.grenade();}else{s.giveEquipment(type==='gersh'?'zombie_black_hole_bomb':'zombie_quantum_bomb');m.combat.throwEquipment();}
      const g=m.combat.grenades.at(-1);if(!g)return {ok:false,error:'no projectile'};
      g.mesh.position.fromArray(position);g.velocity.set(0,0,0);g.life=0;m.combat.update(.001,{moving:false,sprint:false});
      return {ok:!m.combat.grenades.includes(g),stage:f.quest.stage,plates:f.quest.plates};
    }};
  });
  await use('power');await stage('simon');await simon();await stage('security_start');
  await use('hacker',await page.evaluate(()=>moon.features.quest.hackerId));
  await use('struct_osc_button',null,5.1);await stage('security');
  const terminals=await page.evaluate(()=>moon.features.quest.securityTargets);
  for(const id of terminals)await use('struct_osc_st',id,5.1);await stage('buttons');
  const buttons=await page.evaluate(()=>{const result=[];for(const t of moon.features.all('struct_osc_button'))result.push(qa.use('struct_osc_button',t.id));return result;});
  check('All four laboratory buttons can be pressed in time',buttons.every(r=>r.ok),buttons);await stage('excavator');
  await page.evaluate(()=>{moon.features.quest.activateDigger('hangar');moon.features.quest.update(240);moon.features.syncBlockers();});
  check('Pi breach removes tunnel oxygen',await page.evaluate(()=>!moon.features.environment({zone:'cata_left_middle_zone',breathable:true}).breathable));
  await use('digger',1576,5.1);await stage('sphere');
  await page.evaluate(()=>{moon.state.equipSuit();moon.combat.session.hacker=false;});
  const stops=[];
  for(let limit=0;limit<45;limit++){
    const r=await page.evaluate(async()=>{
      const m=moon,c=m.combat,q=m.features.quest,T=qa.T;if(q.stage!=='sphere')return {done:true,stage:q.stage};
      const node=q.sphereNode,requirement=node.script_string??'',cause=requirement==='zap'?'wave':requirement.includes('MELEE')?'melee':requirement.includes('GRENADE')||requirement.includes('EXPLOSIVE')?'grenade':'bullet';
      const point=new T.Vector3(...q.spherePosition);let at=null;
      if(cause==='grenade')qa.blast('grenade',q.spherePosition);
      else{
        for(const radius of (cause==='melee'?[24,40,58,70]:[50,80,150,300,600,1000])){
          for(let i=0;i<32;i++){
            const angle=i/32*Math.PI*2,guess=point.clone().add(new T.Vector3(Math.cos(angle)*radius,0,Math.sin(angle)*radius));
            const floor=m.features.raycast(new T.Ray(guess.clone().add(new T.Vector3(0,80,0)),new T.Vector3(0,-1,0)),0,2000);if(!floor)continue;
            m.player.setPosition(floor.position.clone().add(new T.Vector3(0,3,0)));for(let j=0;j<8;j++)m.player.update(.02,{});m.camera.lookAt(point);
            const d=m.camera.position.distanceTo(point);if(cause==='melee'&&d>100)continue;
            const ray=new T.Ray(m.camera.position.clone(),point.clone().sub(m.camera.position).normalize()),wall=m.features.raycast(ray,1,d-18);
            if(!wall||wall.distance>=d-42){at=m.player.getFeetPosition().toArray();break;}
          }if(at)break;
        }
        if(!at)return {ok:false,error:'no firing position',node:node.id,requirement,position:point.toArray()};
        c.session.giveWeapon(cause==='wave'?'microwavegun_zm':'galil_zm');await c.equip();for(let j=0;j<100;j++)c.view.update(.05);c.session.fireLeft=c.session.meleeLeft=0;
        if(cause==='melee'){c.melee();for(let j=0;j<40;j++)c.update(.05,{moving:false,sprint:false});}
        else c.shot();
      }
      if(!q.sphereMoving)return {ok:false,error:'sphere rejected combat event',node:node.id,requirement,at};
      for(let n=0;n<3000&&q.sphereMoving;n++)q.update(.1);
      m.features.update(.001,false);
      return {ok:true,node:node.id,requirement,cause,at,next:q.sphereNode.id,stage:q.stage};
    });
    if(r.done)break;stops.push(r);check('Sphere stop '+r.node,r.ok,r);
  }
  await stage('tank');await souls();await use('sq_knife_switch');await stage('plates');
  check('Cryogenic Slumber Party grants Death Machine',await page.evaluate(()=>moon.combat.session.effects.death_machine>moon.combat.session.time));
  await page.screenshot({path:path.join(out,'mpd-open.png')});
  await page.evaluate(()=>{moon.debug.relocate('area51');moon.combat.enemies.reset();moon.combat.enemies.spawnDelay=1e9;});
  await blast('grenade','sq_cassimir_plates');await blast('gersh','sq_cassimir_plates');
  await page.evaluate(()=>{moon.debug.relocate('receiving');moon.combat.enemies.reset();moon.combat.enemies.spawnDelay=1e9;moon.combat.enemies.nextAstroRound=Infinity;});
  await blast('qed','sq_ctvg_tp2');await stage('wire');
  await use('sq_wire_pos',await page.evaluate(()=>moon.features.quest.wireId));await use('sq_charge_terminal');await stage('charge');
  await use('sq_charge_terminal',null,60.1);await stage('tanks');await souls(true);await use('sq_pyramid_console');await stage('final_simon');
  check('Soul exchange awards eight permanent perks',await page.evaluate(()=>moon.combat.session.permanentPerks&&moon.combat.session.perks.size===8));
  await simon();await stage('final_qed');await blast('qed','sq_pyramid_console');await stage('final_gersh');await blast('gersh','be2_pos');await stage('launch');
  await page.evaluate(()=>{moon.debug.relocate('receiving');moon.player.setPosition(new qa.T.Vector3(40,940,-616));moon.camera.lookAt(moon.camera.position.clone().add(new qa.T.Vector3(12500,22500,-18500)));moon.features.quest.update(14.2);moon.features.update(.001,false);moon.presentation.update(.001,{lunar:true,breathable:false});});
  await page.screenshot({path:path.join(out,'earth-impact.png')});
  await page.evaluate(()=>{moon.features.quest.update(4);moon.features.update(.001,false);moon.presentation.update(.001,{lunar:true,breathable:false});});await stage('complete');
  await page.keyboard.press('Tab');await page.screenshot({path:path.join(out,'big-bang-theory.png')});
  check('Earth texture changes and survival remains active',await page.evaluate(()=>moon.features.quest.completed&&moon.presentation.earth.material.map===moon.presentation.destroyedTexture&&moon.combat.session.phase!=='gameover'));
  const retained=await page.evaluate(()=>{const s=moon.combat.session;s.effects.invulnerable=0;s.damage(10000);s.update(4.1);return {perks:s.perks.size,health:s.health,maxHealth:s.maxHealth,phase:s.phase};});
  check('Quest perks survive Quick Revive',retained.perks===8&&retained.health===retained.maxHealth&&retained.phase==='fighting',retained);
  check('No runtime errors or missing resources',errors.length===0,errors);
  fs.writeFileSync(path.join(out,'sphere-stops.json'),JSON.stringify(stops,null,2));
}catch(e){errors.push(String(e));console.error(e);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({method:'Controlled placement, inventory and time; production input/combat handlers; no direct stage assignments',checks,errors},null,2));await browser.close();}
