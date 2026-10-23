import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMapFile, mapFiles } from '../export/web/assets/js/custom-maps/map-pick.js';
import { verifySource } from '../.tools/lib/github-verify.mjs';
import { sourceLinks } from '../.tools/lib/workshop-crawl.mjs';

const blob = (path, size = 1) => ({ type: 'blob', path, size });

test('the map picker skips prefabs, tests, templates, backups and browser source maps', () => {
  const tree = [blob('map_source/_prefabs/a.map', 99), blob('tests/t.map', 99), blob('regression_tests/q.map', 99), blob('templates/x.map', 99), blob('dist/bundle.js.map', 99), blob('zm/zm_a.autosave.map', 99), blob('assets/prefabs/p.map', 99)];
  assert.equal(pickMapFile(tree), null);
  assert.deepEqual(mapFiles([blob('zm_b.map')]).map(node => node.path), ['zm_b.map']);
});

test('the map picker prefers map_source, then the biggest file', () => {
  assert.equal(pickMapFile([blob('big.map', 900), blob('map_source/zm/small.map', 5), blob('map_source/zm/mid.map', 50)]).path, 'map_source/zm/mid.map');
  assert.equal(pickMapFile([blob('a.map', 1), blob('b/c.map', 7)]).path, 'b/c.map');
});

test('source links keep every candidate, maps first, and verification picks the first repo that has a map', async () => {
  const text = 'Extractor: https://github.com/Scobalula/Husky and source https://github.com/Ann/zm_tower and https://cdn.example.com/x/zm_t.map';
  assert.deepEqual(sourceLinks(text), ['https://cdn.example.com/x/zm_t.map', 'https://github.com/Scobalula/Husky', 'https://github.com/Ann/zm_tower']);
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    const tool = String(url).includes('Husky');
    return { ok: true, status: 200, json: async () => ({ tree: tool ? [blob('src/a.cs')] : [blob('map_source/zm/zm_tower.map', 10)] }) };
  };
  const cache = new Map();
  assert.equal(await verifySource(sourceLinks(text).slice(1), { fetchImpl, cache }), 'https://github.com/Ann/zm_tower/blob/HEAD/map_source/zm/zm_tower.map');
  assert.equal(await verifySource(['https://github.com/Scobalula/Husky'], { fetchImpl, cache }), '');
  assert.equal(calls.length, 2, 'each repo is looked up once');
  assert.equal(await verifySource(['https://github.com/Ann/x/blob/main/dist/app.js.map'], { fetchImpl }), '');
  assert.equal(await verifySource(['https://github.com/Ann/x'], { fetchImpl: async () => ({ ok: false, status: 403 }) }), 'https://github.com/Ann/x');
});
