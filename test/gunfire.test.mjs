import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GUN_NEAR, GUN_RANGE, ShotLimiter, cleanShot, packShot, shotGain } from '../export/web/net/gunfire.js';
import { createCoop } from '../export/web/net/coop-client.js';
import { GameAudio } from '../export/web/audio.js';
import { MoonAudio } from '../export/web/moon-audio.js';

globalThis.requestAnimationFrame ??= () => 0;

const roster = [{ id: 'me', name: 'Me' }, { id: 'p2', name: 'Bo' }];

test('gunfire fades with distance and is silent beyond its range', () => {
  assert.equal(shotGain(0), 1);
  assert.equal(shotGain(GUN_NEAR), 1);
  const mid = shotGain((GUN_NEAR + GUN_RANGE) / 2);
  assert.ok(mid > 0 && mid < .5, `mid ${mid}`);
  assert.ok(shotGain(GUN_NEAR + 100) > shotGain(GUN_NEAR + 600));
  assert.equal(shotGain(GUN_RANGE), 0);
  assert.equal(shotGain(GUN_RANGE * 3), 0);
  assert.equal(shotGain(NaN), 0);
});

test('shot messages are cleaned and weapon names are restricted to safe characters', () => {
  assert.deepEqual(cleanShot(packShot({ id: 'm14_zm' }, { x: 1.04, y: 2, z: -3 })), { weapon: 'm14_zm', x: 1, y: 2, z: -3 });
  assert.equal(cleanShot(null), null);
  assert.equal(cleanShot({ w: '', x: 0, y: 0, z: 0 }), null);
  assert.equal(cleanShot({ w: 'ak74u', x: 'a', y: 0, z: 0 }), null);
  assert.equal(cleanShot({ w: 'ak74u', x: 1e9, y: 0, z: 0 }), null);
  assert.equal(cleanShot({ w: '../../etc', x: 0, y: 0, z: 0 }).weapon, 'etc');
});

test('ShotLimiter caps how often a player\'s shots are broadcast', () => {
  const limiter = new ShotLimiter(50);
  assert.equal(limiter.allow(0), true);
  assert.equal(limiter.allow(20), false);
  assert.equal(limiter.allow(50), true);
});

function fakeLobby() {
  const handlers = new Map(), sent = [];
  const game = { on: (type, fn) => { handlers.set(type, fn); return () => handlers.delete(type); }, send: (type, data) => { sent.push({ type, data }); return Promise.resolve(); } };
  return { lobby: { game, players: () => roster, onChange() {} }, handlers, sent };
}

function fakeAudio() {
  const log = { local: [], remote: [] };
  return {
    log,
    weapon(kind, def, position, gain) { log.local.push({ kind, id: def.id, position, gain }); },
    weaponAt(def, position, gain) { log.remote.push({ id: def.id, position, gain }); },
  };
}

function coopWithAudio(t = { now: 0 }) {
  const { lobby, handlers, sent } = fakeLobby(), camera = new THREE.PerspectiveCamera(), audio = fakeAudio();
  camera.position.set(100, 50, 100);
  const coop = createCoop({ scene: new THREE.Scene(), camera, feet: () => new THREE.Vector3(), points: () => 500, config: { lobby, selfId: 'me', roster, role: 'client' }, now: () => t.now, doc: null });
  const originalWeapon = audio.weapon;
  coop.attachAudio(audio, { weapons: { m14_zm: { id: 'm14_zm', name: 'M14' } } });
  return { coop, handlers, sent, audio, camera, t, originalWeapon };
}

test('a local shot is broadcast with the shooter\'s position, but only once per limiter window', () => {
  const { audio, sent, t } = coopWithAudio();
  audio.weapon('shot', { id: 'm14_zm' });
  assert.deepEqual(sent.filter(m => m.type === 'shot').map(m => m.data), [{ w: 'm14_zm', x: 100, y: 50, z: 100 }]);
  audio.weapon('shot', { id: 'm14_zm' });
  assert.equal(sent.filter(m => m.type === 'shot').length, 1);
  t.now = 100;
  audio.weapon('empty', { id: 'm14_zm' });
  audio.weapon('shot', { id: 'm14_zm' }, [1, 2, 3]);
  assert.equal(sent.filter(m => m.type === 'shot').length, 1, 'clicks and positional remote playback are never re-broadcast');
  assert.equal(audio.log.local.length, 4, 'the original sound still plays every time');
});

test('a teammate\'s shot plays from where they fired and gets quieter the further away they are', () => {
  const { audio, handlers } = coopWithAudio();
  handlers.get('shot')({ w: 'm14_zm', x: 100, y: 50, z: 700 }, 'p2');
  handlers.get('shot')({ w: 'm14_zm', x: 100, y: 50, z: 1900 }, 'p2');
  assert.equal(audio.log.remote.length, 2);
  assert.deepEqual(audio.log.remote[0].position, [100, 50, 700]);
  assert.equal(audio.log.remote[0].id, 'm14_zm');
  assert.ok(audio.log.remote[0].gain > audio.log.remote[1].gain && audio.log.remote[1].gain > 0);
});

test('shots from across the map, from strangers, from yourself or with junk are not played', () => {
  const { audio, handlers } = coopWithAudio();
  handlers.get('shot')({ w: 'm14_zm', x: 100, y: 50, z: 100 + GUN_RANGE + 10 }, 'p2');
  handlers.get('shot')({ w: 'm14_zm', x: 100, y: 50, z: 200 }, 'stranger');
  handlers.get('shot')({ w: 'm14_zm', x: 100, y: 50, z: 200 }, 'me');
  handlers.get('shot')({ w: '', x: 0, y: 0, z: 0 }, 'p2');
  handlers.get('shot')('nonsense', 'p2');
  assert.equal(audio.log.remote.length, 0);
});

test('an unknown weapon still plays through a minimal definition and dispose restores the audio', () => {
  const { coop, audio, handlers, originalWeapon } = coopWithAudio();
  handlers.get('shot')({ w: 'mystery_gun', x: 100, y: 50, z: 300 }, 'p2');
  assert.deepEqual(audio.log.remote[0].id, 'mystery_gun');
  coop.dispose();
  assert.equal(audio.weapon, originalWeapon);
  assert.equal(handlers.has('shot'), false);
});

function fakeContext() {
  const made = { panners: [], gains: [] };
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1 }, value: 0 });
  const ctx = {
    state: 'running', currentTime: 0,
    listener: { setPosition() {}, setOrientation() {} },
    createGain() { const g = node(); made.gains.push(g); return g; },
    createPanner() { const p = { ...node(), positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } }; made.panners.push(p); return p; },
    createBufferSource() { return { ...node(), start() {}, stop() {} }; },
  };
  return { ctx, made };
}

const cameraStub = { updateWorldMatrix() {}, matrixWorld: { elements: new Array(16).fill(0) } };

function audioFor(AudioClass, manifest) {
  const audio = new AudioClass();
  const { ctx, made } = fakeContext();
  audio.ctx = ctx; audio.master = ctx.createGain(); audio.camera = cameraStub;
  audio.manifest = manifest; audio.buffer = async () => ({});
  audio.warmWeapon = () => {};
  return { audio, made };
}

const m14 = { 'resident/wpn/assault/m14/plr/shot/shot_00': { url: 'x.ogg' } };

test('a remote gunshot is emitted from the shooter\'s position at the requested loudness', async () => {
  const { audio, made } = audioFor(GameAudio, m14);
  audio.weaponAt({ id: 'm14_zm' }, [10, 20, 30], .5);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(made.panners.length, 1);
  assert.deepEqual([made.panners[0].positionX.value, made.panners[0].positionY.value, made.panners[0].positionZ.value], [10, 20, 30]);
  const loud = audioFor(GameAudio, m14);
  loud.audio.weaponAt({ id: 'm14_zm' }, [10, 20, 30], 1);
  await new Promise(resolve => setImmediate(resolve));
  const volume = a => a.made.gains.at(-1).gain.value;
  assert.ok(Math.abs(volume({ made }) / volume(loud) - .5) < 1e-9);
});

test('a remote gunshot with no recorded sound stays silent instead of beeping everywhere', async () => {
  const { audio, made } = audioFor(GameAudio, {});
  const played = [];
  audio.play = (...args) => played.push(args);
  audio.weaponAt({ id: 'mystery_gun' }, [1, 2, 3], 1);
  audio.weapon('shot', { id: 'mystery_gun' });
  assert.equal(made.panners.length, 0);
  assert.equal(played.length, 1, 'only the local shot keeps its fallback sound');
  assert.equal(played[0][2], null);
});

test('Moon weapons are positional too', async () => {
  const { audio, made } = audioFor(MoonAudio, { 'moon/wpn/microwave/rifle/plr/microwave_rifle_shot': { url: 'x.ogg' } });
  audio.weaponAt({ id: 'microwavegun_zm' }, [5, 6, 7], 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(made.panners.length, 1);
  assert.deepEqual([made.panners[0].positionX.value, made.panners[0].positionZ.value], [5, 7]);
});
