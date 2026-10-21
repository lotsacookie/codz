import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PlayerVox, voiceLines, weaponCategory, CATEGORIES } from '../export/web/player-vox.js';

const manifest = JSON.parse(readFileSync(new URL('../export/web/audio/manifest.json', import.meta.url), 'utf8'));
const keys = Object.keys(manifest);

function setup(character = 0, roll = 0) {
  const played = [];
  const audio = { enabled: true, ctx: { currentTime: 100 }, manifest, play: (key, volume, at) => played.push({ key, at }), later: (ms, fn) => fn() };
  const vox = new PlayerVox(audio, { character, random: () => roll });
  return { audio, vox, played };
}

test('every voice category has lines for the characters the reference ships', () => {
  for (const category of Object.keys(CATEGORIES)) {
    const present = [0, 1, 2, 3].filter(plr => voiceLines(keys, plr, category).length);
    assert.ok(present.length >= 1, `${category} has no reference lines`);
  }
});

test('voiceLines matches whole numbered categories only', () => {
  const lines = voiceLines(keys, 1, 'wpck_favorite');
  assert.ok(lines.length && lines.every(key => /plr1\/vox_plr_1_wpck_favorite_\d+$/.test(key)));
  assert.ok(!lines.some(key => key.includes('upgrade')));
});

test('weapons map to their pickup category', () => {
  assert.equal(weaponCategory({ id: 'ray_gun_zm' }), 'wpck_raygun');
  assert.equal(weaponCategory({ id: 'rottweil72_zm' }), 'wpck_shotgun');
  assert.equal(weaponCategory({ id: 'm1911_zm' }), 'wpck_crappy');
  assert.equal(weaponCategory({ id: 'ak47_zm', upgraded: true }), 'wpck_upgrade');
  assert.equal(weaponCategory({ id: 'unknown_zm' }), null);
});

test('say speaks a lined category, then respects the speaker and the cooldown', () => {
  const { vox, audio, played } = setup(2);
  const key = vox.say('kill_hellhound');
  assert.match(key, /plr2\/vox_plr_2_kill_hellhound_\d+$/);
  assert.equal(played.length, 1);
  assert.equal(vox.say('kill_explo'), null, 'still talking');
  audio.ctx.currentTime += 60;
  assert.ok(vox.say('kill_hellhound'));
  assert.equal(vox.say('not_a_category'), null);
});

test('say stays quiet when the odds roll high or audio is off', () => {
  const { vox, audio } = setup(0, .99);
  assert.equal(vox.say('kill_explo'), null);
  assert.ok(vox.say('kill_explo', { force: true }));
  audio.enabled = false; audio.ctx.currentTime += 99;
  assert.equal(vox.say('kill_explo', { force: true }), null);
});

test('enemy events trigger the matching kill and spawn lines', () => {
  const { vox } = setup();
  const session = { round: 5, time: 10, effects: {} };
  vox.enemyEvent('spawn', { kind: 'dog' }, undefined, session);
  vox.enemyEvent('spawn', { kind: 'dog' }, undefined, session);
  assert.deepEqual(vox.spoken, ['spawn_dog']);
  vox.audio.ctx.currentTime += 30;
  vox.enemyEvent('death', { kind: 'dog' }, 'bullet', session);
  vox.audio.ctx.currentTime += 30;
  vox.enemyEvent('death', { kind: 'zombie' }, 'grenade', session);
  vox.audio.ctx.currentTime += 30;
  vox.enemyEvent('death', { kind: 'zombie', killedByHead: true }, 'bullet', session);
  assert.deepEqual(vox.spoken, ['spawn_dog', 'kill_hellhound', 'kill_explo', 'kill_headshot']);
});

test('power-ups and perks speak after the announcer', () => {
  const { vox } = setup();
  vox.powerup('nuke');
  vox.audio.ctx.currentTime += 10;
  vox.perk('specialty_armorvest');
  vox.powerup('not_a_powerup');
  assert.deepEqual(vox.spoken, ['powerup_nuke', 'perk_jugga']);
});

test('update reacts to new weapons, empty guns, danger, downs and the first round', () => {
  const { vox, audio } = setup();
  const data = { weapons: { m1911_zm: { id: 'm1911_zm' }, ray_gun_zm: { id: 'ray_gun_zm' } } };
  const session = { data, inventory: [{ id: 'm1911_zm', mag: 8, reserve: 24 }], get weapon() { return this.inventory[0]; }, def: { clipSize: 8, maxAmmo: 80 }, health: 100, maxHealth: 100, phase: 'preparing', round: 1, kills: 0, time: 1 };
  const step = () => { audio.ctx.currentTime += 60; vox.update(session); };
  step();
  assert.deepEqual(vox.spoken, []);
  session.inventory.push({ id: 'ray_gun_zm', mag: 20, reserve: 160 });
  step();
  session.phase = 'fighting'; step();
  session.inventory[0].mag = 0; session.inventory[0].reserve = 0; step();
  session.health = 20; step();
  session.phase = 'reviving'; step();
  session.phase = 'fighting'; session.health = 100; step();
  assert.deepEqual(vox.spoken, ['wpck_raygun', 'level_start', 'ammo_out', 'ohshit', 'revive_down', 'revive_up']);
});

test('five kills in ten seconds is a streak', () => {
  const { vox, audio } = setup();
  const session = { data: { weapons: {} }, inventory: [{ id: 'm1911_zm', mag: 8, reserve: 80 }], get weapon() { return this.inventory[0]; }, def: { clipSize: 8, maxAmmo: 80 }, health: 100, maxHealth: 100, phase: 'fighting', round: 2, kills: 0, time: 5 };
  vox.state.round = 2; vox.update(session);
  audio.ctx.currentTime += 60; session.kills = 5; session.time = 8; vox.update(session);
  assert.deepEqual(vox.spoken, ['kill_streak']);
});
