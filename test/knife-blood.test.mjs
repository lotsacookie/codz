import test from 'node:test';
import assert from 'node:assert/strict';
import { KnifeBlood } from '../export/web/assets/js/knife-blood.js';

const seeded = () => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const swing = (kb, frames, emit, speed = 400, dt = 1 / 60) => {
  let n = 0;
  for (let i = 0; i < frames; i++) n += kb.update(dt, { x: i * speed * dt, y: 0, z: 0 }, emit);
  return n;
};

test('a clean knife throws no blood', () => {
  const kb = new KnifeBlood({ random: seeded() });
  assert.equal(swing(kb, 60, () => assert.fail('emitted')), 0);
});

test('a hit soaks the blade and a lot of blood trails off it', () => {
  const kb = new KnifeBlood({ random: seeded() });
  kb.soak();
  let drops = 0;
  const n = swing(kb, 40, () => drops++);
  assert.ok(n > 40 && n === drops, `expected plenty of drops, got ${n}`);
});

test('faster swings fling more blood than slow ones', () => {
  const a = new KnifeBlood({ random: seeded() }), b = new KnifeBlood({ random: seeded() });
  a.soak(); b.soak();
  assert.ok(swing(a, 40, () => {}, 900) > swing(b, 40, () => {}, 50));
});

test('blood fades out, drops move away from the blade motion, and a hidden knife resets', () => {
  const kb = new KnifeBlood({ duration: 0.5, random: seeded() });
  kb.soak();
  const velocities = [];
  swing(kb, 10, (p, v) => velocities.push(v));
  assert.ok(velocities.every(v => v.x < 0), 'drops trail behind a +x swing');
  swing(kb, 120, () => {});
  assert.equal(kb.active, false);
  kb.soak();
  kb.update(1 / 60, null, () => {});
  assert.equal(kb.active, false);
});

test('repeated hits keep the blade fully soaked', () => {
  const kb = new KnifeBlood();
  kb.soak(); kb.soak();
  assert.equal(kb.level, 1);
});
