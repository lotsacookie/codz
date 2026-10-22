import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameAudio } from '../export/web/assets/js/audio.js';
import { weaponFolder, cueRole, weaponProfile, foleyKey, blastCues, hasScope, usesPapShot } from '../export/web/assets/js/weapon-sfx.js';

const manifest = JSON.parse(readFileSync(new URL('../export/web/assets/audio/manifest.json', import.meta.url), 'utf8'));
const keys = Object.keys(manifest).filter(key => /^(resident|ref)\/wpn\//.test(key));
const data = JSON.parse(readFileSync(new URL('../export/web/assets/game-data.json', import.meta.url), 'utf8'));

test('cueRole sorts weapon cues into layers', () => {
  assert.equal(cueRole('plr/shot/shot_00'), 'shot');
  assert.equal(cueRole('lfe/lfe_00'), 'lfe');
  assert.equal(cueRole('plr/lfe/lfe_00'), 'lfe');
  assert.equal(cueRole('plr/ringoff/ringoff_f'), 'ring');
  assert.equal(cueRole('npc/dist/dist_00'), 'dist');
  assert.equal(cueRole('npc/dry_fire_00'), 'npcDry');
  assert.equal(cueRole('npc/act/act_00'), 'npcDry');
  assert.equal(cueRole('plr/act/act_00'), 'dry');
  assert.equal(cueRole('reload/fly_m16_mag_in'), 'foley');
  assert.equal(cueRole('plr/shot/silenced/silenced_00'), 'silenced');
});

test('every playable weapon resolves a folder and at least one shot cue', () => {
  for (const def of Object.values(data.weapons)) {
    const profile = weaponProfile(def, keys);
    assert.ok(profile.folder, def.id + ' has no sound folder');
    const any = profile.shot.length + profile.npcShot.length + profile.dist.length;
    assert.ok(any > 0, def.id + ' has no shot cue');
  }
});

test('profiles pick up lfe, tail, shell and class dry-fire cues', () => {
  const m16 = weaponProfile({ id: 'm16_zm' }, keys);
  assert.ok(m16.shot.some(key => key.endsWith('/plr/shot/shot_00')));
  assert.ok(m16.ring.length > 0);
  assert.ok(m16.shell.length > 0);
  assert.ok(m16.classDry.length > 0 && m16.classDry.every(key => key.includes('/plr/')));
  const rpg = weaponProfile({ id: 'm72_law_zm' }, keys);
  assert.ok(rpg.shot.some(key => key.endsWith('wpn_rpg_shot_plr')));
});

test('foleyKey matches notetrack names inside the weapon folder', () => {
  const ray = weaponProfile({ id: 'ray_gun_zm' }, keys);
  assert.ok(foleyKey(ray, 'ray_reload_open').endsWith('wpn_ray_reload_open'));
  const m16 = weaponProfile({ id: 'm16_zm' }, keys);
  assert.ok(foleyKey(m16, 'fly_m16_mag_in').endsWith('fly_m16_mag_in'));
  assert.equal(foleyKey(m16, 'no_such_sound'), undefined);
});

test('explosion and scope helpers', () => {
  assert.ok(blastCues('rocket', Object.keys(manifest)).length >= 2);
  assert.ok(blastCues('grenade', Object.keys(manifest)).length >= 1);
  assert.equal(hasScope({ id: 'l96a1_zm' }), true);
  assert.equal(hasScope({ id: 'm16_zm' }), false);
  assert.equal(weaponFolder('ray_gun_zm'), 'energy/raygun');
});

function recorder() {
  const audio = new GameAudio();
  audio.manifest = manifest;
  audio.ctx = { currentTime: 0 };
  const played = [];
  audio.play = (kind, volume, position) => played.push({ kind, volume, position });
  audio.later = (ms, fn) => fn();
  return { audio, played };
}

test('a local shot layers the main cue with lfe, tail, shell and flux cues', () => {
  const { audio, played } = recorder();
  audio.weapon('shot', data.weapons.m16_zm);
  const kinds = played.map(p => p.kind);
  assert.ok(kinds[0].includes('/plr/shot/'), kinds[0]);
  assert.ok(kinds.length >= 3, kinds.join());
  assert.ok(kinds.some(kind => kind.includes('/shell/')));
});

test('an empty click uses the weapon or class dry-fire cue, not the synth', () => {
  const { audio, played } = recorder();
  audio.weapon('empty', data.weapons.m14_zm);
  assert.match(played[0].kind, /^(resident|ref)\/wpn\//);
});

test('other players use npc shots and add a distant layer when far', () => {
  const { audio, played } = recorder();
  audio.camera = { position: { x: 0, y: 0, z: 0 } };
  audio.weapon('shot', data.weapons.m16_zm, [3000, 0, 0]);
  assert.ok(played.length >= 1);
  assert.ok(played.every(p => p.position));
});

test('upgraded weapons fire the pack-a-punch laser instead of the stock shot', () => {
  const { audio, played } = recorder();
  const def = { ...data.weapons.m16_zm, upgraded: true };
  const own = audio.profile(def);
  audio.weapon('shot', def);
  assert.ok(played.some(p => p.kind.endsWith('pap/pap_shot_m')));
  assert.ok(played.some(p => p.kind.endsWith('pap/pap_shot_st')));
  assert.ok(!played.some(p => own.shot.includes(p.kind) || own.lfe.includes(p.kind) || own.sweet.includes(p.kind)));
});

test('stock guns and energy weapons keep their own shot sound', () => {
  assert.equal(usesPapShot(data.weapons.m16_zm, { pap: ['x'] }), false);
  assert.equal(usesPapShot({ upgraded: true }, { folder: 'energy/raygun', pap: ['x'] }), false);
  assert.equal(usesPapShot({ upgraded: true }, { folder: 'assault/m16', pap: ['x'] }), true);
});
