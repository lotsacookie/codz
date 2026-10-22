import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { boardOutward, planBoardChips, spawnBoardChips, boardLandingShake, boardLanded } from '../export/web/board-chips.js';
import { readFileSync } from 'node:fs';

const seeded = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test('outward direction points from the inside of a window to the outside', () => {
  const barrier = { inside: new THREE.Vector3(0, 40, 0), outside: new THREE.Vector3(30, 55, 0) };
  const out = boardOutward(barrier);
  assert.ok(Math.abs(out.x - 1) < 1e-6 && out.y === 0 && out.z === 0);
  const fallback = boardOutward({});
  assert.ok(Math.abs(fallback.length() - 1) < 1e-6);
});

test('board chips burst upward and mostly outward from the board', () => {
  const out = new THREE.Vector3(1, 0, 0);
  const origin = new THREE.Vector3(100, 60, 20);
  const chips = planBoardChips(origin, out, seeded(7), 40);
  assert.equal(chips.length, 40);
  let outward = 0;
  for (const chip of chips) {
    assert.ok(chip.velocity.y > 20, 'every chip is thrown up');
    assert.ok(chip.life > 0.4 && chip.life < 1);
    assert.ok(chip.position.distanceTo(origin) < 30, 'starts on the board');
    if (chip.velocity.dot(out) > 0) outward++;
  }
  assert.ok(outward > 20, 'most chips fly out of the window');
});

test('spawned chips are particles the map loops can fade and clean up', () => {
  const added = [];
  const scene = { add: object => added.push(object) };
  const particles = [];
  const chips = spawnBoardChips(scene, particles, new THREE.Vector3(), new THREE.Vector3(0, 0, 1), seeded(3));
  assert.equal(added.length, chips.length);
  assert.equal(particles.length, chips.length);
  for (const p of particles) {
    assert.ok(p.mesh.geometry && p.mesh.material && p.velocity && p.life > 0 && p.fade > 0);
  }
});

test('landing shake only fires near the player and not on every board at once', () => {
  const state = {};
  let shakes = 0;
  const shake = () => shakes++;
  const board = new THREE.Vector3(0, 0, 0);
  assert.equal(boardLandingShake(state, 1, board, new THREE.Vector3(100, 0, 0), shake), true);
  assert.equal(boardLandingShake(state, 1.05, board, new THREE.Vector3(100, 0, 0), shake), false, 'a second board in the same instant');
  assert.equal(boardLandingShake(state, 1.5, board, new THREE.Vector3(100, 0, 0), shake), true);
  assert.equal(boardLandingShake(state, 5, board, new THREE.Vector3(2000, 0, 0), shake), false, 'too far away to feel');
  assert.equal(boardLandingShake(state, 6, board, null, shake), false);
  assert.equal(shakes, 2);
});

test('boardLanded throws chips and shakes the camera', () => {
  const board = new THREE.Object3D();
  board.position.set(10, 50, 0);
  board.updateMatrixWorld(true);
  const scene = { add() {} };
  const particles = [];
  let shaken = 0;
  boardLanded(board, { inside: new THREE.Vector3(), outside: new THREE.Vector3(0, 0, 5) }, scene, particles, { position: new THREE.Vector3(0, 50, 0) }, {}, 2, () => shaken++);
  assert.ok(particles.length > 0);
  assert.equal(shaken, 1);
});

test('board landing is wired into every map that animates window boards', () => {
  const read = file => readFileSync(new URL(`../export/web/${file}`, import.meta.url), 'utf8');
  assert.match(read('world.js'), /if\(fx\.entering\)this\.onBoardLand\?\.\(o,fx\.barrier\)/);
  assert.match(read('world.js'), /push\(\{o,barrier,entering/);
  assert.match(read('maps/kino.js'), /world\.onBoardLand=\(o,barrier\)=>boardLanded\(/);
  assert.doesNotMatch(read('maps/kino.js'), /setBoards\(b,b\.count\+1,true\);view\.cameraFx\?\.build\(\)/, 'the shake now comes from the board landing');
  assert.match(read('shangri-la-features.js'), /if \(fx\.entering\) boardLanded\(/);
});
