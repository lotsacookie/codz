import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { doorGroups, barrierGroups, movingEntityIds, boxLocations, spawnPoints, powerSwitches } from '../export/web/assets/js/shangri-la-rules.js';
import { ShangriSession } from '../export/web/assets/js/shangri-la-session.js';

const data = JSON.parse(fs.readFileSync(new URL('../export/web/assets/shangri-la/map-data.json', import.meta.url)));
const weapons = { m1911_zm: { id: 'm1911_zm', clipSize: 8, startAmmo: 32, maxAmmo: 80, fireTime: .1, price: 0 } };

test('Shangri-La entities group into doors, windows, boxes and power', () => {
  const doors = doorGroups(data.entities);
  assert.equal(doors.length, 8);
  assert.ok(doors.every(d => d.cost > 0 && d.triggers.length > 0 && d.parts.length > 0));
  const barriers = barrierGroups(data.entities);
  assert.equal(barriers.length, 29);
  assert.ok(barriers.every(b => b.boards.length > 0));
  assert.equal(boxLocations(data.entities).length, 4);
  assert.equal(powerSwitches(data.entities).length, 2);
  assert.ok(spawnPoints(data.entities).length > 40);
  const moving = movingEntityIds(data.entities);
  for (const d of doors) for (const id of d.parts) assert.ok(moving.has(id));
});

test('Shangri-La session starts a powered-off solo run with round rules', () => {
  const s = new ShangriSession({ weapons, rules: {} });
  assert.equal(s.area, 'moon');
  assert.equal(s.round, 1);
  assert.equal(s.phase, 'preparing');
  assert.equal(s.power, false);
  assert.ok(s.total > 0);
  assert.ok(Number.isFinite(s.nextDogRound));
  s.points = 5000;
  assert.equal(s.buyDoor({ name: 'a', cost: 1000, flag: 'f' }), true);
  assert.equal(s.points, 4000);
  assert.ok(s.openDoors.has('a') && s.flags.has('f'));
  s.nextRound();
  assert.equal(s.round, 2);
  assert.ok(Number.isFinite(s.nextDogRound));
});
