import test from 'node:test';
import assert from 'node:assert/strict';
import { createPauseControl } from '../export/web/pause-control.js';

function rig({ ready = true, over = false } = {}) {
  const log = [], keys = new Set(['KeyW']);
  let active = true;
  const control = createPauseControl({
    keys,
    touch: { reset: () => log.push('touch.reset'), setEnabled: v => log.push('touch.enabled:' + v) },
    player: () => ({ setEnabled: v => log.push('player:' + v) }),
    combat: () => ({ pause: () => log.push('combat.pause'), resume: () => log.push('combat.resume') }),
    ready: () => ready, gameOver: () => over,
    setActive: v => { active = v; },
    clearInput: () => log.push('clearInput'),
    onPause: () => log.push('onPause'),
  });
  return { control, log, keys, active: () => active };
}

test('pause stops input, player and combat', () => {
  const r = rig();
  r.control.setActive(false);
  assert.equal(r.active(), false);
  assert.equal(r.keys.size, 0);
  assert.deepEqual(r.log, ['clearInput', 'touch.reset', 'touch.enabled:false', 'player:false', 'combat.pause', 'onPause']);
});

test('resume re-enables everything once the map is ready', () => {
  const r = rig();
  r.control.setActive(false); r.log.length = 0;
  r.control.setActive(true);
  assert.equal(r.active(), true);
  assert.deepEqual(r.log, ['touch.reset', 'touch.enabled:true', 'player:true', 'combat.resume']);
});

test('resume is ignored before ready and after game over', () => {
  for (const opts of [{ ready: false }, { over: true }]) {
    const r = rig(opts);
    r.control.setActive(false); r.log.length = 0;
    r.control.setActive(true);
    assert.equal(r.active(), false);
    assert.deepEqual(r.log, []);
  }
});
