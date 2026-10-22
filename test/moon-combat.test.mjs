import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MoonSession } from '../export/web/assets/js/moon-session.js';
import { MoonNavigation } from '../export/web/assets/js/moon-navigation.js';

const data=JSON.parse(fs.readFileSync(new URL('../export/web/assets/moon/combat-data.json',import.meta.url)));
const map=JSON.parse(fs.readFileSync(new URL('../export/web/assets/moon/map-data.json',import.meta.url)));
const session=()=>new MoonSession(data,()=>.5);

test('Moon starts in endless Area 51, with source starting points and ammunition',()=>{
  const s=session();assert.equal(s.area,'earth');assert.equal(s.phase,'fighting');assert.equal(s.points,500);
  assert.equal(s.weapon.id,'m1911_zm');assert.equal(s.weapon.mag,8);assert.equal(s.weapon.reserve,32);
  s.update(30);assert.equal(s.round,1);assert.equal(s.earthTime,30);
});
test('First lunar arrival starts six zombies; lunar waves do not schedule Kino dog rounds',()=>{
  const s=session();s.enterArea(true);assert.equal(s.phase,'preparing');assert.equal(s.total,6);
  s.update(6);assert.equal(s.phase,'fighting');
  for(let i=0;i<12;i++){s.nextRound();assert.equal(s.dogRound,false);assert.ok(s.total>0);}
});
test('Area 51 travel preserves the lunar wave without awarding removed-enemy kills',()=>{
  const s=session();s.enterArea(true);s.update(6);s.spawned=5;s.scoreHit(true,true);s.health=55;
  const points=s.points,kills=s.kills;s.enterArea(false);
  s.scoreHit(true,false);const earthPoints=s.points;s.enterArea(true);
  assert.equal(s.total,6);assert.equal(s.killed,1);assert.equal(s.spawned,1);assert.equal(s.round,1);
  assert.equal(s.health,55);assert.equal(s.points,earthPoints);assert.ok(s.points>points);assert.equal(s.kills,kills+1);
});
test('Door economy cannot overdraft or charge twice; its source flag unlocks adjacent zones',()=>{
  const s=session(),door=map.doors.find(d=>d.flag==='receiving_exit'),nav=new MoonNavigation(map);
  s.enterArea(true);assert.equal(s.buyDoor(door),false);assert.equal(s.points,500);
  assert.equal(nav.activeZones(s).has('water_zone'),false);
  s.addPoints(500);assert.equal(s.buyDoor(door),true);assert.equal(s.points,250);
  assert.equal(s.buyDoor(door),false);assert.equal(s.points,250);
  assert.equal(nav.activeZones(s).has('water_zone'),true);assert.equal(nav.activeZones(s).has('cata_left_start_zone'),false);
});
test('Wall buy and ammo refill preserve inventory and do not refill a loaded magazine for free',()=>{
  const s=session(),def=data.weapons.m14_zm;s.points=5000;
  assert.equal(s.buyWeapon(def.id),true);assert.equal(s.points,5000-def.price);assert.equal(s.inventory.length,2);
  s.weapon.mag=1;s.weapon.reserve=0;const before=s.points;
  assert.equal(s.buyWeapon(def.id),true);assert.equal(s.weapon.mag,1);assert.equal(s.weapon.reserve,def.maxAmmo);
  assert.equal(s.points,before-(def.ammoPrice??Math.ceil(def.price/2)));
  const full=s.points;assert.equal(s.buyWeapon(def.id),false);assert.equal(s.points,full);
});
test('Lethal damage stops purchases, firing and survival time; retry clears progression',()=>{
  const s=session();s.points=5000;s.enterArea(true);s.buyDoor(map.doors[0]);s.damage(1000);
  const t=s.time;s.update(10);assert.equal(s.time,t);assert.equal(s.fire(),false);
  assert.equal(s.buyWeapon('m14_zm'),false);assert.equal(s.buyDoor(map.doors[1]),false);
  s.reset();assert.equal(s.area,'earth');assert.equal(s.health,100);assert.equal(s.points,500);assert.equal(s.openDoors.size,0);assert.equal(s.moonStarted,false);
});
test('Every Moon combat model and animation URL resolves locally',()=>{
  const definitions=[...Object.values(data.weapons),...Object.values(data.equipment),...Object.values(data.perkDrinks)];
  const urls=[...Object.values(data.actors.models),...Object.values(data.animations),...Object.values(data.props),...definitions.flatMap(d=>[d.model,d.worldModel,...Object.values(d.animations),...Object.values(d.upgrade?.animations??{})]).filter(Boolean)];
  for(const id of ['m1911_zm','microwavegun_zm','microwavegundw_zm','minigun_zm'])assert.ok(data.weapons[id],id);
  for(const url of urls)assert.ok(fs.existsSync(new URL('../export/web/assets/'+url,import.meta.url)),url);
  for(const name of data.actors.technicians)assert.match(name,/c_zom_moon_tech/);
  assert.match(data.actors.military,/militarypolice/);
});
