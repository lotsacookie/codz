import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../export/web/assets/js/audio.js';
import { Enemies } from '../export/web/assets/js/enemies.js';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../export/web/assets/audio/manifest.json', import.meta.url), 'utf8'));

globalThis.requestAnimationFrame ??= () => 0;

function setup(cameraAt = [0, 0, 0]) {
  const made = { panners: [], sources: [] };
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1 }, value: 0 });
  const ctx = {
    state: 'running',
    listener: { setPosition() {}, setOrientation() {} },
    createGain() { return node(); },
    createPanner() { const p = { ...node(), positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } }; made.panners.push(p); return p; },
    createBufferSource() { const s = { ...node(), started: false, stopped: false, start() { this.started = true; }, stop() { this.stopped = true; } }; made.sources.push(s); return s; },
  };
  const elements = new Array(16).fill(0);
  [elements[12], elements[13], elements[14]] = cameraAt;
  const audio = new GameAudio();
  audio.ctx = ctx;
  audio.master = node();
  audio.camera = { updateWorldMatrix() {}, matrixWorld: { elements } };
  for (const key of Object.keys(manifest)) if (key.startsWith('ref/vox/zmb/')) audio.manifest[key] = manifest[key];
  audio.buffer = async () => ({});
  return { audio, made };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const position = (x = 0, y = 0, z = 0) => ({ x, y, z });

test('a walking zombie voice plays one of the walk cues from the zombie position', async () => {
  const { audio, made } = setup();
  const handle = audio.voice('walk', () => position(300, 0, 0));
  await flush();
  assert.ok(handle);
  assert.match(handle.key, /^ref\/vox\/zmb\/standard\/(amb|behind)\//);
  assert.equal(made.panners.length, 1);
  assert.equal(made.panners[0].positionX.value, 300);
  assert.equal(made.sources[0].started, true);
});

test('a sprinting zombie voice plays one of the sprint cues', async () => {
  const { audio } = setup();
  const keys = new Set();
  for (let i = 0; i < 80; i++) { audio.voices.clear(); keys.add(audio.voice('sprint', () => position(900, 0, 0)).key); }
  assert.ok(keys.size > 3);
  assert.ok([...keys].every(key => key.startsWith('ref/vox/zmb/standard/sprint/')));
});

test('the voice follows the zombie while it plays', async () => {
  const { audio, made } = setup();
  const zombie = position(200, 0, 0);
  audio.voice('sprint', () => zombie);
  await flush();
  zombie.x = 650;
  zombie.z = 90;
  audio.tracked.forEach(t => audio.place(t.panner, t.locate()));
  assert.equal(made.panners[0].positionX.value, 650);
  assert.equal(made.panners[0].positionZ.value, 90);
});

test('zombies too far away are skipped and the number of voices is capped', async () => {
  const { audio } = setup([0, 0, 0]);
  assert.equal(audio.voice('walk', () => position(5000, 0, 0)), null);
  for (let i = 0; i < 14; i++) assert.ok(audio.voice('walk', () => position(100, 0, 0)));
  assert.equal(audio.voice('walk', () => position(100, 0, 0)), null);
});

test('stopping a voice stops its source and finishing frees the slot', async () => {
  const { audio, made } = setup();
  const handle = audio.voice('walk', () => position(100, 0, 0));
  await flush();
  handle.stop();
  assert.equal(made.sources[0].stopped, true);
  made.sources[0].onended();
  assert.equal(handle.ended, true);
  assert.equal(audio.voices.size, 0);
  assert.equal(audio.tracked.size, 0);
});

test('a voice is not played while audio is muted or suspended', () => {
  const muted = setup();
  muted.audio.enabled = false;
  assert.equal(muted.audio.voice('walk', () => position()), null);
  const suspended = setup();
  suspended.audio.ctx.state = 'suspended';
  assert.equal(suspended.audio.voice('walk', () => position()), null);
});

function speaker(requests) {
  const enemies = Object.create(Enemies.prototype);
  enemies.onVoice = (z, gait) => { requests.push(gait); return { ended: false, stop() { this.ended = true; } }; };
  return enemies;
}

test('zombies below sprint speed ask for walk voices and fast ones for sprint voices', () => {
  const requests = [];
  const enemies = speaker(requests);
  enemies.speak({ speed: 52, voice: null, voiceGap: 0 }, .1);
  enemies.speak({ speed: 100, voice: null, voiceGap: 0 }, .1);
  enemies.speak({ speed: 150, voice: null, voiceGap: 0 }, .1);
  enemies.speak({ speed: 40, baseSpeed: 150, voice: null, voiceGap: 0 }, .1);
  assert.deepEqual(requests, ['walk', 'sprint', 'sprint', 'sprint']);
});

test('a zombie waits out its gap and does not talk over its own voice', () => {
  const requests = [];
  const enemies = speaker(requests);
  const z = { speed: 52, voice: null, voiceGap: .5 };
  enemies.speak(z, .2);
  assert.equal(requests.length, 0);
  enemies.speak(z, .4);
  assert.equal(requests.length, 1);
  enemies.speak(z, 5);
  assert.equal(requests.length, 1);
  z.voice.ended = true;
  enemies.speak(z, .01);
  assert.equal(requests.length, 1);
  assert.equal(z.voice, null);
  assert.ok(z.voiceGap > .3);
});

test('a zombie retries soon when no voice could be started', () => {
  const enemies = Object.create(Enemies.prototype);
  enemies.onVoice = () => null;
  const z = { speed: 52, voice: null, voiceGap: 0 };
  enemies.speak(z, .1);
  assert.equal(z.voice, null);
  assert.equal(z.voiceGap, 1.2);
});

test('silencing a zombie stops its voice', () => {
  const enemies = Object.create(Enemies.prototype);
  let stopped = false;
  const z = { voice: { stop() { stopped = true; } } };
  enemies.silence(z);
  assert.equal(stopped, true);
  assert.equal(z.voice, null);
  enemies.silence({ voice: null });
});

test('quad crawlers use the quad ambient set', () => {
  const { audio } = setup();
  const handle = audio.voice('walk', () => position(900, 0, 0), 'nova');
  assert.match(handle.key, /^ref\/vox\/zmb\/quads\/ambient\//);
});

test('a zombie close behind the player can use the behind callouts', () => {
  const { audio } = setup();
  audio.camera.matrixWorld.elements[10] = 1;
  const seen = new Set();
  for (let i = 0; i < 60; i++) { audio.voices.clear(); seen.add(audio.voice('walk', () => position(0, 0, 100)).key.split('/')[4]); }
  assert.ok(seen.has('behind'));
});

test('attack and death events play the reference attack and death voices', () => {
  const { audio } = setup();
  const played = [];
  audio.play = (key, volume, at) => played.push({ key, at });
  audio.zombieEvent('attack', 'zombie', [1, 2, 3]);
  audio.zombieEvent('death', 'zombie', [1, 2, 3]);
  audio.zombieEvent('death', 'zombie', [1, 2, 3], 1, 'electric');
  audio.zombieEvent('attack', 'nova', [1, 2, 3]);
  audio.zombieEvent('spawn', 'nova', [1, 2, 3]);
  assert.match(played[0].key, /standard\/attack\//);
  assert.match(played[1].key, /standard\/death\//);
  assert.match(played[2].key, /standard\/elec\//);
  assert.match(played[3].key, /quads\/attack\//);
  assert.match(played[4].key, /quads\/spawn\//);
  assert.deepEqual(played[0].at, [1, 2, 3]);
});

test('hellhounds use the reference dog voices, steps and collar jingle', () => {
  const { audio } = setup();
  for (const key of Object.keys(manifest)) if (/^ref\/(aml\/dog|evt\/zombie_(tron|global)\/hellhounds)\//.test(key)) audio.manifest[key] = manifest[key];
  const played = [];
  audio.play = (key, volume, at) => played.push(key);
  audio.zombieEvent('attack', 'dog', [0, 0, 0]);
  audio.zombieEvent('bite', 'dog', [0, 0, 0]);
  audio.zombieEvent('death', 'dog', [0, 0, 0]);
  audio.zombieEvent('spawn', 'dog', [0, 0, 0]);
  for (let i = 0; i < 30; i++) audio.zombieEvent('step', 'dog', [0, 0, 0]);
  assert.match(played[0], /hellhounds\/vox\/attack\/|aml\/dog\/bark\//);
  assert.match(played[1], /hellhounds\/vox\/bite\/|aml\/dog\/dog_bite/);
  assert.match(played[2], /hellhounds\/vox\/death\/|aml\/dog\/death\//);
  assert.match(played[3], /hellhounds\/spawn\//);
  assert.ok(played.slice(4).some(key => key.includes('/hellhounds/step/')));
  assert.ok(played.slice(4).some(key => key.includes('run_collar')));
  const handle = audio.voice('sprint', () => position(900, 0, 0), 'dog');
  assert.match(handle.key, /hellhounds\/vox\/move\//);
});

test('hellhounds yelp when hurt, break their neck to melee and growl over a lethal bite', () => {
  const { audio } = setup();
  for (const key of Object.keys(manifest)) if (/^ref\/(aml\/dog|evt\/zombie_(tron|global)\/hellhounds)\//.test(key)) audio.manifest[key] = manifest[key];
  const played = [];
  audio.play = (key) => played.push(key);
  audio.zombieEvent('pain', 'dog', [0, 0, 0]);
  audio.zombieEvent('death', 'dog', [0, 0, 0], 1, 'melee');
  audio.zombieEvent('killplayer', 'dog', [0, 0, 0]);
  assert.match(played[0], /aml\/dog\/pain\//);
  assert.ok(played.some(key => key.endsWith('dog_neckbreak')));
  assert.ok(played.some(key => key.endsWith('anml_dog_attack_kill_player2')));
});

test('the dog round start plays the music, announcer and left/right stems', () => {
  const { audio } = setup();
  audio.camera = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1] } };
  for (const key of ['dog_round', 'dog_announce', 'ref/english/voiceovers/zmb/ann/ann_dog_start_l', 'ref/english/voiceovers/zmb/ann/ann_dog_start_r']) audio.manifest[key] = manifest[key];
  const played = [];
  audio.play = (key, volume, at) => played.push({ key, at });
  audio.dogRoundStart();
  assert.deepEqual(played.map(p => p.key), ['dog_round', 'dog_announce', 'ref/english/voiceovers/zmb/ann/ann_dog_start_l', 'ref/english/voiceovers/zmb/ann/ann_dog_start_r']);
  assert.deepEqual(played[2].at, [-290, 20, 30]);
  assert.deepEqual(played[3].at, [310, 20, 30]);
});
