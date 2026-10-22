import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { atlasFrame, pickFrame, loadAtlas, randomFrame } from '../export/web/fx-atlas.js';
import { hitBearing, HitDirections, HIT_LIFE } from '../export/web/hit-direction.js';
import { createMuzzleFlash } from '../export/web/muzzle-fx.js';
import { SURFACES, classifySurface, surfaceTextureUrl } from '../export/web/impact-fx.js';
import { GameAudio } from '../export/web/audio.js';

const web = new URL('../export/web/', import.meta.url);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);

test('atlas frames split a sheet into equal horizontal slices', () => {
  assert.deepEqual(atlasFrame(0, 2), { repeatX: 0.5, offsetX: 0 });
  assert.deepEqual(atlasFrame(1, 2), { repeatX: 0.5, offsetX: 0.5 });
  assert.deepEqual(atlasFrame(3, 2), { repeatX: 0.5, offsetX: 0.5 });
  assert.deepEqual(atlasFrame(-1, 4), { repeatX: 0.25, offsetX: 0.75 });
  assert.equal(pickFrame(2, () => 0), 0);
  assert.equal(pickFrame(2, () => 0.999999), 1);
  assert.equal(pickFrame(2, () => 1), 1, 'never indexes past the last frame');
});

test('atlas without a DOM stays empty so callers keep their procedural fallback', () => {
  const atlas = loadAtlas('textures/does-not-exist.png', 2);
  assert.equal(atlas.frames.length, 0);
  assert.equal(randomFrame(atlas), null);
  assert.equal(loadAtlas('textures/does-not-exist.png', 2), atlas, 'one load per url');
});

test('hit bearing is relative to where the player is looking', () => {
  const player = { x: 0, z: 0 };
  near(hitBearing(player, 0, { x: 0, z: -10 }), 0, 'ahead');
  near(hitBearing(player, 0, { x: 10, z: 0 }), 90, 'right');
  near(hitBearing(player, 0, { x: 0, z: 10 }), 180, 'behind');
  near(hitBearing(player, 0, { x: -10, z: 0 }), 270, 'left');
  // Turning left 90 degrees puts what was straight ahead on the right.
  near(hitBearing(player, Math.PI / 2, { x: 0, z: -10 }), 90, 'ahead after turning left');
});

test('hit arcs merge nearby attackers, keep pointing at them while turning, and expire', () => {
  const hits = new HitDirections();
  const first = hits.add(0, 0);
  hits.update(1);
  assert.equal(hits.add(10, 0), first, 'a nearby attacker refreshes the existing arc');
  assert.equal(first.age, 0);
  assert.equal(hits.items.length, 1);
  hits.add(180, 0);
  assert.equal(hits.items.length, 2);
  // Hit from straight ahead; after the player turns left 90 degrees the arc has swung to the right.
  const turned = new HitDirections();
  const arc = turned.add(0, 0);
  near(turned.screenAngle(arc, 90), 90, 'arc follows the attacker as the player turns');
  const world = new HitDirections();
  const worldArc = world.add(90, 45); // seen at 90 deg while already yawed 45 deg left
  near(world.screenAngle(worldArc, 45), 90, 'angle is stable at the yaw it was recorded');
  assert.ok(hits.opacity({ age: 0 }) === 0 && hits.opacity({ age: HIT_LIFE * 0.1 }) > 0.8);
  hits.update(HIT_LIFE + 0.1);
  assert.equal(hits.items.length, 0);
});

test('hit arcs cap how many attackers are shown', () => {
  const hits = new HitDirections({ max: 3 });
  for (const bearing of [0, 90, 180, 270]) hits.add(bearing, 0);
  assert.equal(hits.items.length, 3);
});

test('muzzle flash shows nothing without the reference flash atlas', () => {
  const tag = new THREE.Object3D();
  const flash = createMuzzleFlash(tag);
  flash.fire({ size: 6 });
  assert.equal(flash.group.visible, false);
  assert.equal(flash.group.children.length, 0);
  flash.dispose();
});

test('new reference cues are in the manifest with files on disk', () => {
  const manifest = JSON.parse(readFileSync(new URL('audio/manifest.json', web), 'utf8'));
  for (const key of ['heartbeat', 'tinnitus', 'scope_breath_in', 'scope_breath_out', 'scope_breath_gasp', 'death_card']) {
    const entry = manifest[key];
    assert.ok(entry, `${key} missing from manifest`);
    assert.ok(existsSync(new URL(entry.url, web)), `${entry.url} missing on disk`);
    assert.match(entry.source, /^export\/web\/reference\/sounds\/sound\//);
    assert.match(entry.sourceSha256, /^[0-9a-f]{64}$/);
    assert.ok(entry.duration > 0.5, `${key} duration`);
  }
  for (const texture of ['fxt_fire_gas_flash', 'fxt_smk_puff', 'damage_feedback', 'hit_direction', '~-gbullethole1', '~-gbullethole2']) {
    assert.ok(existsSync(new URL(`textures/${texture}.png`, web)), `textures/${texture}.png missing`);
    assert.ok(existsSync(new URL(`textures-mobile/${texture}.png`, web)), `textures-mobile/${texture}.png missing`);
  }
});

test('every bullet hole decal exists in full and mobile texture folders', () => {
  for (const [surface, config] of Object.entries(SURFACES)) {
    assert.ok(config.files.length > 0 && config.size > 0, `${surface} config`);
    for (const file of config.files) {
      const encoded = surfaceTextureUrl(file);
      assert.ok(existsSync(new URL(encoded, web)), `${encoded} missing`);
      assert.ok(existsSync(new URL(encoded.replace('textures/', 'textures-mobile/'), web)), `mobile ${encoded} missing`);
    }
  }
  assert.equal(surfaceTextureUrl('~-gimpact_wood02_col#0.png'), 'textures/~-gimpact_wood02_col%230.png');
});

test('bullet holes pick a surface from what was hit', () => {
  const floor = new THREE.Vector3(0, 1, 0);
  const wall = new THREE.Vector3(1, 0, 0);
  const at = (x, y, z) => ({ position: new THREE.Vector3(x, y, z) });
  assert.equal(classifySurface({ ...at(0, 0, 0), dynamic: true }, wall), 'wood');
  assert.equal(classifySurface({ ...at(0, 0, 0), surface: 'metal' }, wall), 'metal');
  assert.equal(classifySurface({ ...at(0, 0, 0), surface: 'nonsense' }, wall), 'plaster');
  assert.ok(['concrete', 'asphalt'].includes(classifySurface(at(10, 0, 10), floor)));
  assert.ok(['concrete', 'plaster'].includes(classifySurface(at(10, 50, 10), wall)));
  assert.equal(classifySurface(at(10, 50, 10), wall), classifySurface(at(11, 51, 11), wall), 'nearby shots on one wall share a surface');
  assert.equal(classifySurface(null, null), 'generic');
});

function audioWithFakeSources() {
  const audio = new GameAudio();
  audio.ctx = { state: 'running' };
  audio.manifest = { heartbeat: {}, scope_breath_in: {}, scope_breath_out: {}, scope_breath_gasp: {} };
  const sources = [];
  audio.native = async key => { const source = { key, stopped: false, stop() { this.stopped = true; } }; sources.push(source); return source; };
  return { audio, sources };
}

test('heartbeat loop starts once, stops when health recovers, and survives start/stop races', async () => {
  const { audio, sources } = audioWithFakeSources();
  audio.heartbeat(true);
  audio.heartbeat(true);
  await Promise.resolve();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].stopped, false);
  audio.heartbeat(false);
  assert.equal(sources[0].stopped, true);
  // Stopped again before the buffer finished loading: the late source must be stopped, not left looping.
  audio.heartbeat(true);
  audio.heartbeat(false);
  await Promise.resolve();
  assert.equal(sources[1].stopped, true);
  audio.heartbeat(true);
  await Promise.resolve();
  audio.dispose();
  assert.equal(sources[2].stopped, true);
});

test('heartbeat waits for the audio context instead of latching on early', () => {
  const audio = new GameAudio();
  audio.manifest = { heartbeat: {} };
  audio.heartbeat(true);
  assert.notEqual(audio.beatOn, true);
});

test('scope breathing only plays for sniper rifles', () => {
  const { audio } = audioWithFakeSources();
  const played = [];
  audio.play = key => played.push(key);
  audio.scopeBreath({ id: 'l96a1_zm' }, true);
  audio.scopeBreath({ id: 'l96a1_zm' }, false);
  audio.scopeBreath({ id: 'm14_zm' }, true);
  audio.scopeBreath({ id: 'm14_zm' }, false);
  assert.deepEqual(played, ['scope_breath_in', 'scope_breath_out']);
  played.length = 0;
  audio.scopeBreath({ id: 'dragunov_zm' }, true);
  audio.scopeSince -= 5000;
  audio.scopeBreath({ id: 'dragunov_zm' }, false);
  assert.deepEqual(played, ['scope_breath_in', 'scope_breath_gasp']);
});
