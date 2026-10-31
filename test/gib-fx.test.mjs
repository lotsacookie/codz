import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GIB_MODELS, GIB_TUNING, planGibs, stepGib, gibScale } from '../export/web/assets/js/gib-fx.js';
import { BENT_BARS, bentBarsName } from '../export/web/assets/js/window-bars.js';

const seeded = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test('every gib chunk and bent bar model is exported as a valid glb', () => {
  for (const name of [...GIB_MODELS, ...Object.values(BENT_BARS)]) {
    const path = new URL(`../export/web/assets/models/${name}.glb`, import.meta.url);
    assert.ok(existsSync(path), name);
    const bytes = readFileSync(path);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    assert.equal(bytes.readUInt32LE(8), bytes.length);
  }
  assert.equal(bentBarsName('vert04'), 'p_zom_win_bars_01_vert04_bend_180');
  assert.equal(bentBarsName('nope'), null);
});

test('gibs are thrown up and out, fall, land and shrink away', () => {
  const plan = planGibs(seeded(5), 12);
  assert.equal(plan.length, 12);
  for (const gib of plan) {
    assert.ok(GIB_MODELS.includes(gib.model));
    assert.ok(gib.velocity.y >= GIB_TUNING.lift[0]);
    gib.position = new THREE.Vector3(0, 40, 0);
    gib.age = 0;
    let landed = false;
    for (let t = 0; t < 2 && !landed; t += 1 / 60) landed = stepGib(gib, 1 / 60, 0);
    assert.ok(landed && gib.position.y >= 0);
    assert.equal(gibScale(0, gib.life, 4), 4);
    assert.equal(gibScale(gib.life, gib.life, 4), 0);
  }
});
