import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { perkLightColor, isPerkLit, lightLevel, machineTargets, PERK_LIGHT_COLORS } from '../export/web/assets/js/perk-lights-data.js';
import { DOG_FX, emitDue, puffState } from '../export/web/assets/js/hellhound-fx-data.js';

const data = JSON.parse(readFileSync(new URL('../export/web/assets/game-data.json', import.meta.url), 'utf8'));

test('Kino machines are found with their models', () => {
  const found = machineTargets(data.entities);
  assert.ok(found.length >= 4);
  const revive = found.find(m => m.perk === 'specialty_quickrevive');
  assert.ok(revive && revive.modelId === 2081);
  assert.ok(found.some(m => m.perk === 'zombie_vending_upgrade'));
});

test('power rules and flicker', () => {
  assert.equal(isPerkLit('specialty_armorvest', false), false);
  assert.equal(isPerkLit('specialty_armorvest', true), true);
  assert.equal(isPerkLit('specialty_quickrevive', false), true);
  assert.equal(isPerkLit('specialty_rof', undefined), true);
  assert.ok(lightLevel(0.3, 'specialty_rof') > 0.79);
  let dipped = false;
  for (let t = 0; t < 20; t += 0.01) if (lightLevel(t, 'specialty_quickrevive') < 0.5) dipped = true;
  assert.ok(dipped);
  assert.equal(perkLightColor('specialty_armorvest'), PERK_LIGHT_COLORS.specialty_armorvest);
});

test('hellhound fx maths and texture', () => {
  assert.ok(existsSync(new URL('../export/web/assets/' + DOG_FX.glowUrl, import.meta.url)));
  assert.deepEqual(emitDue(0.5, 0.25, 6), { count: 2, carry: 0 });
  assert.equal(puffState(2, 1, true).done, true);
  assert.ok(puffState(0.2, 1, false).opacity > 0);
});
