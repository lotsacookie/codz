import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PuppetTracker, packSnapshot, cleanSnapshot, packZombie, cleanHit, packHit, cleanDead, cleanAward, cleanHurt, cleanBoardRequest,
  MAX_ZOMBIES, MAX_PEER_DAMAGE, MAX_HIT_DAMAGE, STATES,
} from '../export/web/net/zombie-sync.js';
import { ZombieNet } from '../export/web/net/zombie-net.js';
import { packMessage, unpackMessage, MESSAGE_TYPES } from '../export/web/net/protocol.js';

const zombie = (id, x, extra = {}) => ({ id, kind: 'zombie', state: 'chase', health: 75, maxHealth: 150, root: { position: { x, y: 1.26, z: -3 }, rotation: { y: .5 } }, ...extra });
const session = { round: 4, phase: 'fighting', total: 20, spawned: 7, killed: 3, countdown: 0, dogRound: false, area: '' };

test('a snapshot survives packing and cleaning and carries the round state', () => {
  const raw = JSON.parse(JSON.stringify(packSnapshot({ seq: 9, session, zombies: [zombie(1, 100), zombie(2, 200, { kind: 'dog', state: 'attack', health: 150 })], boards: [3, 6, 0] })));
  const snap = cleanSnapshot(raw);
  assert.equal(snap.seq, 9);
  assert.equal(snap.round, 4); assert.equal(snap.phase, 'fighting'); assert.equal(snap.total, 20); assert.equal(snap.killed, 3);
  assert.deepEqual(snap.boards, [3, 6, 0]);
  assert.equal(snap.zombies.length, 2);
  assert.deepEqual({ ...snap.zombies[0] }, { id: 1, kind: 'zombie', x: 100, y: 1.3, z: -3, yaw: .5, state: 0, hp: snap.zombies[0].hp });
  assert.ok(Math.abs(snap.zombies[0].hp - .5) < .01);
  assert.equal(snap.zombies[1].kind, 'dog');
  assert.equal(STATES[snap.zombies[1].state], 'attack');
});

test('preparing rounds, unknown kinds and states are packed safely', () => {
  const snap = cleanSnapshot(packSnapshot({ seq: 1, session: { ...session, phase: 'preparing', countdown: 6.04 }, zombies: [zombie(5, 0, { kind: 'mystery', state: 'dead' })] }));
  assert.equal(snap.phase, 'preparing'); assert.equal(snap.countdown, 6);
  assert.equal(snap.zombies[0].kind, 'zombie'); assert.equal(snap.zombies[0].state, 0);
});

test('garbage snapshots and entries are dropped, and the zombie count is capped', () => {
  assert.equal(cleanSnapshot(null), null);
  assert.equal(cleanSnapshot({ z: 'nope' }), null);
  const many = Array.from({ length: MAX_ZOMBIES + 30 }, (_, i) => packZombie(zombie(i, i)));
  const snap = cleanSnapshot({ q: 1, r: 2, p: 1, z: [...many, [1, 2], 'x', [1, 0, NaN, 0, 0, 0, 0, 0], [1, 0, 1e9, 0, 0, 0, 0, 0]] });
  assert.equal(snap.zombies.length, MAX_ZOMBIES);
});

test('hit, death, award, hurt and board messages are clamped', () => {
  assert.deepEqual(cleanHit({ nuke: 1 }), { nuke: true });
  assert.equal(cleanHit({ i: 'x', d: 10 }), null);
  assert.equal(cleanHit({ i: 3, d: 0 }), null);
  assert.equal(cleanHit({ i: 3, d: -5 }), null);
  assert.equal(cleanHit({ i: 3, d: 1e12 }).damage, MAX_HIT_DAMAGE);
  assert.deepEqual(cleanHit(packHit(3, { damage: 98.76, head: true, cause: 'bullet' })), { id: 3, damage: 98.8, head: true, melee: false, cause: 'bullet', score: true });
  assert.equal(cleanHit(packHit(3, { damage: 10, score: false })).score, false);
  assert.equal(cleanHit({ i: 1, d: 5, c: '<script>' }).cause, 'script');
  assert.deepEqual(cleanDead({ i: 7, c: 'explosion', g: 1 }), { id: 7, cause: 'explosion', gas: true });
  assert.equal(cleanDead({}), null);
  assert.deepEqual(cleanAward({ k: 1, h: 1 }), { killed: true, head: true, melee: false });
  assert.equal(cleanHurt({ a: 1e9 }).amount, MAX_PEER_DAMAGE);
  assert.equal(cleanHurt({ a: 0 }), null);
  assert.deepEqual(cleanBoardRequest({ i: 2, n: 4 }), { index: 2, count: 4 });
  assert.equal(cleanBoardRequest({ i: -1, n: 4 }), null);
  assert.equal(cleanBoardRequest({ i: 1.5, n: 4 }), null);
});

test('PuppetTracker blends between snapshots a little in the past and reports zombies that left', () => {
  let t = 0;
  const tracker = new PuppetTracker({ now: () => t, delay: 100 });
  const snap = (seq, ...zs) => cleanSnapshot(packSnapshot({ seq, session, zombies: zs }));
  tracker.receive(snap(1, zombie(1, 0), zombie(2, 50)), 0);
  tracker.receive(snap(2, zombie(1, 100), zombie(2, 50)), 100);
  assert.ok(Math.abs(tracker.sample(1, 150).x - 50) < .2, 'halfway between the two samples');
  assert.equal(tracker.sample(1, 400).x, 100, 'holds the last known position');
  const { gone } = tracker.receive(snap(3, zombie(1, 120)), 200);
  assert.deepEqual(gone, [2]);
  assert.equal(tracker.get(2), null);
  assert.deepEqual(tracker.ids(), [1]);
  assert.deepEqual(tracker.receive(snap(1, zombie(9, 0)), 300), { gone: [] }, 'stale snapshots are ignored');
  assert.deepEqual(tracker.ids(), [1]);
});

test('PuppetTracker reports zombies that stopped being updated and wraps yaw the short way', () => {
  const tracker = new PuppetTracker({ now: () => 0, delay: 0, timeout: 1000 });
  const mk = (seq, yaw) => cleanSnapshot(packSnapshot({ seq, session, zombies: [zombie(1, 0, { root: { position: { x: 0, y: 0, z: 0 }, rotation: { y: yaw } } })] }));
  tracker.receive(mk(1, 3.1), 0);
  tracker.receive(mk(2, -3.1), 100);
  const yaw = tracker.sample(1, 50).yaw;
  assert.ok(Math.abs(Math.abs(yaw) - Math.PI) < .1, `yaw ${yaw} should go through pi, not through 0`);
  assert.deepEqual(tracker.stale(500), []);
  assert.deepEqual(tracker.stale(2000), [1]);
});

test('every new message type passes the protocol envelope', () => {
  for (const type of ['zsnap', 'zhit', 'zdead', 'award', 'hurt', 'boards', 'shot', 'box']) {
    assert.ok(MESSAGE_TYPES.has(type), type);
    assert.deepEqual(unpackMessage(packMessage(type, { a: 1 })), { type, data: { a: 1 } });
  }
});

function fakeChannel() {
  const handlers = new Map(), sent = [];
  return {
    sent, handlers,
    on(type, fn) { handlers.set(type, fn); return () => handlers.delete(type); },
    send(type, data, target) { sent.push({ type, data, target }); return Promise.resolve(); },
  };
}

test('ZombieNet throttles snapshots, addresses the host and cleans up its handlers', () => {
  const channel = fakeChannel();
  const host = new ZombieNet({ channel, role: 'host', selfId: 'h', hz: 10, now: () => 0 });
  assert.equal(host.snapshotDue(0), true);
  assert.equal(host.snapshotDue(50), false);
  assert.equal(host.snapshotDue(100), true);
  assert.equal(host.nextSeq(), 1); assert.equal(host.nextSeq(), 2);
  host.award('p2', { killed: true, head: true });
  host.hurtPeer('p3', 59.6);
  host.dead({ id: 4, gasDeath: true }, 'explosion');
  assert.deepEqual(channel.sent.map(m => [m.type, m.target]), [['award', 'p2'], ['hurt', 'p3'], ['zdead', undefined]]);
  assert.deepEqual(channel.sent[0].data, { k: 1, h: 1, m: 0 });
  assert.equal(channel.sent[1].data.a, 60);
  assert.deepEqual(channel.sent[2].data, { i: 4, c: 'explosion', g: 1 });

  const clientChannel = fakeChannel();
  const client = new ZombieNet({ channel: clientChannel, role: 'client', selfId: 'c', hostId: () => 'h', now: () => 0 });
  client.sendHit(8, { damage: 40, head: true });
  client.sendNuke();
  client.sendBoards(2, 5);
  assert.deepEqual(clientChannel.sent.map(m => [m.type, m.target]), [['zhit', 'h'], ['zhit', 'h'], ['boards', 'h']]);
  client.on('zsnap', () => {});
  assert.equal(clientChannel.handlers.size, 1);
  client.dispose();
  assert.equal(clientChannel.handlers.size, 0);

  const orphan = new ZombieNet({ channel: fakeChannel(), role: 'client', selfId: 'c', hostId: () => null });
  orphan.sendHit(1, { damage: 5 });
  assert.equal(orphan.channel.sent.length, 0, 'nothing is sent before the host is known');
});
