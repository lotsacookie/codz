import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MODIFIERS, setModifier, clearModifiers, activeModifiers } from '../export/web/assets/js/modifiers.js';
import { Session, zombieHealth } from '../export/web/assets/js/rules.js';
import { MoonSession } from '../export/web/assets/js/moon-session.js';

const web = path.resolve(import.meta.dirname, '..', 'export', 'web', 'assets');
const data = JSON.parse(readFileSync(path.join(web, 'game-data.json'), 'utf8'));
const moonData = JSON.parse(readFileSync(path.join(web, 'moon', 'combat-data.json'), 'utf8'));

test('no modifiers by default', () => {
  clearModifiers();
  assert.equal(activeModifiers().size, 0);
  assert.equal(new Session(data).perkLimit, 4);
});

test('every modifier has a label and description', () => {
  for (const mod of MODIFIERS) assert.ok(mod.id && mod.label && mod.description, mod.id);
});

test('rich start, double points, infinite ammo and tank zombies', () => {
  clearModifiers();
  const base = zombieHealth(5, data.rules);
  for (const id of ['rich_start', 'double_points', 'infinite_ammo', 'tank_zombies']) setModifier(id, true);
  const s = new Session(data);
  assert.equal(s.points, 50500);
  const before = s.points;
  s.addPoints(100);
  assert.equal(s.points - before, 200);
  s.phase = 'fighting';
  const mag = s.weapon.mag;
  assert.ok(s.fire());
  assert.equal(s.weapon.mag, mag);
  assert.equal(zombieHealth(5, data.rules), base * 3);
  clearModifiers();
});

test('glass cannon downs the player in one hit and keep_perks holds them through a revive', () => {
  clearModifiers();
  setModifier('glass_cannon', true);
  setModifier('keep_perks', true);
  const s = new Session(data);
  s.phase = 'fighting';
  s.perks.add('specialty_quickrevive');
  s.perks.add('specialty_armorvest');
  s.damage(1);
  assert.equal(s.phase, 'reviving');
  assert.ok(s.perks.has('specialty_armorvest'));
  clearModifiers();
});

test('endless keeps spawning and advances the round on kills with no dog rounds', () => {
  clearModifiers();
  setModifier('endless', true);
  const s = new Session(data);
  s.phase = 'fighting';
  const quota = s.quota;
  s.spawned = s.total;
  s.update(0.1);
  assert.ok(s.total > s.spawned);
  s.killed = quota;
  s.update(0.1);
  assert.equal(s.round, 2);
  assert.equal(s.dogRound, false);
  assert.equal(s.killed, 0);
  clearModifiers();
});

test('no_perk_limit lifts the four-perk cap', () => {
  clearModifiers();
  const capped = new MoonSession(moonData);
  assert.equal(capped.perkLimit, 4);
  setModifier('no_perk_limit', true);
  assert.equal(new MoonSession(moonData).perkLimit, Infinity);
  clearModifiers();
});
