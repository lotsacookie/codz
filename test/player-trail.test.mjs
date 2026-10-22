import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerTrail } from '../export/web/assets/js/player-trail.js';

const v = (x, y = 0, z = 0) => new THREE.Vector3(x, y, z);

test('trail records spaced crumbs and resets on teleport', () => {
  const t = new PlayerTrail({ spacing: 50, jump: 300 });
  for (let x = 0; x <= 200; x += 10) t.record(v(x));
  assert.equal(t.points.length, 5);
  t.record(v(5000));
  assert.equal(t.points.length, 1);
});

test('route follows crumbs toward the player and never without line of sight', () => {
  const t = new PlayerTrail({ spacing: 50 });
  for (let x = 0; x <= 300; x += 50) t.record(v(x));
  const goal = v(300);
  const route = t.route(v(0, 0, 20), goal, () => true);
  assert.ok(route.length >= 2);
  assert.equal(route.at(-1).x, 300);
  assert.deepEqual(t.route(v(0, 0, 20), goal, () => false), []);
});
