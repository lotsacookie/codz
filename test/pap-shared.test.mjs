import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { syncPap, ASSET_KEYS } from '../.tools/sync-pap.mjs';

const read = file => JSON.parse(readFileSync(new URL('../export/web/assets/' + file, import.meta.url), 'utf8'));
const kino = read('game-data.json').weapons;
const moon = read('moon/combat-data.json').weapons;

test('Pack-a-Punch gameplay values match Kino on every shared weapon', () => {
  for (const [id, source] of Object.entries(kino)) {
    if (!source.upgrade || !moon[id]) continue;
    for (const [key, value] of Object.entries(source.upgrade)) {
      if (ASSET_KEYS.includes(key)) assert.ok(key in moon[id].upgrade, `${id}.${key} missing`);
      else assert.equal(JSON.stringify(moon[id].upgrade[key]), JSON.stringify(value), `${id}.${key}`);
    }
  }
});

test('the upgraded M1911 is the dual-wield Mustang & Sally on every map', () => {
  const upgrade = moon.m1911_zm.upgrade;
  assert.equal(upgrade.dualWield, true);
  assert.equal(upgrade.clipSize, 12);
  assert.ok(upgrade.leftModel && upgrade.leftAnimations);
  assert.ok(upgrade.explosionRadius > 0);
});

test('every upgrade asset path exists and syncing again changes nothing', () => {
  const missing = [];
  const walk = value => {
    if (typeof value === 'string' && /\.(glb|json)$/.test(value) && value.includes('/') && !existsSync(new URL('../export/web/assets/' + value, import.meta.url))) missing.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  for (const weapon of Object.values(moon)) walk(weapon.upgrade);
  assert.deepEqual(missing, []);
  assert.deepEqual(syncPap(kino, structuredClone(moon)), []);
});
