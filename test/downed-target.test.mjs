import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Enemies } from '../export/web/assets/js/enemies.js';

function fakeZombie(id) {
  const root = new THREE.Group();
  root.position.set(0, 0, 0);
  return { id, kind: 'zombie', state: 'chase', root, health: 100, path: [], pathIndex: 0, repath: 0, growl: 99, stuck: 0, lastPosition: root.position.clone(), speed: 40, heading: null, attackLeft: 0, rig: { update() {}, play() {}, mixer: {} } };
}

function setup(sessionExtra, remotes) {
  const goals = [], spawnProbes = [];
  const session = { phase: 'fighting', corePhase: 'fighting', total: 99, spawned: 5, round: 1, time: 0, dogRound: false, random: Math.random, power: false, spectating: false, ...sessionExtra };
  const world = {
    path: (from, to) => { goals.push(to.clone()); return []; },
    lineClear: () => false,
    closest: () => null,
    spawnBarriers: () => [{ inside: new THREE.Vector3(0, 0, 0), outside: new THREE.Vector3(0, 0, 0) }],
    zoneAt: () => '',
  };
  const enemies = new Enemies(new THREE.Scene(), world, { rules: {} }, session, { damage() {}, kill() {}, hit() {} });
  enemies.autoSpawn = false;
  enemies.autoRounds = false;
  enemies.remoteTargets = () => remotes;
  enemies.list.push(fakeZombie(1));
  return { enemies, goals, spawnProbes, session, world };
}

const host = new THREE.Vector3(10, 0, 0);
const teammate = new THREE.Vector3(900, 0, 0);

test('a healthy host is still chased when he is the closest player', () => {
  const { enemies, goals } = setup({}, [teammate]);
  enemies.update(.016, host);
  assert.equal(goals.at(-1).x, 10);
});

test('a spectating host is ignored and zombies go for the living teammate', () => {
  const { enemies, goals } = setup({ spectating: true }, [teammate]);
  enemies.update(.016, host);
  assert.equal(goals.at(-1).x, 900);
});

test('a host in quick revive is ignored while a teammate is alive', () => {
  const { enemies, goals } = setup({ phase: 'reviving' }, [teammate]);
  enemies.update(.016, host);
  assert.equal(goals.at(-1).x, 900);
});

test('with nobody else alive the zombies keep to the local player', () => {
  const { enemies, goals } = setup({ spectating: true }, []);
  enemies.update(.016, host);
  assert.equal(goals.at(-1).x, 10);
});

test('new zombies spawn near a living teammate, not the downed host', () => {
  const { enemies, world } = setup({ spectating: true }, [teammate]);
  enemies.autoSpawn = true;
  enemies.nextSpawn = 0;
  const probed = [];
  world.path = (from, to) => { probed.push(to.x); return []; };
  enemies.update(.016, host);
  assert.ok(probed.length > 0);
  assert.equal(probed[0], 900);
});
