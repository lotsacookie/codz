import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Powerups } from '../export/web/assets/js/powerups.js';
import { MESSAGE_TYPES, packMessage, unpackMessage } from '../export/web/assets/js/net/protocol.js';
import { cleanDrop, cleanGrab, cleanTake, packDrop, packGrab, packTake } from '../export/web/assets/js/net/powerup-sync.js';

const TYPES = ['nuke', 'insta_kill', 'double_points', 'full_ammo', 'carpenter', 'fire_sale'];

function makePowerups({ role = null, selfId = 'me', hostId = 'host', area = '' } = {}) {
  const sent = [], collected = [];
  const powerups = new Powerups(new THREE.Scene(), { powerups: {} }, { event() {} }, (type, position, info) => collected.push({ type, position, info }));
  for (const type of TYPES) powerups.templates[type] = new THREE.Group();
  if (role) powerups.attachNet({ selfId, role, hostId: () => hostId, area: () => area, send: (type, data, target) => sent.push({ type, data, target }) });
  return { powerups, sent, collected };
}

const standOn = (powerups, item) => powerups.update(.016, item.root.position.clone(), true, () => true);

test('power-up messages pass the protocol envelope', () => {
  for (const type of ['pdrop', 'ptake', 'pgrab']) {
    assert.ok(MESSAGE_TYPES.has(type), type);
    assert.deepEqual(unpackMessage(packMessage(type, { i: 1 })), { type, data: { i: 1 } });
  }
});

test('drop, take and grab messages round trip and reject bad data', () => {
  const position = { x: 10.123, y: -4, z: 300 };
  assert.deepEqual(cleanDrop(packDrop({ id: 5, type: 'nuke', position, area: 'moon' })), { id: 5, type: 'nuke', position: { x: 10.1, y: -4, z: 300 }, area: 'moon' });
  assert.deepEqual(cleanTake(packTake(9)), { id: 9 });
  assert.deepEqual(cleanGrab(packGrab({ id: 2, type: 'full_ammo', position, by: 'peer-1' })), { id: 2, type: 'full_ammo', position: { x: 10.1, y: -4, z: 300 }, by: 'peer-1' });
  assert.equal(cleanDrop({ i: 1, t: 'free_points', x: 0, y: 0, z: 0 }), null);
  assert.equal(cleanDrop({ i: 1, t: 'nuke', x: 'far', y: 0, z: 0 }), null);
  assert.equal(cleanDrop({ i: 1, t: 'nuke', x: 1e9, y: 0, z: 0 }), null);
  assert.equal(cleanDrop({ i: -1, t: 'nuke', x: 0, y: 0, z: 0 }), null);
  assert.equal(cleanDrop(null), null);
  assert.equal(cleanTake({ i: 'x' }), null);
  assert.equal(cleanGrab({ i: 1, t: 'nuke', x: 0, y: 0 }), null);
});

test('single player: a power-up is collected locally with nothing sent', () => {
  const { powerups, collected } = makePowerups();
  const item = powerups.spawn('full_ammo', new THREE.Vector3(5, 0, 5));
  standOn(powerups, item);
  assert.equal(powerups.items.length, 0);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].type, 'full_ammo');
  assert.equal(collected[0].info, undefined);
});

test('host: a drop is announced to everyone with the same position and a unique id', () => {
  const { powerups, sent } = makePowerups({ role: 'host', selfId: 'host', hostId: 'host' });
  const a = powerups.spawn('nuke', new THREE.Vector3(1, 2, 3));
  const b = powerups.spawn('insta_kill', new THREE.Vector3(4, 5, 6));
  assert.notEqual(a.id, b.id);
  assert.deepEqual(sent[0], { type: 'pdrop', data: { i: a.id, t: 'nuke', x: 1, y: 2, z: 3, a: '' }, target: undefined });
  assert.equal(sent.length, 2);
  assert.equal(a.root.position.y, 42);
});

test('client: drops come from the host only, are placed identically, and local drops are ignored', () => {
  const { powerups, sent } = makePowerups({ role: 'client', selfId: 'me', hostId: 'host' });
  assert.equal(powerups.spawn('nuke', new THREE.Vector3()), null);
  assert.equal(sent.length, 0);
  const drop = packDrop({ id: 7, type: 'double_points', position: { x: 1, y: 2, z: 3 } });
  assert.equal(powerups.receiveNet('pdrop', 'stranger', drop), false);
  assert.equal(powerups.items.length, 0);
  assert.equal(powerups.receiveNet('pdrop', 'host', drop), true);
  assert.equal(powerups.items.length, 1);
  assert.equal(powerups.items[0].id, 7);
  assert.deepEqual(powerups.items[0].root.position.toArray(), [1, 42, 3]);
  assert.equal(powerups.receiveNet('pdrop', 'host', drop), false, 'a repeated id is not spawned twice');
  assert.equal(powerups.items.length, 1);
  assert.equal(sent.length, 0, 'a client never re-broadcasts a drop');
});

test('client: drops from another area are not shown', () => {
  const { powerups } = makePowerups({ role: 'client', area: 'earth' });
  assert.equal(powerups.receiveNet('pdrop', 'host', packDrop({ id: 1, type: 'nuke', position: { x: 0, y: 0, z: 0 }, area: 'moon' })), false);
  assert.equal(powerups.items.length, 0);
  assert.equal(powerups.receiveNet('pdrop', 'host', packDrop({ id: 1, type: 'nuke', position: { x: 0, y: 0, z: 0 }, area: 'earth' })), true);
});

test('client: walking over a power-up asks the host and waits for the host to confirm', () => {
  const { powerups, sent, collected } = makePowerups({ role: 'client' });
  powerups.receiveNet('pdrop', 'host', packDrop({ id: 3, type: 'full_ammo', position: { x: 0, y: 0, z: 0 } }));
  const item = powerups.items[0];
  standOn(powerups, item);
  standOn(powerups, item);
  assert.deepEqual(sent, [{ type: 'ptake', data: { i: 3 }, target: 'host' }], 'asked once, not every frame');
  assert.equal(powerups.items.length, 1, 'still on the ground until the host confirms');
  assert.equal(collected.length, 0);
  powerups.receiveNet('pgrab', 'host', packGrab({ id: 3, type: 'full_ammo', position: item.root.position, by: 'me' }));
  assert.equal(powerups.items.length, 0);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].info.host, false);
  assert.equal(collected[0].info.mine, true);
});

test('client: a teammate\'s grab removes the pickup and applies the effect to us too', () => {
  const { powerups, collected } = makePowerups({ role: 'client', selfId: 'me' });
  powerups.receiveNet('pdrop', 'host', packDrop({ id: 4, type: 'insta_kill', position: { x: 9, y: 0, z: 9 } }));
  assert.equal(powerups.receiveNet('pgrab', 'stranger', packGrab({ id: 4, type: 'insta_kill', position: { x: 9, y: 40, z: 9 }, by: 'p2' })), false);
  assert.equal(powerups.items.length, 1);
  assert.equal(powerups.receiveNet('pgrab', 'host', packGrab({ id: 4, type: 'insta_kill', position: { x: 9, y: 40, z: 9 }, by: 'p2' })), true);
  assert.equal(powerups.items.length, 0);
  assert.equal(collected.length, 1);
  assert.deepEqual({ type: collected[0].type, by: collected[0].info.by, mine: collected[0].info.mine, host: collected[0].info.host }, { type: 'insta_kill', by: 'p2', mine: false, host: false });
});

test('client: the effect still applies when the pickup had already expired locally', () => {
  const { powerups, collected } = makePowerups({ role: 'client' });
  powerups.receiveNet('pgrab', 'host', packGrab({ id: 99, type: 'nuke', position: { x: 0, y: 0, z: 0 }, by: 'p2' }));
  assert.equal(collected.length, 1);
  assert.equal(collected[0].type, 'nuke');
});

test('host: walking over its own power-up tells everyone and applies it with authority', () => {
  const { powerups, sent, collected } = makePowerups({ role: 'host', selfId: 'host', hostId: 'host' });
  const item = powerups.spawn('nuke', new THREE.Vector3());
  sent.length = 0;
  standOn(powerups, item);
  assert.equal(powerups.items.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'pgrab');
  assert.equal(sent[0].target, undefined, 'broadcast to everyone');
  assert.equal(sent[0].data.b, 'host');
  assert.equal(collected.length, 1);
  assert.deepEqual({ by: collected[0].info.by, mine: collected[0].info.mine, host: collected[0].info.host }, { by: 'host', mine: true, host: true });
});

test('host: a teammate\'s request is granted once, announced to all, and applied on the host', () => {
  const { powerups, sent, collected } = makePowerups({ role: 'host', selfId: 'host', hostId: 'host' });
  const item = powerups.spawn('full_ammo', new THREE.Vector3(2, 0, 2));
  sent.length = 0;
  assert.equal(powerups.receiveNet('ptake', 'p2', packTake(item.id)), true);
  assert.equal(powerups.items.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.b, 'p2');
  assert.equal(collected.length, 1);
  assert.deepEqual({ by: collected[0].info.by, mine: collected[0].info.mine, host: collected[0].info.host }, { by: 'p2', mine: false, host: true });
  assert.equal(powerups.receiveNet('ptake', 'p3', packTake(item.id)), false, 'someone else cannot take it twice');
  assert.equal(powerups.receiveNet('ptake', 'p3', { i: 'bad' }), false);
  assert.equal(sent.length, 1);
  assert.equal(collected.length, 1);
});

test('a client never grants requests and detaching the network returns to local play', () => {
  const { powerups, collected } = makePowerups({ role: 'client' });
  powerups.receiveNet('pdrop', 'host', packDrop({ id: 1, type: 'carpenter', position: { x: 0, y: 0, z: 0 } }));
  assert.equal(powerups.receiveNet('ptake', 'p2', packTake(1)), false);
  assert.equal(powerups.items.length, 1);
  powerups.attachNet(null);
  assert.equal(powerups.receiveNet('pdrop', 'host', packDrop({ id: 2, type: 'nuke', position: { x: 0, y: 0, z: 0 } })), false);
  standOn(powerups, powerups.items[0]);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].info, undefined);
});
