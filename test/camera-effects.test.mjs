import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraEffects } from '../export/web/camera-effects.js';
import { weaponFxProfile } from '../export/web/fx-profile.js';

function run(fx, seconds, step = 1 / 60) {
  const rolls = [];
  for (let t = 0; t < seconds; t += step) rolls.push(fx.update(step));
  return rolls;
}

function runAxes(fx, seconds, step = 1 / 60) {
  const out = { roll: [], pitch: [], yaw: [], trauma: [] };
  for (let t = 0; t < seconds; t += step) {
    out.roll.push(fx.update(step));
    out.pitch.push(fx.pitch);
    out.yaw.push(fx.yaw);
    out.trauma.push(fx.trauma);
  }
  return out;
}

function fakeCamera(x = 0.2, y = 1) {
  const rotation = {
    x,
    y,
    z: 0,
    set(nx, ny, nz) {
      rotation.x = nx;
      rotation.y = ny;
      rotation.z = nz;
    }
  };
  return { rotation };
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

test('a melee strike dips the view down, sweeps it sideways and settles level', () => {
  const fx = new CameraEffects(() => 0.5);
  fx.melee(0.8, 0.3);
  const axes = runAxes(fx, 0.8);
  assert.ok(Math.min(...axes.pitch) < -0.03);
  assert.ok(Math.min(...axes.yaw) < -0.02);
  assert.ok(Math.max(...axes.yaw) > 0.02);
  const rest = runAxes(fx, 1.5);
  assert.ok(Math.abs(rest.pitch.at(-1)) < 0.001);
  assert.ok(Math.abs(rest.yaw.at(-1)) < 0.001);
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

test('trauma also shakes the view up and down and side to side', () => {
  const fx = new CameraEffects(() => 0.5);
  fx.trauma = 1;
  const axes = runAxes(fx, 1);
  assert.ok(Math.max(...axes.pitch.map(Math.abs)) > 0.006);
  assert.ok(Math.max(...axes.yaw.map(Math.abs)) > 0.004);
  assert.ok(Math.max(...axes.pitch.map(Math.abs)) <= 0.031);
  assert.ok(Math.max(...axes.yaw.map(Math.abs)) <= 0.019);
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

test('a reload drops the view down when the magazine comes out, lifts it, and levels off', () => {
  const fx = new CameraEffects(() => 0.5);
  fx.reload(2);
  const axes = runAxes(fx, 2);
  const out = axes.pitch.slice(0, Math.floor(axes.pitch.length * 0.4));
  const lifted = axes.pitch.slice(Math.floor(axes.pitch.length * 0.4));
  assert.ok(Math.min(...out) < -0.025);
  assert.ok(Math.max(...lifted) > 0.004);
  assert.ok(Math.abs(axes.pitch.at(-1)) < 0.004);
  assert.ok(Math.abs(axes.yaw.at(-1)) < 0.004);
});

test('a reload jolts the camera when the magazine is released and seated', () => {
  const fx = new CameraEffects(() => 0.5);
  fx.reload(2);
  const axes = runAxes(fx, 2);
  assert.ok(Math.max(...axes.trauma) > 0.35);
  assert.ok(Math.max(...axes.yaw.map(Math.abs)) > 0.008);
});

test('an empty reload ends with a harder bolt jolt than a tactical one', () => {
  const tactical = new CameraEffects(() => 0.5);
  tactical.reload(2, 'magazine', false);
  const empty = new CameraEffects(() => 0.5);
  empty.reload(2, 'magazine', true);
  const late = axes => Math.max(...axes.trauma.slice(Math.floor(axes.trauma.length * 0.87)));
  assert.ok(late(runAxes(empty, 2)) > late(runAxes(tactical, 2)));
});

test('shell by shell reload stages dip and settle the view', () => {
  for (const stage of ['start', 'end']) {
    const fx = new CameraEffects(() => 0.5);
    fx.reload(1, stage);
    const axes = runAxes(fx, 1.2);
    assert.ok(Math.min(...axes.pitch) < -0.008, stage);
    assert.ok(Math.abs(axes.pitch.at(-1)) < 0.004, stage);
    assert.ok(Math.abs(axes.roll.at(-1)) < 0.002, stage);
  }
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
  assert.deepEqual([...new Set(fx.tilts.map(t => t.kind))], ['melee']);
  assert.deepEqual([...new Set(fx.events.map(e => e.kind))], ['melee']);
  assert.equal(fx.hand, null);
});

test('firing adds a small random roll kick that decays', () => {
  const fx = new CameraEffects(() => 1);
  fx.fire();
  const first = fx.update(1 / 60);
  assert.ok(first > 0 && first <= 0.006);
  assert.ok(Math.abs(run(fx, 1).at(-1)) < 0.0001);
});

test('firing never moves the aim up, down or sideways', () => {
  const fx = new CameraEffects(() => 1);
  fx.fire();
  fx.update(1 / 60);
  assert.equal(fx.pitch, 0);
  assert.equal(fx.yaw, 0);
});

test('reset levels the camera and clears pending effects', () => {
  const fx = new CameraEffects(() => 0.5);
  fx.melee(0.8, 0.3);
  fx.reset();
  assert.equal(fx.update(1 / 60), 0);
  assert.equal(fx.pitch, 0);
  assert.equal(fx.yaw, 0);
});

test('applying effects keeps the look the player steered and leaves no drift', () => {
  const camera = fakeCamera(0.2, 1);
  const fx = new CameraEffects(() => 0.5);
  fx.reload(2);
  let steered = 0;
  for (let i = 0; i < 180; i++) {
    camera.rotation.x += 0.001;
    camera.rotation.y -= 0.002;
    steered += 1;
    fx.apply(camera, 1 / 60);
  }
  assert.ok(Math.abs(camera.rotation.x - (0.2 + 0.001 * steered)) < 0.003);
  assert.ok(Math.abs(camera.rotation.y - (1 - 0.002 * steered)) < 0.003);
  assert.ok(Math.abs(camera.rotation.z) < 0.002);
});

test('the effect offsets move the camera while a reload is in progress', () => {
  const camera = fakeCamera(0, 0);
  const fx = new CameraEffects(() => 0.5);
  fx.reload(2);
  let lowest = 0;
  for (let i = 0; i < 60; i++) {
    fx.apply(camera, 1 / 60);
    lowest = Math.min(lowest, camera.rotation.x);
  }
  assert.ok(lowest < -0.02);
});

test('lookBase returns the steered look without the effect offsets', () => {
  const camera = fakeCamera(0.3, 2);
  const fx = new CameraEffects(() => 0.5);
  fx.melee(0.8, 0.3);
  for (let i = 0; i < 12; i++) fx.apply(camera, 1 / 60);
  assert.ok(Math.abs(camera.rotation.x - 0.3) > 0.01);
  const base = fx.lookBase(camera);
  assert.ok(Math.abs(base.pitch - 0.3) < 1e-9);
  assert.ok(Math.abs(base.yaw - 2) < 1e-9);
});

test('teleporting the camera drops the applied offsets instead of subtracting them later', () => {
  const camera = fakeCamera(0.3, 2);
  const fx = new CameraEffects(() => 0.5);
  fx.melee(0.8, 0.3);
  for (let i = 0; i < 12; i++) fx.apply(camera, 1 / 60);
  camera.rotation.set(0, 4, 0);
  fx.reset();
  fx.apply(camera, 1 / 60);
  assert.ok(Math.abs(camera.rotation.x) < 1e-9);
  assert.ok(Math.abs(camera.rotation.y - 4) < 1e-9);
  const again = fakeCamera(0.3, 2);
  const other = new CameraEffects(() => 0.5);
  other.melee(0.8, 0.3);
  for (let i = 0; i < 12; i++) other.apply(again, 1 / 60);
  again.rotation.set(0, 4, 0);
  for (let i = 0; i < 120; i++) other.apply(again, 1 / 60);
  assert.ok(Math.abs(again.rotation.x) < 0.002);
  assert.ok(Math.abs(again.rotation.y - 4) < 0.002);
});

test('reset takes the offsets back off the camera', () => {
  const camera = fakeCamera(0.3, 2);
  const fx = new CameraEffects(() => 0.5);
  fx.melee(0.8, 0.3);
  for (let i = 0; i < 12; i++) fx.apply(camera, 1 / 60);
  fx.reset();
  assert.ok(Math.abs(camera.rotation.x - 0.3) < 1e-9);
  assert.ok(Math.abs(camera.rotation.y - 2) < 1e-9);
  assert.equal(camera.rotation.z, 0);
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

test('building a window gives a soft shake that fades quickly', () => {
  const fx = new CameraEffects(() => 0.25);
  fx.build();
  const out = runAxes(fx, 1.5);
  const peak = Math.max(...out.roll.map(Math.abs), ...out.pitch.map(Math.abs));
  assert.ok(peak > 0.006, 'visible shake');
  assert.ok(peak < 0.03, 'but soft, well under a melee or reload kick');
  assert.ok(out.trauma[0] > 0);
  assert.equal(out.trauma.at(-1), 0);
  assert.ok(Math.abs(out.roll.at(-1)) < 1e-3);
});

test('each board adds a thud and a stronger build hits harder', () => {
  const soft = new CameraEffects(() => 0.25), hard = new CameraEffects(() => 0.25);
  soft.build(0.5); hard.build(1.5);
  const peak = fx => Math.max(...runAxes(fx, 0.6).pitch.map(Math.abs));
  assert.ok(peak(hard) > peak(soft));
});
