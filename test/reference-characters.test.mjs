import assert from 'node:assert/strict';
import { characterNames } from '../.tools/reference-pack/lib.mjs';
import { CHARACTER_ONLY, zoneAssetKinds } from '../.tools/reference-pack/extract.mjs';

const g = characterNames(new Set(['c_usa_dempsey_body', 'mtl_c_usa_dempsey_body', 'c_rus_nikolai_head', 'mtl_c_ger_richtofen_body', 'fx_blood_hit', 'zombie_theater_load', 'mtl_']));
assert.deepEqual(g.models, ['c_rus_nikolai_head', 'c_usa_dempsey_body']);
assert.deepEqual(g.materials, ['mtl_c_ger_richtofen_body', 'mtl_c_usa_dempsey_body']);
assert.ok(!JSON.stringify(g).includes('fx_blood') && !JSON.stringify(g).includes('zombie_theater'));
assert.ok(CHARACTER_ONLY.test('mtl_c_usa_dempsey_body') && CHARACTER_ONLY.test('c_jap_takeo_body') && !CHARACTER_ONLY.test('fx_blood_hit'));
assert.deepEqual(zoneAssetKinds(new Set(['characters'])), ['models']);
console.log('reference-characters ok');
