import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KinoSession } from '../export/web/assets/js/kino-session.js';
import { KinoEvents } from '../export/web/assets/js/kino-events.js';
const data=JSON.parse(fs.readFileSync('export/web/assets/game-data.json'));
const fresh=()=>new KinoSession(data,()=>.5);

test('All 32 Kino weapons, upgrades, attachments and equipment have local models and clips',()=>{
  assert.equal(Object.keys(data.weapons).length,32);assert.equal(data.boxPool.length,23);
  for(const d of [...Object.values(data.weapons),...Object.values(data.equipment)]){
    for(const def of [d,d.upgrade,d.upgrade?.attachment].filter(Boolean)){
      assert(def.model&&def.worldModel,def.id);
      for(const url of [def.model,def.worldModel,def.leftModel,def.projectileModel,...Object.values(def.animations),...Object.values(def.leftAnimations??{})].filter(Boolean))assert(fs.existsSync('export/web/assets/'+url),url);
    }
  }
  for(const id of data.boxPool)assert(data.weapons[id]||data.equipment[id],id);
  assert(!data.boxPool.includes('mp40_zm'));assert(!data.boxPool.includes('m1911_zm'));
});
test('Pack-a-Punch charges once, reserves only its weapon, and returns the native dual upgrade',()=>{
  const s=fresh();s.points=5000;assert(!s.beginPack());s.power=true;assert(s.beginPack());assert.equal(s.points,0);assert(!s.beginPack());assert(!s.fire());assert(!s.reload());assert(!s.takePack());assert(!s.giveWeapon('mp40_zm'));
  s.update(4.36);assert(s.takePack());assert.equal(s.def.name,'Mustang & Sally');assert.equal(s.weapon.mag,12);assert(s.def.leftModel);assert(s.def.projectileSpeed>0);assert(!s.beginPack());
});
test('A missed Pack-a-Punch offer loses its weapon without trapping the inventory',()=>{
  const s=fresh();s.power=true;s.points=10000;s.beginPack();s.update(20);assert(s.weapon.lost);assert(!s.fire());assert(!s.reload());assert(s.giveWeapon('mp40_zm'));assert(!s.weapon.lost);assert.equal(s.weapon.id,'mp40_zm');
  s.giveWeapon('m1911_zm');s.beginPack();s.switchWeapon(0);s.update(1);assert(s.fire());s.update(5);assert(s.takePack());assert.equal(s.weapon.id,'m1911_zm');
});
test('Claymores and monkeys use separate inventories and replenish correctly',()=>{
  const s=fresh();assert(!s.buyClaymores());s.points=1000;assert(s.buyClaymores());assert(!s.buyClaymores());assert.equal(s.points,0);assert(s.useEquipment('claymores'));assert(!s.useEquipment('claymores'));s.update(1);assert(s.useEquipment('claymores'));s.update(1);assert(!s.useEquipment('claymores'));s.nextRound();assert.equal(s.claymores,2);
  s.giveMonkeys();assert(s.useEquipment('monkeys'));s.update(1);s.powerup('full_ammo');assert.equal(s.monkeys,3);assert.equal(s.claymores,2);s.reset();assert(!s.monkeysOwned&&!s.claymoresOwned);assert.equal(s.monkeys+s.claymores,0);
});
test('Downing cancels reload and blocks equipment and inventory mutations',()=>{
  const s=fresh();s.giveMonkeys();s.weapon.mag=0;s.reload();s.damage(100);assert.equal(s.reloadLeft,0);assert(!s.fire());assert(!s.reload());assert(!s.giveWeapon('mp40_zm'));assert(!s.useEquipment('monkeys'));assert(!s.switchWeapon(1));
});
test('Underbarrel ammo stays separate across fire, Max Ammo, switching and reload',()=>{
  const s=fresh();s.giveWeapon('m16_zm');s.weapon.upgraded=true;s.weapon.mag=20;s.weapon.reserve=50;assert(s.toggleAttachment());s.update(1);assert(s.fire());const mag=s.weapon.mag;s.powerup('full_ammo');assert.equal(s.weapon.mag,mag);assert.equal(s.weapon.reserve,s.def.maxAmmo);assert(s.toggleAttachment());assert.equal(s.weapon.mag,20);assert.equal(s.weapon.reserve,data.weapons.m16_zm.upgrade.maxAmmo);s.toggleAttachment();assert.equal(s.weapon.mag,mag);s.switchWeapon(0);assert(!s.attachmentMode);s.switchWeapon(1);assert.equal(s.weapon.mag,20);
});
test('Three reels occupy distinct rooms and require collection before projection',()=>{
  const e=new KinoEvents(data,()=>.5);assert.equal(e.reels.length,3);assert.equal(new Set(e.reels.map(r=>r.entity.targetname)).size,3);assert(!e.install());
  for(const reel of e.reels){assert(e.take(reel.entity.id));assert(!e.take(reel.entity.id));assert(e.install());assert(!e.install());}
  assert.equal(e.installed.size,3);assert(e.reels.every(r=>r.collected));e.reset();assert.equal(e.installed.size,0);assert(e.reels.every(r=>!r.collected));assert(e.chooseRoom().targetname.startsWith('ee_teleport_player'));
});
