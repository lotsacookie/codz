import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameAudio } from '../export/web/assets/js/audio.js';
import { stepPools, pickStep, pickLanding, pickCrawl, classifyMaterial, preloadStepKeys, bindPlayerFootsteps, ZOMBIE_STEP_GAIN, PLAYER_STEP_GAIN } from '../export/web/assets/js/footsteps.js';

const manifest = JSON.parse(readFileSync(new URL('../export/web/assets/audio/manifest.json', import.meta.url), 'utf8'));
const keys = Object.keys(manifest);
const pools = stepPools(keys);

test('reference footstep clips are grouped by movement and surface', () => {
  assert.ok(pools.walk.wood.length >= 5);
  assert.ok(pools.sprint.concrete.length >= 5);
  assert.ok(pools.land.metal.length >= 2);
  assert.ok(pools.crawl.length >= 3);
  for (const key of preloadStepKeys(pools)) assert.ok(manifest[key], key);
});

test('missing movement and surface combinations fall back to a real clip', () => {
  for (const movement of ['walk', 'run', 'sprint']) {
    for (const surface of ['wood', 'carpet', 'metal', 'dirt', 'concrete', 'unknown', 'ice', 'rock']) {
      const key = pickStep(pools, movement, surface);
      assert.ok(key && manifest[key], `${movement}/${surface}`);
    }
  }
  assert.ok(pickLanding(pools, 'wood'));
  assert.ok(pickLanding(pools, 'wood', true).includes('fall_damage'));
  assert.ok(pickCrawl(pools));
});

test('consecutive steps do not repeat the same clip', () => {
  let last = null;
  for (let i = 0; i < 40; i++) {
    const key = pickStep(pools, 'run', 'wood', last, () => 0);
    assert.notEqual(key, last);
    last = key;
  }
});

test('material names map to surfaces and ignore decal suffixes', () => {
  assert.equal(classifyMaterial('*302n_103(wc/mtl_theater_carpet_1:wc/decal_grime_drip)'), 'carpet');
  assert.equal(classifyMaterial('wc/eb_art_floor_wood_hardwood02:wc/decal_concrete_x'), 'wood');
  assert.equal(classifyMaterial('wc/udr_floor_metal_rivets'), 'metal');
  assert.equal(classifyMaterial('wc/eb_art_floor_concrete_tile03'), 'concrete');
  assert.equal(classifyMaterial('wc/something_unknown', 'dirt'), 'dirt');
  assert.equal(classifyMaterial(''), 'concrete');
});

function setup() {
  const played = [];
  const audio = new GameAudio();
  audio.manifest = manifest;
  audio.ctx = { state: 'running', currentTime: 1 };
  audio.camera = { position: { x: 0, y: 0, z: 0 } };
  audio.play = (key, volume, position) => played.push({ key, volume, position });
  return { audio, played };
}

test('zombie steps play quietly from the zombie position and respect range', () => {
  const { audio, played } = setup();
  audio.zombieEvent('step', 'zombie', [200, 0, 0], 1, 'walk');
  audio.zombieEvent('step', 'nova', [200, 0, 0], 1, 'walk');
  audio.zombieEvent('step', 'zombie', [5000, 0, 0], 1, 'walk');
  assert.equal(played.length, 2);
  assert.ok(played[0].key.startsWith('ref/fly/footsteps/'));
  assert.ok(played[1].key.startsWith('ref/fly/footsteps/prone/zmb/crawl/'));
  assert.deepEqual(played[0].position, [200, 0, 0]);
  assert.ok(played[0].volume <= ZOMBIE_STEP_GAIN * 1.2);
  assert.ok(played[0].volume > 0.1);
  assert.ok(played[0].volume < PLAYER_STEP_GAIN.run);
});

test('dog steps keep using the hellhound cues', () => {
  const { audio, played } = setup();
  audio.zombieEvent('step', 'dog', [100, 0, 0]);
  assert.ok(played.length >= 1);
  assert.ok(played[0].key.includes('hellhounds/step'));
});

test('player steps and landings use the surface under the feet', () => {
  const { audio, played } = setup();
  audio.surfaceResolver = () => 'wood';
  audio.playerStep('sprint', { x: 0, y: 0, z: 0 }, false);
  audio.playerLand({ x: 0, y: 0, z: 0 }, false);
  assert.ok(played[0].key.includes('sprint/wood'));
  assert.ok(played[1].key.includes('land/wood'));
  assert.equal(played[0].position, undefined);
});

test('the player binding routes controller events to the audio object', () => {
  const calls = [];
  const audio = { playerStep: (...a) => calls.push(['step', ...a]), playerLand: (...a) => calls.push(['land', ...a]) };
  const player = {};
  bindPlayerFootsteps(player, () => audio);
  const controller = { getFeetPosition: () => 'feet', crouched: true };
  player.onFootstep('step', 'walk', controller);
  player.onFootstep('land', 'hard', controller);
  assert.deepEqual(calls, [['step', 'walk', 'feet', true], ['land', 'feet', true]]);
});
