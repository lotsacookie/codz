import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVENT_LAYERS, resolveEvent } from '../export/web/assets/js/sound-events.js';

const manifest = JSON.parse(readFileSync(new URL('../export/web/assets/audio/manifest.json', import.meta.url), 'utf8'));
const first = list => list[0];

test('every event layer resolves to a real reference clip', () => {
  for (const name of Object.keys(EVENT_LAYERS)) {
    const cues = resolveEvent(name, manifest, null, first);
    assert.ok(cues.length > 0, name + ' has no clips');
    for (const cue of cues) assert.ok(manifest[cue.key], cue.key);
  }
});

test('board repair and board tear use different clips', () => {
  assert.match(resolveEvent('board', manifest, null, first)[0].key, /boards\/repair/);
  assert.match(resolveEvent('boardTear', manifest, null, first)[0].key, /boards\/snap/);
});

test('unknown events resolve to nothing', () => {
  assert.deepEqual(resolveEvent('nope', manifest), []);
});
