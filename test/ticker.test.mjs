import test from 'node:test';
import assert from 'node:assert/strict';
import { createTickTimers } from '../export/web/net/ticker.js';

test('uses plain timers when Workers are unavailable', () => {
  const log = [];
  const timers = createTickTimers({ Worker: undefined, plain: { setInterval: (fn, ms) => { log.push(['set', ms]); return 7; }, clearInterval: id => log.push(['clear', id]) } });
  const id = timers.setInterval(() => {}, 100);
  timers.clearInterval(id);
  assert.deepEqual(log, [['set', 100], ['clear', 7]]);
});

test('runs intervals in a Worker, which is not throttled in a hidden tab, and stops it when the last one is cleared', () => {
  const posted = []; let worker = null, terminated = false;
  class FakeWorker { constructor() { worker = this; } postMessage(m) { posted.push(m); } terminate() { terminated = true; } }
  const URLish = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  const timers = createTickTimers({ Worker: FakeWorker, Blob: class {}, URL: URLish });
  let calls = 0;
  const a = timers.setInterval(() => calls++, 100), b = timers.setInterval(() => {}, 50);
  assert.deepEqual(posted.map(m => [m.type, m.ms]), [['start', 100], ['start', 50]]);
  worker.onmessage({ data: a }); worker.onmessage({ data: a });
  assert.equal(calls, 2);
  timers.clearInterval(a);
  worker.onmessage({ data: a });
  assert.equal(calls, 2, 'a cleared interval no longer fires');
  assert.equal(terminated, false);
  timers.clearInterval(b);
  assert.equal(terminated, true, 'the worker ends with its last timer');
});

test('falls back to plain timers if the Worker fails to start', () => {
  const log = [];
  const timers = createTickTimers({ Worker: class { constructor() { throw new Error('blocked'); } }, Blob: class {}, URL: { createObjectURL: () => 'blob:x' }, plain: { setInterval: () => { log.push('plain'); return 1; }, clearInterval() {} } });
  timers.setInterval(() => {}, 100);
  assert.deepEqual(log, ['plain']);
});
