import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../export/web/assets/js/audio.js';

globalThis.requestAnimationFrame ??= () => 0;

function fakeContext() {
  const made = { panners: [], gains: [] };
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1 }, value: 0 });
  const ctx = {
    state: 'running',
    listener: { setPosition() {}, setOrientation() {} },
    createGain() { const g = node(); made.gains.push(g); return g; },
    createPanner() { const p = { ...node(), positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } }; made.panners.push(p); return p; },
    createBufferSource() { return { ...node(), start() {}, stop() {} }; },
  };
  return { ctx, made };
}

function audioWith(camera) {
  const audio = new GameAudio();
  const { ctx, made } = fakeContext();
  audio.ctx = ctx;
  audio.master = ctx.createGain();
  audio.camera = camera;
  audio.manifest = { jingle: { url: 'audio/jingle.ogg' } };
  audio.buffer = async () => ({});
  return { audio, made };
}

const camera = { updateWorldMatrix() {}, matrixWorld: { elements: new Array(16).fill(0) } };

test('a sound with a position is emitted from that spot', async () => {
  const { audio, made } = audioWith(camera);
  await audio.native('jingle', 1, false, [10, 20, 30]);
  assert.equal(made.panners.length, 1);
  assert.deepEqual([made.panners[0].positionX.value, made.panners[0].positionY.value, made.panners[0].positionZ.value], [10, 20, 30]);
  assert.equal(made.panners[0].distanceModel, 'inverse');
  assert.ok(audio.spatial.size === 1);
});

test('a sound without a position, or without a camera, stays non-positional', async () => {
  const flat = audioWith(camera);
  await flat.audio.native('jingle', 1, false, null);
  assert.equal(flat.made.panners.length, 0);
  const noCamera = audioWith(null);
  await noCamera.audio.native('jingle', 1, false, [1, 2, 3]);
  assert.equal(noCamera.made.panners.length, 0);
});
