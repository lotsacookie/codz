import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Vector3} from 'three';
import {MoonEnemies} from '../export/web/assets/js/moon-enemies.js';
import {MoonSession} from '../export/web/assets/js/moon-session.js';
const data=JSON.parse(fs.readFileSync(new URL('../export/web/assets/moon/combat-data.json',import.meta.url)));
const actor=kind=>({kind,health:150,state:'chase',root:{position:new Vector3()},rig:{play(){}}});
test('Moon Nuke preserves astronauts and gives no per-enemy score or hit credit',()=>{
  const s=new MoonSession(data),kills=[],e=new MoonEnemies(null,{},data,s,{kill:z=>kills.push(z.kind)});
  e.list=[actor('astronaut'),actor('zombie'),actor('dog')];s.total=s.spawned=2;s.powerup('nuke');e.nuke(()=>{});
  assert.deepEqual(e.list.map(z=>z.kind),['astronaut']);assert.equal(s.points,900);assert.equal(s.totalScore,900);assert.equal(s.hits,0);assert.equal(s.killed,2);assert.deepEqual(kills,['zombie','dog']);
});
test('Astronaut explosion keeps nearby regular deaths in the lunar wave count',()=>{
  const s=new MoonSession(data),astronaut=actor('astronaut'),zombie=actor('zombie');
  const e=new MoonEnemies(null,{},data,s,{kill:z=>{if(z.kind==='astronaut')e.hurt(zombie,zombie.health,false,false,'explosion');}});
  e.list=[astronaut,zombie];s.spawned=s.total=1;e.hurt(astronaut,1000);
  assert.equal(e.list.length,0);assert.equal(s.killed,1);assert.equal(s.kills,2);
});
