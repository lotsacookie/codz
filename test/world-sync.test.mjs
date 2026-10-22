import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldSync, cleanUnlock, packUnlock } from '../export/web/net/world-sync.js';
import { packMessage, unpackMessage } from '../export/web/net/protocol.js';
import { createCoop } from '../export/web/net/coop-client.js';

const roster = [{ id: 'me', name: 'Me' }, { id: 'p2', name: 'Bo' }];

test('unlock messages are packed and cleaned, and junk is dropped', () => {
  assert.deepEqual(packUnlock('door', 'auto2'), { k: 'd', n: 'auto2' });
  assert.deepEqual(packUnlock('wall', 1234), { k: 'w', n: '1234' });
  assert.equal(packUnlock('door', '<>'), null);
  assert.deepEqual(cleanUnlock({ k: 'd', n: 'auto2' }), { kind: 'door', key: 'auto2' });
  assert.deepEqual(cleanUnlock({ k: 'w', n: '77' }), { kind: 'wall', key: '77' });
  assert.equal(cleanUnlock({ k: 'x', n: 'a' }), null);
  assert.equal(cleanUnlock({ k: 'd', n: '' }), null);
  assert.equal(cleanUnlock(null), null);
  assert.equal(cleanUnlock('door'), null);
  assert.equal(cleanUnlock({ k: 'd', n: 'a'.repeat(200) }).key.length, 64);
  assert.deepEqual(unpackMessage(packMessage('unlock', { k: 'd', n: 'a' })), { type: 'unlock', data: { k: 'd', n: 'a' } });
});

test('a purchase is sent once and a teammate\'s purchase is applied once without echoing back', () => {
  const sent = [], doors = [], walls = [];
  const sync = new WorldSync({ send: m => sent.push(m), applyDoor: (k, from) => doors.push([k, from]), applyWall: (k, from) => walls.push([k, from]) });

  assert.equal(sync.door('auto2'), true);
  assert.equal(sync.door('auto2'), false);
  assert.equal(sync.wall(55), true);
  assert.equal(sync.wall(55), false);
  assert.deepEqual(sent, [{ k: 'd', n: 'auto2' }, { k: 'w', n: '55' }]);

  assert.equal(sync.receive({ k: 'd', n: 'auto2' }, 'p2'), false, 'already open here');
  assert.equal(sync.receive({ k: 'd', n: 'lobby_door' }, 'p2'), true);
  assert.equal(sync.receive({ k: 'd', n: 'lobby_door' }, 'p2'), false);
  assert.equal(sync.receive({ k: 'w', n: '90' }, 'p2'), true);
  assert.equal(sync.receive({ nope: 1 }, 'p2'), false);
  assert.deepEqual(doors, [['lobby_door', 'p2']]);
  assert.deepEqual(walls, [['90', 'p2']]);
  assert.equal(sent.length, 2, 'applying a remote unlock never re-broadcasts it');

  sync.reset();
  assert.equal(sync.door('auto2'), true);
  assert.equal(sent.length, 3);
});

test('a throwing apply callback does not break the sync', () => {
  const sync = new WorldSync({ applyDoor() { throw new Error('boom'); } });
  assert.equal(sync.receive({ k: 'd', n: 'a' }, 'p2'), true);
  assert.equal(sync.receive({ k: 'd', n: 'a' }, 'p2'), false);
});

function fakeLobby() {
  const handlers = new Map(), sent = [];
  const game = { on: (type, fn) => { handlers.set(type, fn); return () => handlers.delete(type); }, send: (type, data) => { sent.push({ type, data }); return Promise.resolve(); } };
  return { lobby: { game, players: () => roster, onChange() {} }, handlers, sent };
}

test('co-op world handle broadcasts our unlocks and applies only roster teammates\' ones', () => {
  const { lobby, handlers, sent } = fakeLobby();
  const coop = createCoop({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), feet: () => new THREE.Vector3(), points: () => 500, config: { lobby, selfId: 'me', roster }, doc: null });
  const doors = [], walls = [];
  const handle = coop.attachWorld({ applyDoor: (k, who) => doors.push([k, who]), applyWall: (k, who) => walls.push([k, who]) });
  assert.equal(coop.attachWorld({}), handle, 'attaching twice returns the same handle');
  assert.equal(coop.world(), handle);

  handle.door('auto2');
  handle.wall('12');
  assert.deepEqual(sent.filter(m => m.type === 'unlock' && m.data.k !== 'r').map(m => m.data), [{ k: 'd', n: 'auto2' }, { k: 'w', n: '12' }]);

  handlers.get('unlock')({ k: 'd', n: 'lobby_door' }, 'p2');
  handlers.get('unlock')({ k: 'w', n: '99' }, 'p2');
  handlers.get('unlock')({ k: 'd', n: 'sneaky' }, 'stranger');
  handlers.get('unlock')({ k: 'd', n: 'mine' }, 'me');
  assert.deepEqual(doors, [['lobby_door', 'Bo']]);
  assert.deepEqual(walls, [['99', 'Bo']]);

  handle.reset();
  handlers.get('unlock')({ k: 'd', n: 'lobby_door' }, 'p2');
  assert.equal(doors.length, 2, 'after a reset the same door can be opened again');

  coop.dispose();
  assert.equal(handlers.has('unlock'), false);
  assert.equal(coop.world(), null);
});

test('the host replays everything bought so far to a teammate who asks, and only the host answers', () => {
  const sent = [];
  const host = new WorldSync({ send: (m, target) => sent.push([m, target]) });
  host.door('auto2');
  host.wall(55);
  host.wall(56);
  sent.length = 0;
  assert.equal(host.receive({ k: 'r' }, 'p2'), false);
  assert.deepEqual(sent, [[{ k: 'd', n: 'auto2' }, 'p2'], [{ k: 'w', n: '55' }, 'p2'], [{ k: 'w', n: '56' }, 'p2']]);

  const walls = [];
  const guest = new WorldSync({ applyWall: k => walls.push(k) });
  for (const [m] of sent) guest.receive(m, 'host');
  assert.deepEqual(walls, ['55', '56'], 'the guest ends up with the same wall buys as the host');
  assert.deepEqual(cleanUnlock({ k: 'r' }), { kind: 'request' });
});

test('a guest asks the host for the current wall buys when it attaches the world', () => {
  const { lobby, handlers, sent } = fakeLobby();
  const coop = createCoop({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), feet: () => new THREE.Vector3(), points: () => 500, config: { lobby, selfId: 'p2', role: 'client', roster }, doc: null });
  const walls = [];
  coop.attachWorld({ applyWall: k => walls.push(k) });
  assert.deepEqual(sent.filter(m => m.type === 'unlock').map(m => m.data), [{ k: 'r' }]);
  handlers.get('unlock')({ k: 'r' }, 'me');
  assert.deepEqual(sent.filter(m => m.type === 'unlock').length, 1, 'guests never answer requests');
  handlers.get('unlock')({ k: 'w', n: '7' }, 'me');
  assert.deepEqual(walls, ['7']);
  coop.dispose();
});
