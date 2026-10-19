import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RemoteAvatars } from '../export/web/net/avatars.js';
import { createCoop } from '../export/web/net/coop-client.js';
import { PLAYER_COLORS, coopHealth } from '../export/web/net/coop.js';

const roster = [{ id: 'me', name: 'Me' }, { id: 'p2', name: 'Bo' }, { id: 'p3', name: 'Cy' }];
const sample = (id, x, hp = 1) => ({ id, name: id, x, y: 0, z: 0, yaw: 0, pitch: 0, hp });

test('other players become diamonds that follow their pose, turn grey when downed and vanish when they leave', () => {
  const scene = new THREE.Scene(), avatars = new RemoteAvatars(scene);
  avatars.sync([sample('p2', 100), sample('p3', 200)], roster);
  assert.equal(scene.children.length, 2);
  const bo = scene.getObjectByName('remote_player_p2'), body = bo.userData.body;
  assert.equal(body.geometry.type, 'OctahedronGeometry');
  assert.equal(body.material.color.getHexString(), new THREE.Color(PLAYER_COLORS[1]).getHexString());
  assert.equal(bo.position.x, 100);
  avatars.sync([{ ...sample('p2', 150), yaw: 1, hp: 0 }, sample('p3', 200)], roster);
  assert.equal(bo.position.x, 150); assert.equal(bo.rotation.y, 1);
  assert.notEqual(body.material.color.getHexString(), new THREE.Color(PLAYER_COLORS[1]).getHexString());
  avatars.sync([sample('p3', 200)], roster);
  assert.equal(scene.getObjectByName('remote_player_p2'), undefined);
  avatars.dispose();
  assert.equal(scene.children.length, 0);
});

function fakeLobby() {
  const handlers = new Map(), sent = [];
  const game = { on: (type, fn) => { handlers.set(type, fn); return () => handlers.delete(type); }, send: (type, data) => { sent.push({ type, data }); return Promise.resolve(); } };
  return { lobby: { game, players: () => roster, onChange() {} }, handlers, sent };
}

test('co-op client sends our pose and points, exposes living teammates as zombie targets and stays out of single player', () => {
  assert.equal(createCoop({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), feet: () => new THREE.Vector3(), points: () => 500, config: null }), null);

  let t = 0, points = 500;
  const { lobby, handlers, sent } = fakeLobby(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const coop = createCoop({ scene, camera, feet: () => new THREE.Vector3(1, 2, 3), points: () => points, config: { lobby, selfId: 'me', roster }, now: () => t, doc: null });
  // PoseSender and RemotePlayers use performance.now by default, so just feed poses and sample straight away.
  handlers.get('pose')({ x: 400, y: 0, z: 0, yaw: 0, pitch: 0, hp: 1 }, 'p2');
  handlers.get('pose')({ x: 900, y: 0, z: 0, yaw: 0, pitch: 0, hp: 0 }, 'p3');
  coop.update();
  assert.ok(sent.some(m => m.type === 'pose' && m.data.x === 1 && m.data.z === 3));
  const targets = coop.targets();
  assert.equal(targets.length, 1, 'the downed teammate is not chased');
  assert.ok(targets[0] instanceof THREE.Vector3);
  assert.equal(scene.children.length, 2, 'both teammates are drawn');

  points = 560; t = 10;
  coop.update();
  assert.deepEqual(sent.filter(m => m.type === 'state').at(-1).data, { score: { points: 560, delta: 60 } });
  handlers.get('state')({ score: { points: 700, delta: 200 } }, 'p2');
  assert.equal(coop.scores().find(p => p.id === 'p2').points, 700);
  coop.dispose();
  assert.equal(handlers.size, 0);
  assert.equal(scene.children.length, 0);
});

test('coopHealth is zero while downed so teammates are not chased', () => {
  assert.equal(coopHealth({ phase: 'fighting', health: 50, maxHealth: 100 }), .5);
  assert.equal(coopHealth({ phase: 'reviving', health: 100, maxHealth: 100 }), 0);
  assert.equal(coopHealth({ phase: 'gameover', health: 0, maxHealth: 100 }), 0);
  assert.equal(coopHealth(null), 0);
});
