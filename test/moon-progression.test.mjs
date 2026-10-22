import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MoonSession, MOON_PERKS } from '../export/web/assets/js/moon-session.js';
import { MoonProgression } from '../export/web/assets/js/moon-progression.js';
const data=JSON.parse(fs.readFileSync(new URL('../export/web/assets/moon/combat-data.json',import.meta.url)));
const map=JSON.parse(fs.readFileSync(new URL('../export/web/assets/moon/map-data.json',import.meta.url)));
const setup=()=>{const s=new MoonSession(data,()=>.37);return {s,q:new MoonProgression(map,s)};};
const simon=q=>{let safety=1000;while(['simon','final_simon'].includes(q.stage)&&safety--){q.update(Math.max(0,q.sequenceShowUntil-q.elapsed)+.01);for(const color of q.sequence.slice(0,q.sequenceLength))q.pressSimon(color);}assert.ok(safety>0);};

test('Moon perk purchases require power, respect four slots, and charge once',()=>{
  const {s}=setup();s.enterArea(true);s.points=50000;
  assert.equal(s.buyPerk('specialty_armorvest'),false);s.power=true;
  for(const id of Object.keys(MOON_PERKS).slice(0,4)){const before=s.points;assert.equal(s.buyPerk(id),true);assert.equal(s.buyPerk(id),false);s.update(10);assert.equal(s.points,before-MOON_PERKS[id].price);}
  assert.equal(s.perks.size,4);assert.equal(s.maxHealth,250);assert.equal(s.buyPerk('specialty_flakjacket'),false);
});
test('Mule Kick grants a third slot and losing it removes only the third weapon',()=>{
  const {s}=setup();s.perks.add('specialty_additionalprimaryweapon');s.giveWeapon('galil_zm');s.giveWeapon('commando_zm');
  assert.equal(s.inventory.length,3);s.losePerk('specialty_additionalprimaryweapon');assert.deepEqual(s.inventory.map(w=>w.id),['m1911_zm','galil_zm']);assert.equal(s.slot,1);
});
test('Wave and Zap modes retain separate ammunition through switching and Max Ammo',()=>{
  const {s}=setup();s.giveWeapon('microwavegun_zm');s.weapon.mag=1;s.weapon.reserve=4;
  assert.ok(s.toggleWave());assert.equal(s.def.id,'microwavegundw_zm');s.weapon.mag=3;s.weapon.reserve=9;
  assert.ok(s.toggleWave());assert.equal(s.weapon.mag,1);assert.equal(s.weapon.reserve,4);
  assert.ok(s.toggleWave());assert.equal(s.weapon.mag,3);assert.equal(s.weapon.reserve,9);s.powerup('full_ammo');assert.equal(s.weapon.reserve,s.def.maxAmmo);
  s.toggleWave();assert.equal(s.weapon.reserve,s.def.maxAmmo);
});
test('Pack-a-Punch reserves a weapon, blocks combat, and has a retrieval window',()=>{
  const {s}=setup();s.points=5000;assert.ok(s.beginPack());assert.equal(s.points,0);assert.equal(s.fire(),false);assert.equal(s.takePack(),false);s.update(5);assert.ok(s.takePack());assert.equal(s.weapon.upgraded,true);assert.equal(s.weapon.mag,s.def.clipSize);assert.equal(s.beginPack(),false);
});
test('Equipment consumes its own inventory and Max Ammo restores it',()=>{
  const {s}=setup();assert.ok(s.giveEquipment('zombie_black_hole_bomb'));s.equipmentAmmo=0;s.powerup('full_ammo');assert.equal(s.equipmentAmmo,3);assert.equal(s.inventory.length,1);
});
test('Excavator breaches remain depressurized after hacking and can activate again',()=>{
  const {s,q}=setup();s.hacker=true;assert.ok(q.activateDigger('hangar'));q.update(239);assert.equal(q.diggers.hangar.phase,'warning');q.update(1);assert.equal(q.diggers.hangar.phase,'digging');assert.ok(q.breaches.has('cata_left_middle_zone'));assert.ok(q.hackDigger('hangar'));assert.equal(s.points,1500);assert.ok(q.breaches.has('cata_left_middle_zone'));assert.ok(q.activateDigger('hangar'));
});
test('Security timeout can be retried and wrong Simon input does not advance',()=>{
  const {s,q}=setup();s.power=true;s.hacker=true;s.points=5000;q.update(1);q.update(3);const length=q.sequenceLength;assert.equal(q.pressSimon((q.sequence[0]+1)%4),false);assert.equal(q.sequenceLength,length);simon(q);assert.equal(q.stage,'security_start');q.startSecurity();q.update(71);assert.equal(q.stage,'security_start');assert.ok(q.startSecurity());
});
test('Complete solo quest follows native sphere links, requires equipment, counts local souls, and rewards permanent perks',()=>{
  const {s,q}=setup();s.power=true;s.hacker=true;s.points=100000;q.update(1);simon(q);assert.ok(q.startSecurity());
  for(const id of q.securityTargets)assert.ok(q.hackSecurity(id));for(const e of q.all('struct_osc_button'))q.pressButton(e.id);assert.equal(q.stage,'excavator');
  q.activateDigger('hangar');q.update(240);q.hackDigger('hangar');assert.equal(q.stage,'sphere');
  let safety=10000;
  while(q.stage==='sphere'&&safety--){if(!q.sphereMoving){const r=q.sphereNode.script_string??'';q.motivateSphere(r==='zap'?'wave':r.includes('MELEE')?'melee':r.includes('EXPLOSIVE')||r.includes('GRENADE')?'grenade':'bullet');}q.update(.25);}
  assert.ok(safety>0);assert.equal(q.stage,'tank');q.kill([0,0,0],'zombie','bullet');assert.equal(q.tanks[0],0);
  for(let i=0;i<25;i++)q.kill(q.one('sq_first_tank').position,'zombie','bullet');assert.equal(q.stage,'switch');q.useSwitch();assert.equal(q.stage,'plates');
  assert.equal(q.blast(q.one('sq_cassimir_plates').position,'qed'),false);
  q.blast(q.one('sq_cassimir_plates').position,'grenade');q.blast(q.one('sq_cassimir_plates').position,'gersh');q.blast(q.one('sq_ctvg_tp2').position,'qed');assert.equal(q.stage,'wire');
  q.takeWire(q.wireId);q.chargeDevice(0);q.chargeDevice(59);assert.equal(q.stage,'charge');q.chargeDevice(1);assert.equal(q.stage,'tanks');
  for(const tank of [q.one('sq_first_tank'),...q.all('sq_second_tank')])for(let i=0;i<25;i++)q.kill(tank.position,'zombie','bullet');
  assert.equal(q.stage,'swap');q.swap();assert.equal(s.perks.size,8);assert.ok(s.permanentPerks);s.losePerk('specialty_armorvest');assert.ok(s.perks.has('specialty_armorvest'));
  simon(q);assert.equal(q.stage,'final_qed');q.blast(q.one('sq_pyramid_console').position,'qed');q.blast(q.one('be2_pos').position,'gersh');q.update(18);assert.ok(q.completed);assert.equal(q.stage,'complete');
  q.reset();assert.equal(q.stage,'power');assert.equal(q.breaches.size,0);assert.equal(q.completed,false);
});
