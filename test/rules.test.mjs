import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Session,zombieHealth,roundPopulation} from '../export/web/assets/js/rules.js';
const data=JSON.parse(fs.readFileSync(new URL('../export/web/assets/game-data.json',import.meta.url)));
test('weapon reserve extraction respects absolute versus clip-relative counts',()=>{
 assert.equal(data.weapons.m1911_zm.startAmmo,32);assert.equal(data.weapons.mp40_zm.maxAmmo,192);
 assert.equal(data.weapons.ray_gun_zm.maxAmmo,160);assert.equal(data.weapons.ray_gun_zm.upgrade.maxAmmo,200);
 assert.equal(data.weapons.thundergun_zm.maxAmmo,12);assert.equal(data.weapons.thundergun_zm.upgrade.maxAmmo,24);
 assert(data.weapons.m1911_zm.hideTags.includes('tag_suppressor'));
});
test('T5 health changes to multiplication at round 10, with truncation each round',()=>{
 assert.equal(zombieHealth(1),150);assert.equal(zombieHealth(9),950);assert.equal(zombieHealth(10),1045);assert.equal(zombieHealth(11),1149);
});
test('solo round population uses GSC early-round modifiers',()=>{
 assert.deepEqual([1,2,3,4,5,6,10].map(r=>roundPopulation(r)),[6,8,13,18,24,27,33]);
});
test('weapon cadence, reload transfer, and inventory switching preserve ammunition',()=>{
 const s=new Session(data,()=>0);assert.equal(s.points,500);assert.equal(s.weapon.mag,8);assert.equal(s.weapon.reserve,32);
 assert(s.fire());assert(!s.fire());s.update(.2);assert(s.fire());assert(s.reload());assert(!s.fire());s.update(2);
 assert.equal(s.weapon.mag,8);assert.equal(s.weapon.reserve,30);s.giveWeapon('mp40_zm');assert.equal(s.inventory.length,2);s.switchWeapon(0);assert.equal(s.weapon.reserve,30);
});
test('purchases cannot overdraft and damage cannot revive a dead session',()=>{
 const s=new Session(data);assert(!s.spend(750));assert.equal(s.points,500);assert(s.spend(500));assert.equal(s.points,0);
 s.damage(50);assert.equal(s.health,50);s.update(2);assert.equal(s.health,50);s.damage(50);assert.equal(s.phase,'gameover');s.update(20);assert.equal(s.health,0);
});
test('Quick Revive consumes perks and returns player with temporary protection',()=>{
 const s=new Session(data);s.perks.add('specialty_quickrevive');s.damage(100);assert.equal(s.phase,'reviving');assert.equal(s.perks.size,0);s.update(4.1);assert.equal(s.phase,'fighting');assert.equal(s.health,100);assert(!s.damage(100));
});
test('headshots, knife kills, and timed Double Points award distinct scores',()=>{
 const s=new Session(data);s.scoreHit(false);assert.equal(s.points,510);s.scoreHit(true,true);assert.equal(s.points,610);s.powerup('double_points');s.scoreHit(true,false,true);assert.equal(s.points,870);s.update(31);s.scoreHit(false);assert.equal(s.points,880);
});
test('dog rounds use original population and produce later scheduled rounds',()=>{
 const s=new Session(data,()=>0);while(s.round<5)s.nextRound();assert(s.dogRound);assert.equal(s.total,6);assert.equal(s.nextDogRound,9);
 while(s.round<13)s.nextRound();assert(s.dogRound);assert.equal(s.dogRounds,3);assert.equal(s.total,8);
});

test('a knife swing blocks firing, reload, and switching until recovery',()=>{
 const s=new Session(data);s.giveWeapon('mp40_zm');s.weapon.mag--;const slot=s.slot,mag=s.weapon.mag;
 s.meleeLeft=.7;assert(!s.fire());assert(!s.reload());s.switchWeapon(0);assert.equal(s.slot,slot);assert.equal(s.weapon.mag,mag);
 s.update(.71);assert(s.fire());
});

test('shotguns load individual shells and preserve loaded ammo when interrupted',()=>{
 const s=new Session(data);s.giveWeapon('ithaca_zm');s.weapon.mag=0;const total=s.weapon.reserve;
 assert(s.reload());assert.equal(s.reloadStage,'start');s.update(s.reloadDuration+.001);
 assert.equal(s.weapon.mag,data.weapons.ithaca_zm.reloadStartAdd);assert.equal(s.reloadStage,'shell');
 s.update(s.reloadLeft+.001);assert.equal(s.weapon.mag,2);s.interruptReload();s.update(s.reloadLeft+.001);
 assert.equal(s.reloadStage,'end');assert.equal(s.weapon.mag,3);s.update(s.reloadLeft+.001);
 assert.equal(s.reloadLeft,0);assert.equal(s.weapon.mag+s.weapon.reserve,total);
 assert(s.reload());s.update(10);assert.equal(s.weapon.mag,s.def.clipSize);assert.equal(s.reloadLeft,0);
});

test('Speed Cola speeds each shotgun reload stage; switching cancels its transfer',()=>{
 const s=new Session(data);s.giveWeapon('spas_zm');s.weapon.mag=0;s.perks.add('specialty_fastreload');s.reload();
 assert.equal(s.reloadDuration,s.def.reloadStartTime/2);s.update(s.reloadDuration+.001);
 assert.equal(s.reloadDuration,s.def.reloadTime/2);const loaded=s.weapon.mag;s.switchWeapon(0);s.update(10);
 assert.equal(s.inventory[1].mag,loaded);assert.equal(s.reloadStage,null);assert.equal(s.weapon.mag,8);
});

test('ADS hits that do not kill award 15 points like zombie_damage_ads', () => {
  const s = new Session(data);
  s.scoreHit(false);
  assert.equal(s.points, 510);
  s.adsShot = true;
  s.scoreHit(false);
  assert.equal(s.points, 525);
  s.scoreHit(true, false);
  assert.equal(s.points, 585);
});

test('co-op death spectates until the next round while the round machine keeps running underneath',()=>{
 const s=new Session(data,()=>0);s.coopAlive=()=>true;
 s.phase='fighting';s.total=6;s.spawned=0;s.damage(150);
 assert.equal(s.spectating,true);assert.equal(s.phase,'reviving','player-facing code treats a spectator as out of action');
 assert.equal(s.corePhase,'fighting','the host sim still sees the real round state');
 assert(!s.damage(50),'a spectator cannot be hurt again');
 s.nextRound();assert.equal(s.round,2);assert.equal(s.corePhase,'preparing');assert.equal(s.phase,'reviving');
 s.update(.1);assert.equal(s.spectating,false,'back in as the next round starts');assert.equal(s.health,100);assert.equal(s.phase,'preparing');
 assert(s.effects.invulnerable>s.time,'a short grace period after returning');
});
test('spectators keep the round countdown going so the host can carry on without them',()=>{
 const s=new Session(data,()=>0);s.coopAlive=()=>true;s.phase='fighting';s.damage(150);
 s.nextRound();s.deathRound=99;s.countdown=1;s.update(1.5);
 assert.equal(s.corePhase,'fighting');assert.equal(s.phase,'reviving');
});
test('the last player standing still gets a real game over, and dying loses perks',()=>{
 const s=new Session(data,()=>0);s.coopAlive=()=>false;s.damage(150);assert.equal(s.phase,'gameover');assert.equal(s.spectating,false);
 const t=new Session(data,()=>0);t.coopAlive=()=>true;t.perks.add('specialty_armorvest');t.damage(500);assert.equal(t.perks.size,0);
});
