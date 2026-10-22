import test from 'node:test';
import assert from 'node:assert/strict';
import { hitBearing, nearestAttacker, HitDirections } from '../export/web/assets/js/hit-direction.js';

const zombie = (x, z, state = 'chase') => ({ state, root: { position: { x, y: 0, z } } });

test('nearestAttacker picks the closest living enemy in range', () => {
  const near = zombie(60, 0), far = zombie(120, 0), dead = zombie(10, 0, 'dead');
  assert.equal(nearestAttacker({ x: 0, z: 0 }, [far, dead, near]), near.root.position);
  assert.equal(nearestAttacker({ x: 0, z: 0 }, [zombie(900, 0)]), null);
  assert.equal(nearestAttacker({ x: 0, z: 0 }, undefined), null);
});

test('an attacker behind the player produces a rear arc', () => {
  const bearing = hitBearing({ x: 0, z: 0 }, 0, { x: 0, z: 50 });
  assert.ok(Math.abs(bearing - 180) < 1);
  const arcs = new HitDirections();
  arcs.add(bearing, 0);
  assert.equal(arcs.items.length, 1);
});
