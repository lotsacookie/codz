import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Session,powerupVisible,POWERUP_LIFETIME} from '../export/web/assets/js/rules.js';
const data=JSON.parse(fs.readFileSync(new URL('../export/web/assets/game-data.json',import.meta.url)));
test('Max Ammo replenishes both reserves and grenades without loading magazines',()=>{
 const s=new Session(data);s.giveWeapon('ray_gun_zm');s.weapon.upgraded=true;for(const w of s.inventory){w.mag=1;w.reserve=0;}s.grenades=0;s.powerup('full_ammo');
 assert.deepEqual(s.inventory.map(w=>w.mag),[1,1]);assert.equal(s.inventory[0].reserve,80);assert.equal(s.inventory[1].reserve,200);assert.equal(s.grenades,4);
});
test('timed pickups refresh to thirty seconds and point bonuses respect Double Points',()=>{
 const s=new Session(data);s.powerup('double_points');s.update(20);s.powerup('double_points');assert.equal(s.effects.double_points-s.time,30);
 const before=s.points;s.powerup('carpenter');s.powerup('nuke');assert.equal(s.points-before,1200);s.update(30);s.addPoints(10);assert.equal(s.points-before,1210);
});
test('earned score schedules drops even after purchases and increases threshold by 14%',()=>{
 const s=new Session(data,()=>.5);s.addPoints(2000);assert.equal(s.drops.tryDrop(s),null);s.addPoints(10);s.spend(2400);
 assert(s.drops.tryDrop(s));assert.equal(s.drops.increment,2280);assert.equal(s.drops.nextScore,4790);assert.equal(s.drops.pending,false);
});
test('round one filters Nuke/Fire Sale and unbroken windows filter Carpenter',()=>{
 const s=new Session(data,()=>0),types=[];for(let i=0;i<4;i++)types.push(s.drops.tryDrop(s));
 assert(types.every(t=>['full_ammo','double_points','insta_kill'].includes(t)));assert.equal(s.drops.tryDrop(s),null);
 s.nextRound();assert(s.drops.tryDrop(s));assert.equal(s.drops.count,1);
});
test('shuffled eligible deck covers all six, with Carpenter and Fire Sale gating',()=>{
 const s=new Session(data,()=>0);s.nextRound();s.drops.count=0;const types=[];
 for(let i=0;i<6;i++){s.drops.count=0;types.push(s.drops.tryDrop(s,{destroyedWindows:5,boxMoves:1}));}
 assert.equal(new Set(types).size,6);s.drops.count=0;s.drops.deck=['fire_sale','carpenter','full_ammo'];s.powerup('fire_sale');assert.equal(s.drops.tryDrop(s,{destroyedWindows:4,boxMoves:1}),'full_ammo');
});
test('outside kills and dogs do not consume a pending regular drop',()=>{
 const s=new Session(data,()=>0);s.addPoints(3000);assert.equal(s.drops.tryDrop(s,{playable:false}),null);assert.equal(s.drops.tryDrop(s,{kind:'dog'}),null);assert(s.drops.pending);assert.equal(s.drops.count,0);assert(s.drops.tryDrop(s));
});
test('pickups flash after fifteen seconds and expire at the original 26.5 seconds',()=>{
 assert(powerupVisible(14.99));assert(powerupVisible(15));assert(!powerupVisible(15.51));assert(!powerupVisible(22.51));assert(powerupVisible(22.76));assert(!powerupVisible(25.01));assert(powerupVisible(25.11));assert.equal(POWERUP_LIFETIME,26.5);assert(!powerupVisible(26.5));
});
test('perk is awarded after drinking; combat, duplicate drinks and switching are blocked',()=>{
 const s=new Session(data);s.giveWeapon('mp40_zm');s.weapon.mag=10;s.reload();const slot=s.slot;
 assert(s.drink('specialty_armorvest'));assert.equal(s.reloadLeft,0);assert(!s.fire());assert(!s.reload());assert(!s.drink('specialty_rof'));s.switchWeapon(0);assert.equal(s.slot,slot);
 s.update(2);assert(!s.perks.has('specialty_armorvest'));s.update(1.8);assert(s.perks.has('specialty_armorvest'));assert.equal(s.health,250);assert.equal(s.drinking,null);assert(s.fire());
});
test('downing during drinking cancels the pending perk and reset clears drop state',()=>{
 const s=new Session(data);s.drink('specialty_quickrevive');s.damage(100);s.update(5);assert(!s.perks.has('specialty_quickrevive'));assert.equal(s.drinking,null);s.reset();assert.equal(s.drops.count,0);assert.equal(s.totalScore,500);
});
