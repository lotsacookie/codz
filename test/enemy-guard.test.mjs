import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { guardEnemies, brokenZombie } from '../export/web/enemy-guard.js';

const zombie = (x = 0, state = 'chase') => ({ root: new THREE.Group(), rig: {}, state, position: x });
function fake() {
  const scene = new THREE.Scene(), session = { spawned: 0 };
  const e = {
    scene, session, list: [], templates: [{}], heads: [], spawns: 0,
    spawn() { if (e.explode) { const g = new THREE.Group(); g.name = 'zombie_9'; scene.add(g); throw new TypeError('clone failed'); } const z = zombie(); e.list.push(z); session.spawned++; return z; },
    update() { if (e.updateFault) throw new Error(e.updateFault); },
    remove(z) { e.list.splice(e.list.indexOf(z), 1); },
  };
  return e;
}

test('a spawn that throws is contained: no zombie, no leaked model, no round count', () => {
  const e = guardEnemies(fake());
  e.explode = true;
  assert.equal(e.spawn(null, {}, 'zombie'), null);
  assert.equal(e.scene.children.length, 0);
  assert.equal(e.session.spawned, 0);
  assert.equal(e.guardState.spawnFaults, 1);
});

test('an update that throws does not escape, and a repeating fault drops the offenders and fixes the round count', () => {
  const e = guardEnemies(fake());
  e.spawn(); e.spawn();
  assert.equal(e.session.spawned, 2);
  e.updateFault = 'boom';
  for (let i = 0; i < 3; i++) assert.doesNotThrow(() => e.update(.016, new THREE.Vector3()));
  assert.equal(e.list.length, 0);
  assert.equal(e.session.spawned, 0);
  e.updateFault = null;
  e.update(.016, new THREE.Vector3());
  assert.equal(e.guardState.repeats, 0);
});

test('zombies with non-finite positions are purged before they can poison an update', () => {
  const e = guardEnemies(fake());
  const z = e.spawn(); z.root.position.x = NaN;
  assert.equal(brokenZombie(z), true);
  e.update(.016, new THREE.Vector3());
  assert.equal(e.list.length, 0);
});

test('guarding twice does not stack wrappers', () => {
  const e = fake(), once = guardEnemies(e), update = once.update;
  assert.equal(guardEnemies(once).update, update);
});
