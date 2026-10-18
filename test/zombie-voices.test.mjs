import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../export/web/audio.js';
import { Enemies } from '../export/web/enemies.js';

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
  for (const name of ['w1', 'w2', 'w3', 's1', 's2']) audio.manifest['zombies/' + name] = { url: 'audio/zombies/' + name + '.ogg' };
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
  assert.match(handle.key, /^zombies\/w[123]$/);
  assert.equal(made.panners.length, 1);
  assert.equal(made.panners[0].positionX.value, 300);
  assert.equal(made.sources[0].started, true);
});

test('a sprinting zombie voice plays one of the sprint cues', async () => {
  const { audio } = setup();
  const keys = new Set();
  for (let i = 0; i < 40; i++) { audio.voices.clear(); keys.add(audio.voice('sprint', () => position(50, 0, 0)).key); }
  assert.deepEqual([...keys].sort(), ['zombies/s1', 'zombies/s2']);
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
