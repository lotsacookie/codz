import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Enemies } from '../export/web/assets/js/enemies.js';
import { ZombieNet } from '../export/web/assets/js/net/zombie-net.js';
import { attachZombieNet } from '../export/web/assets/js/net/zombie-bridge.js';
import { packSnapshot, packHit } from '../export/web/assets/js/net/zombie-sync.js';

function fakeChannel() {
  const handlers = new Map(), sent = [];
  return { sent, handlers, on(type, fn) { handlers.set(type, fn); return () => handlers.delete(type); }, send(type, data, target) { sent.push({ type, data, target }); return Promise.resolve(); } };
}

function fakeSession(extra = {}) {
  return {
    round: 3, phase: 'fighting', total: 12, spawned: 5, killed: 1, countdown: 0, dogRound: false, area: '', time: 0, points: 500, kills: 0,
    effects: {}, scored: [],
    scoreHit(killed, head, melee) { this.scored.push({ killed, head, melee }); this.points += killed ? 60 : 10; if (killed) { this.kills++; this.killed++; } },
    ...extra,
  };
}

function fakeZombie(id, x = 0, extra = {}) {
  const root = new THREE.Group();
  root.position.set(x, 0, 0);
  const played = [];
  return { id, kind: 'zombie', state: 'chase', root, health: 100, maxHealth: 100, path: [], played, rig: { current: 'walk', play: (...args) => played.push(args), update() {}, mixer: { uncacheRoot() {} } }, ...extra };
}

function hostSetup({ members = ['p2', 'p3'] } = {}) {
  const channel = fakeChannel(), session = fakeSession();
  const barriers = [{ count: 6, boards: new Array(6) }, { count: 2, boards: new Array(6) }];
  const world = { barriers, setBoards: (b, n) => { b.count = n; } };
  const enemies = new Enemies(new THREE.Scene(), world, {}, session, { damage() {}, kill() {}, hit() {} });
  enemies.update = () => {};
  let t = 0;
  const net = new ZombieNet({ channel, role: 'host', selfId: 'host', now: () => t, hz: 10 });
  const handle = attachZombieNet(enemies, { net, session, world, isMember: id => members.includes(id) });
  return { channel, session, world, enemies, net, handle, barriers, tick: ms => { t += ms; } };
}

test('host: a teammate\'s shots hurt the host zombie and the points go to the shooter, not the host', () => {
  const { channel, session, enemies } = hostSetup();
  const z = fakeZombie(1);
  enemies.list.push(z);
  const hits = [];
  enemies.onRemoteHit = zombie => hits.push(zombie.id);
  channel.handlers.get('zhit')(packHit(1, { damage: 60, head: false }), 'p2');
  assert.equal(z.health, 40);
  assert.deepEqual(hits, [1]);
  assert.deepEqual(channel.sent.at(-1), { type: 'award', data: { k: 0, h: 0, m: 0 }, target: 'p2' });
  channel.handlers.get('zhit')(packHit(1, { damage: 60, head: true, cause: 'bullet' }), 'p2');
  assert.equal(enemies.list.length, 0);
  assert.equal(enemies.dead.length, 1);
  assert.equal(z.state, 'dead');
  const types = channel.sent.map(m => m.type);
  assert.ok(types.includes('zdead'));
  assert.deepEqual(channel.sent.filter(m => m.type === 'award').at(-1).data, { k: 1, h: 1, m: 0 });
  assert.equal(session.scored.length, 0, 'the host is not paid for a teammate\'s kill');
  assert.equal(session.points, 500);
  assert.equal(session.killed, 2, 'the round still counts the kill');
  assert.equal(enemies.currentShooter, null);
});

test('host: its own shots still score the host and announce deaths to everyone', () => {
  const { channel, session, enemies } = hostSetup();
  const z = fakeZombie(7);
  enemies.list.push(z);
  enemies.hurt(z, 150, true, false, 'bullet');
  assert.deepEqual(session.scored, [{ killed: true, head: true, melee: false }]);
  assert.equal(channel.sent.filter(m => m.type === 'award').length, 0);
  const dead = channel.sent.find(m => m.type === 'zdead');
  assert.deepEqual(dead.data, { i: 7, c: 'bullet', g: 0 });
  assert.equal(dead.target, undefined);
});

test('host: hits from strangers, for unknown zombies or with bad numbers do nothing', () => {
  const { channel, enemies } = hostSetup();
  const z = fakeZombie(1);
  enemies.list.push(z);
  channel.handlers.get('zhit')(packHit(1, { damage: 50 }), 'stranger');
  channel.handlers.get('zhit')(packHit(99, { damage: 50 }), 'p2');
  channel.handlers.get('zhit')({ i: 1, d: 'lots' }, 'p2');
  channel.handlers.get('zhit')(null, 'p2');
  assert.equal(z.health, 100);
  assert.equal(channel.sent.length, 0);
});

test('host: a teammate\'s nuke kills everything and the dead are announced', () => {
  const { channel, enemies } = hostSetup();
  enemies.list.push(fakeZombie(1), fakeZombie(2));
  channel.handlers.get('zhit')({ nuke: 1 }, 'p2');
  assert.equal(enemies.list.length, 0);
  assert.equal(channel.sent.filter(m => m.type === 'zdead').length, 2);
});

test('host: snapshots carry every living zombie, the round and the boards, at the net rate', () => {
  const { channel, enemies, tick, barriers } = hostSetup();
  enemies.list.push(fakeZombie(1, 10), fakeZombie(2, 20));
  enemies.update(.016, new THREE.Vector3());
  const first = channel.sent.filter(m => m.type === 'zsnap');
  assert.equal(first.length, 1);
  assert.equal(first[0].target, undefined, 'broadcast to everyone');
  assert.equal(first[0].data.z.length, 2);
  assert.equal(first[0].data.r, 3);
  assert.deepEqual(first[0].data.b, [6, 2]);
  enemies.update(.016, new THREE.Vector3());
  assert.equal(channel.sent.filter(m => m.type === 'zsnap').length, 1, 'throttled');
  tick(100);
  barriers[0].count = 4;
  enemies.update(.016, new THREE.Vector3());
  const second = channel.sent.filter(m => m.type === 'zsnap');
  assert.equal(second.length, 2);
  assert.equal(second[1].data.q, 2);
  assert.deepEqual(second[1].data.b, [4, 2]);
});

test('host: board requests from teammates change the host barricade, never beyond its size', () => {
  const { channel, barriers } = hostSetup();
  channel.handlers.get('boards')({ i: 1, n: 4 }, 'p2');
  assert.equal(barriers[1].count, 4);
  channel.handlers.get('boards')({ i: 1, n: 200 }, 'p2');
  assert.equal(barriers[1].count, 6);
  channel.handlers.get('boards')({ i: 9, n: 1 }, 'p2');
  channel.handlers.get('boards')({ i: 0, n: 0 }, 'stranger');
  assert.equal(barriers[0].count, 6);
});

test('host: dispose restores the enemy update and stops listening', () => {
  const { channel, enemies, handle } = hostSetup();
  const wrapped = enemies.update;
  handle.dispose();
  assert.notEqual(enemies.update, wrapped);
  assert.equal(enemies.net, null);
  assert.equal(channel.handlers.size, 0);
});

function clientSetup() {
  const channel = fakeChannel(), session = fakeSession({ round: 1, phase: 'preparing', countdown: 6, total: 0, spawned: 0, killed: 0 });
  const barriers = [{ count: 6, boards: new Array(6) }, { count: 6, boards: new Array(6) }];
  const sets = [];
  const world = { barriers, setBoards(b, n) { sets.push([barriers.indexOf(b), n]); b.count = n; } };
  const damage = [], awards = [];
  const enemies = {
    world, session, list: [], dead: [], barriers: null, spawned: [], voices: 0,
    spawn(position, barrier, kind) { const z = fakeZombie(this.list.length + 1000, position.x, { kind }); session.spawned++; this.list.push(z); this.spawned.push(z); return z; },
    remove(z) { this.list.splice(this.list.indexOf(z), 1); },
    silence() {}, speak() { this.voices++; }, updateDead() {}, discardDead() {},
    update() { throw new Error('the host\'s AI must not run on a client'); },
    hurt() { throw new Error('damage must go to the host'); },
    nuke() { throw new Error('nukes must go to the host'); },
    reset() { this.list.length = 0; this.dead.length = 0; },
    onHit(z, head) { this.hitFeedback = [z.root.position.x, head]; },
  };
  let t = 0;
  const net = new ZombieNet({ channel, role: 'client', selfId: 'me', hostId: () => 'host', now: () => t });
  const handle = attachZombieNet(enemies, { net, session, world, damage: n => damage.push(n), onAward: a => awards.push(a) });
  const snap = (seq, zs, extra = {}) => channel.handlers.get('zsnap')(packSnapshot({ seq, session: { round: 5, phase: 'fighting', total: 30, spawned: 11, killed: 4, countdown: 0, dogRound: false, area: '', ...extra }, zombies: zs.map(([id, x, rest]) => fakeZombie(id, x, rest)), boards: extra.boards ?? null }), 'host');
  return { channel, session, enemies, world, barriers, sets, damage, awards, net, handle, snap, tick: ms => { t += ms; } };
}

test('client: snapshots from the host create and move puppets instead of running any zombie AI', () => {
  const { enemies, session, snap, tick } = clientSetup();
  snap(1, [[11, 0], [12, 100]]);
  tick(150);
  snap(2, [[11, 100], [12, 100]]);
  tick(100);
  enemies.update(.016);
  assert.equal(enemies.list.length, 2);
  assert.deepEqual(enemies.list.map(z => z.remoteId), [11, 12]);
  assert.equal(session.round, 5);
  assert.equal(session.phase, 'fighting');
  assert.equal(session.total, 30);
  assert.equal(session.spawned, 11, 'puppets do not add to the round count');
  const moving = enemies.list.find(z => z.remoteId === 11);
  assert.ok(moving.root.position.x > 0 && moving.root.position.x <= 100, `x ${moving.root.position.x}`);
});

test('client: puppets play the attack and walk animations the host reports and vanish when the host drops them', () => {
  const { enemies, snap, tick } = clientSetup();
  snap(1, [[21, 0]]);
  enemies.update(.016);
  const z = enemies.list[0];
  tick(50);
  snap(2, [[21, 0, { state: 'attack' }]]);
  enemies.update(.016);
  assert.equal(z.state, 'attack');
  assert.equal(z.played.at(-1)[0], 'attack');
  tick(50);
  snap(3, [[21, 0, { state: 'barricade' }]]);
  enemies.update(.016);
  assert.deepEqual(z.played.at(-1).slice(0, 2), ['attack', true]);
  tick(50);
  snap(4, [[21, 0, { state: 'chase' }]]);
  enemies.update(.016);
  assert.equal(z.played.at(-1)[0], 'walk');
  tick(50);
  snap(5, []);
  assert.equal(enemies.list.length, 0);
});

test('client: a death event turns the puppet into a corpse once, with the host\'s cause', () => {
  const { enemies, channel, snap } = clientSetup();
  const kills = [];
  enemies.onPuppetKill = z => kills.push(z.remoteId);
  snap(1, [[31, 0]]);
  enemies.update(.016);
  channel.handlers.get('zdead')({ i: 31, c: 'explosion', g: 1 }, 'host');
  assert.equal(enemies.list.length, 0);
  assert.equal(enemies.dead.length, 1);
  assert.equal(enemies.dead[0].state, 'dead');
  assert.equal(enemies.dead[0].gasDeath, true);
  assert.deepEqual(enemies.dead[0].played.at(-1), ['death', false]);
  assert.deepEqual(kills, [31]);
  channel.handlers.get('zdead')({ i: 31, c: 'bullet' }, 'host');
  assert.equal(enemies.dead.length, 1);
  snap(2, []);
  assert.equal(enemies.dead.length, 1, 'the corpse is not removed by the next snapshot');
});

test('client: shooting a puppet sends the hit to the host and changes nothing locally', () => {
  const { enemies, channel, snap } = clientSetup();
  snap(1, [[41, 55]]);
  enemies.update(.016);
  const z = enemies.list[0];
  enemies.hurt(z, 80, true, false, 'bullet', true);
  assert.deepEqual(enemies.hitFeedback, [55, true], 'the shooter still gets a hit marker straight away');
  assert.equal(z.health, 100);
  assert.equal(enemies.list.length, 1);
  assert.deepEqual(channel.sent.at(-1), { type: 'zhit', data: { i: 41, d: 80, h: 1, m: 0, c: 'bullet', s: 1 }, target: 'host' });
  enemies.nuke(() => {});
  assert.deepEqual(channel.sent.at(-1).data, { nuke: 1 });
});

test('client: the host decides points and damage, and nobody else can', () => {
  const { session, channel, damage, awards } = clientSetup();
  channel.handlers.get('award')({ k: 1, h: 1, m: 0 }, 'host');
  channel.handlers.get('award')({ k: 0 }, 'host');
  assert.deepEqual(session.scored, [{ killed: true, head: true, melee: false }, { killed: false, head: false, melee: false }]);
  assert.equal(awards.length, 2);
  channel.handlers.get('hurt')({ a: 45 }, 'host');
  assert.deepEqual(damage, [45]);
  channel.handlers.get('award')({ k: 1 }, 'someone-else');
  channel.handlers.get('hurt')({ a: 45 }, 'someone-else');
  channel.handlers.get('zsnap')(packSnapshot({ seq: 1, session, zombies: [fakeZombie(1)] }), 'someone-else');
  channel.handlers.get('zdead')({ i: 1 }, 'someone-else');
  assert.equal(session.scored.length, 2);
  assert.deepEqual(damage, [45]);
});

test('client: a player who is downed or in another area does not get the host\'s round state or zombies', () => {
  const { enemies, session, snap } = clientSetup();
  session.phase = 'gameover';
  snap(1, [[51, 0]]);
  enemies.update(.016);
  assert.equal(session.phase, 'gameover', 'a downed player stays downed');
  assert.equal(session.round, 5);
  const moon = clientSetup();
  moon.session.area = 'moon';
  moon.snap(1, [[52, 0]], { area: 'earth' });
  moon.enemies.update(.016);
  assert.equal(moon.enemies.list.length, 0);
  assert.equal(moon.session.round, 1, 'round state from a different area is ignored');
});

test('client: barricade boards follow the host and local repairs are requested from the host', () => {
  const { enemies, snap, world, barriers, sets, channel } = clientSetup();
  snap(1, [], { boards: [2, 6] });
  enemies.update(.016);
  assert.deepEqual(sets, [[0, 2]]);
  assert.equal(barriers[0].count, 2);
  world.setBoards(barriers[0], 3, true);
  assert.equal(barriers[0].count, 2, 'not applied until the host says so');
  assert.deepEqual(channel.sent.at(-1), { type: 'boards', data: { i: 0, n: 3 }, target: 'host' });
  snap(2, [], { boards: [3, 6] });
  enemies.update(.016);
  assert.equal(barriers[0].count, 3);
});

test('client: resetting clears every puppet and dispose gives the enemies back', () => {
  const { enemies, snap, handle, channel, world } = clientSetup();
  const rawSetBoards = world.setBoards;
  snap(1, [[61, 0], [62, 0]]);
  enemies.update(.016);
  assert.equal(enemies.list.length, 2);
  enemies.reset();
  assert.equal(enemies.list.length, 0);
  enemies.update(.016);
  assert.equal(enemies.list.length, 0, 'forgotten until the host sends them again');
  handle.dispose();
  assert.throws(() => enemies.update(), /AI must not run/);
  assert.equal(channel.handlers.size, 0);
  assert.notEqual(world.setBoards, undefined);
  assert.ok(rawSetBoards);
});

test('client: puppets that stop updating are removed', () => {
  const { enemies, snap, tick } = clientSetup();
  snap(1, [[71, 0]]);
  enemies.update(.016);
  assert.equal(enemies.list.length, 1);
  tick(10000);
  enemies.update(.016);
  assert.equal(enemies.list.length, 0);
});
