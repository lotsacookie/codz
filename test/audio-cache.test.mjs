import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameAudio } from '../export/web/assets/js/audio.js';

test('mobile audio shares pending requests and evicts old decoded cues within its byte budget', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => { requests.push(url); return new Response(new Uint8Array([1, 2, 3])); });
  const audio = new GameAudio();
  audio.ctx = { decodeAudioData: async () => ({ length: 3, numberOfChannels: 1 }) };
  audio.manifest = { a: { url: '/a' }, b: { url: '/b' } };
  audio.maxBufferBytes = 16;
  const [a, same] = await Promise.all([audio.buffer('a'), audio.buffer('a')]);
  assert.equal(a, same);
  assert.deepEqual(requests, ['/a']);
  await audio.buffer('b');
  assert.equal(audio.snapshot().decodedBytes, 12);
  assert(!audio.buffers.has('a'));
  assert(audio.buffers.has('b'));
  await audio.buffer('a');
  assert.deepEqual(requests, ['/a', '/b', '/a']);
  assert(audio.snapshot().decodedBytes <= audio.maxBufferBytes);
});

test('a browser without Web Audio can still start the game silently', () => {
  if (globalThis.AudioContext || globalThis.webkitAudioContext) return;
  const audio = new GameAudio();
  assert.doesNotThrow(() => audio.start());
  assert.equal(audio.ctx, null);
  assert.equal(audio.enabled, false);
});
