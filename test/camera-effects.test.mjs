import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraEffects } from '../export/web/camera-effects.js';
import { weaponFxProfile } from '../export/web/fx-profile.js';

function run(fx, seconds, step = 1 / 60) {
  const rolls = [];
  for (let t = 0; t < seconds; t += step) rolls.push(fx.update(step));
  return rolls;
}

test('a melee strike tilts the camera right, then settles back level', () => {
  const fx = new CameraEffects(() => 0.5);
  fx.melee(0.8, 0.3);
  const rolls = run(fx, 0.3);
  assert.ok(Math.min(...rolls) < -0.07);
  assert.ok(rolls.every(r => r < 0.02));
  const rest = run(fx, 1.4);
  assert.ok(Math.abs(rest.at(-1)) < 0.001);
});

test('a melee impact adds trauma at the hit time', () => {
  const fx = new CameraEffects(() => 0.5);
  fx.melee(0.8, 0.3);
  run(fx, 0.2);
  const before = fx.trauma;
  run(fx, 0.15);
  assert.ok(fx.trauma > 0.45);
  assert.ok(fx.trauma > before);
});

test('trauma shakes the camera quickly and the shake dies away', () => {
  const fx = new CameraEffects(() => 0.5);
  fx.trauma = 1;
  const rolls = run(fx, 1);
  let reversals = 0;
  for (let i = 2; i < rolls.length; i++) if ((rolls[i] - rolls[i - 1]) * (rolls[i - 1] - rolls[i - 2]) < 0) reversals++;
  assert.ok(reversals > 5);
  const peak = Math.max(...rolls.map(Math.abs));
  assert.ok(peak > 0.008 && peak <= 0.051);
  assert.ok(Math.abs(run(fx, 2).at(-1)) < 0.0001);
});

test('a reload tilts toward the gun first and then to the left', () => {
  const fx = new CameraEffects(() => 0.5);
  fx.reload(2);
  const rolls = run(fx, 2);
  const early = rolls.slice(0, Math.floor(rolls.length * 0.35));
  const late = rolls.slice(Math.floor(rolls.length * 0.55));
  assert.ok(Math.min(...early) < -0.045);
  assert.ok(Math.max(...late) > 0.03);
  assert.ok(Math.abs(rolls.at(-1)) < 0.002);
});

test('the leftward reload tilt changes in size from reload to reload', () => {
  const peaks = new Set();
  for (let i = 0; i < 12; i++) {
    const fx = new CameraEffects();
    fx.reload(2);
    peaks.add(Math.max(...run(fx, 2)).toFixed(3));
  }
  assert.ok(peaks.size > 4);
});

test('starting a melee strike cancels a reload tilt', () => {
  const fx = new CameraEffects(() => 0.5);
  fx.reload(2);
  run(fx, 0.3);
  fx.melee(0.8, 0.3);
  assert.deepEqual(fx.tilts.map(t => t.kind), ['melee']);
});

test('firing adds a small random roll kick that decays', () => {
  const fx = new CameraEffects(() => 1);
  fx.fire();
  const first = fx.update(1 / 60);
  assert.ok(first > 0 && first <= 0.006);
  assert.ok(Math.abs(run(fx, 1).at(-1)) < 0.0001);
});

test('reset levels the camera and clears pending effects', () => {
  const fx = new CameraEffects(() => 0.5);
  fx.melee(0.8, 0.3);
  fx.reset();
  assert.equal(fx.update(1 / 60), 0);
});

test('energy and launcher weapons have no muzzle flash or smoke', () => {
  for (const id of ['ray_gun_zm', 'thundergun_zm', 'crossbow_explosive_zm', 'knife_ballistic_zm', 'microwavegun_zm', 'china_lake_zm']) {
    assert.equal(weaponFxProfile({ id }), null, id);
  }
  assert.equal(weaponFxProfile({ id: 'm16_zm', attachmentActive: true, projectileSpeed: 800 }), null);
  assert.equal(weaponFxProfile(null), null);
});

test('shotguns flash bigger and smoke more than pistols, and upgraded weapons are larger', () => {
  const pistol = weaponFxProfile({ id: 'm1911_zm' });
  const shotgun = weaponFxProfile({ id: 'rottweil72_zm' });
  const rifle = weaponFxProfile({ id: 'm14_zm' });
  assert.equal(pistol.kind, 'pistol');
  assert.equal(shotgun.kind, 'shotgun');
  assert.equal(rifle.kind, 'rifle');
  assert.ok(shotgun.size > rifle.size && rifle.size > pistol.size);
  assert.ok(shotgun.puffs > pistol.puffs);
  const upgraded = weaponFxProfile({ id: 'm14_zm', upgraded: true });
  assert.ok(upgraded.size > rifle.size && upgraded.puffs > rifle.puffs);
});
