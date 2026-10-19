import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_COLORS, colorFor, nearestTarget, Scoreboard, cleanScore } from '../export/web/net/coop.js';

const roster = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }, { id: 'c', name: 'Cy' }];

test('each roster slot gets its own tab color and unknown ids fall back to the first', () => {
  assert.equal(colorFor(roster, 'a'), PLAYER_COLORS[0]);
  assert.equal(colorFor(roster, 'c'), PLAYER_COLORS[2]);
  assert.equal(colorFor(roster, 'zzz'), PLAYER_COLORS[0]);
  assert.equal(new Set(PLAYER_COLORS).size, PLAYER_COLORS.length);
});

test('nearestTarget picks the closest player, keeping the fallback on ties and for empty lists', () => {
  const me = { x: 0, y: 0, z: 0 }, near = { x: 10, y: 0, z: 0 }, far = { x: 500, y: 0, z: 0 };
  const zombie = { x: 400, y: 0, z: 0 };
  assert.equal(nearestTarget(zombie, [near, far], me), far);
  assert.equal(nearestTarget({ x: 7, y: 0, z: 0 }, [near], me), near);
  assert.equal(nearestTarget(zombie, [], me), me);
  assert.equal(nearestTarget(zombie, undefined, me), me);
  assert.equal(nearestTarget({ x: 5, y: 0, z: 0 }, [{ x: -5, y: 0, z: 0 }], me), me, 'tie keeps the local player');
});

test('scoreboard reports local changes with their delta and pops remote gains live', () => {
  const board = new Scoreboard(roster, 'a');
  assert.equal(board.setLocal(500), null);
  assert.deepEqual(board.setLocal(560), { points: 560, delta: 60 });
  const popups = [];
  board.onPopup((entry, delta) => popups.push([entry.name, entry.color, delta]));
  assert.equal(board.receive('b', { points: 610, delta: 110 }), true);
  assert.deepEqual(popups, [['Bo', PLAYER_COLORS[1], 110]]);
  assert.equal(board.list().find(p => p.id === 'b').points, 610);
  assert.equal(board.receive('a', { points: 1, delta: 1 }), false, 'never overwrite our own score from the network');
  assert.equal(board.receive('nobody', { points: 1, delta: 1 }), false);
  assert.equal(board.receive('b', 'junk'), false);
});

test('scoreboard drops players who left and keeps colors by roster slot', () => {
  const board = new Scoreboard(roster, 'a');
  board.setRoster([roster[0], roster[2]], 'a');
  assert.deepEqual(board.list().map(p => p.id), ['a', 'c']);
  assert.equal(board.list()[1].color, PLAYER_COLORS[1]);
});

test('cleanScore clamps garbage', () => {
  assert.deepEqual(cleanScore({ points: '12.7', delta: 'x' }), { points: 12, delta: 0 });
  assert.equal(cleanScore(null), null);
});
