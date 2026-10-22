import test from 'node:test';
import assert from 'node:assert/strict';
import { PuppetTracker, cleanSnapshot, followFactor, followPosition, packSnapshot } from '../export/web/assets/js/net/zombie-sync.js';

const session = { round: 1, phase: 'fighting', total: 5, spawned: 1, killed: 0, countdown: 0, dogRound: false, area: '' };
const zombie = (id, x) => ({ id, kind: 'zombie', state: 'chase', health: 100, maxHealth: 100, root: { position: { x, y: 0, z: 0 }, rotation: { y: 0 } } });
const snap = (seq, time, ...zs) => cleanSnapshot(packSnapshot({ seq, session, zombies: zs, time }));

test('the host clock rides through a snapshot and a missing one falls back to arrival time', () => {
  assert.equal(snap(1, 1234.56, zombie(1, 0)).time, 1234.6);
  assert.equal(cleanSnapshot(packSnapshot({ seq: 1, session, zombies: [zombie(1, 0)] })).time, null);
  assert.equal(cleanSnapshot({ q: 1, h: 'soon', z: [] }).time, null);
});

test('snapshots that arrive bunched together still move zombies at the host\'s pace', () => {
  const tracker = new PuppetTracker({ delay: 100 });
  tracker.receive(snap(1, 1000, zombie(1, 0)), 5000);
  tracker.receive(snap(2, 1067, zombie(1, 30)), 5067);
  tracker.receive(snap(3, 1133, zombie(1, 60)), 5400);
  tracker.receive(snap(4, 1200, zombie(1, 90)), 5400);
  const positions = [5200, 5250, 5300, 5350, 5400].map(t => tracker.sample(1, t).x);
  for (let i = 1; i < positions.length; i++) {
    const step = positions[i] - positions[i - 1];
    assert.ok(step >= 0 && step <= 40, `step ${step} stays small and forward-moving`);
  }
});

test('a late snapshot is covered by a short glide, not a freeze followed by a jump', () => {
  const tracker = new PuppetTracker({ delay: 100 });
  tracker.receive(snap(1, 0, zombie(1, 0)), 1000);
  tracker.receive(snap(2, 100, zombie(1, 20)), 1100);
  const before = tracker.sample(1, 1250).x;
  const during = tracker.sample(1, 1300).x;
  assert.ok(during > before, 'keeps moving while the next snapshot is late');
  tracker.receive(snap(3, 200, zombie(1, 40)), 1320);
  const after = tracker.sample(1, 1320).x;
  assert.ok(Math.abs(after - during) < 12, `no jump when it lands (${after - during})`);
});

test('a teleport is shown at once and never extrapolated', () => {
  const tracker = new PuppetTracker({ delay: 0 });
  tracker.receive(snap(1, 0, zombie(1, 0)), 0);
  tracker.receive(snap(2, 100, zombie(1, 400)), 100);
  assert.equal(tracker.sample(1, 200).x, 400);
});

test('two samples closer than a few milliseconds are not used to guess a speed', () => {
  const tracker = new PuppetTracker({ delay: 0 });
  tracker.receive(snap(1, 0, zombie(1, 0)), 0);
  tracker.receive(snap(2, 0, zombie(1, 50)), 0);
  assert.equal(tracker.sample(1, 100).x, 50);
});

test('a new host clock after clear() is learned again', () => {
  const tracker = new PuppetTracker({ delay: 0 });
  tracker.receive(snap(1, 9000, zombie(1, 0)), 100);
  tracker.clear();
  assert.equal(tracker.offset, null);
  tracker.receive(snap(1, 10, zombie(1, 7)), 5000);
  assert.equal(tracker.sample(1, 5010).x, 7);
});

test('displayed positions ease toward the target and only snap across real gaps', () => {
  const position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  assert.ok(followFactor(.016) > 0 && followFactor(.016) < 1);
  assert.equal(followFactor(0), 0);
  assert.equal(followPosition(position, { x: 20, y: 0, z: 0 }, .016), false);
  assert.ok(position.x > 0 && position.x < 20);
  for (let i = 0; i < 120; i++) followPosition(position, { x: 20, y: 0, z: 0 }, .016);
  assert.ok(Math.abs(position.x - 20) < .01);
  assert.equal(followPosition(position, { x: 900, y: 0, z: 0 }, .016), true);
  assert.equal(position.x, 900);
});
