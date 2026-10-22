import test from 'node:test';
import assert from 'node:assert/strict';
import { discover, pickMap } from '../.tools/lib/github-discover.mjs';

test('pickMap takes the largest .map and skips prefabs', () => {
  assert.equal(pickMap({ tree: [{ type: 'blob', path: 'a/_prefabs/x.map', size: 99 }, { type: 'blob', path: 'maps/zm_a.map', size: 5 }, { type: 'blob', path: 'maps/zm_b.map', size: 9 }] }), 'maps/zm_b.map');
  assert.equal(pickMap({ tree: [] }), '');
});

test('discover keeps relevant repos that contain a .map file', async () => {
  const repo = (name, extra = {}) => ({ full_name: `Ann/${name}`, name, description: 'bo3 zombies map', default_branch: 'main', owner: { login: 'Ann', avatar_url: 'a.png' }, stargazers_count: 4, pushed_at: '2026-01-01T00:00:00Z', topics: [], ...extra });
  const fetchImpl = async url => {
    const u = String(url);
    if (u.includes('/search/repositories')) return { ok: true, json: async () => ({ items: [repo('zm_tower'), repo('zm_empty'), repo('cats', { description: 'pictures of cats' })] }) };
    return { ok: true, json: async () => ({ tree: u.includes('zm_tower') ? [{ type: 'blob', path: 'maps/my map.map', size: 3 }] : [{ type: 'blob', path: 'readme.md', size: 1 }] }) };
  };
  const items = await discover({ fetchImpl, sleep: async () => {}, queries: ['q'], pages: 1 });
  assert.deepEqual(items.map(item => item.id), ['gh:Ann/zm_tower']);
  assert.equal(items[0].source, 'https://github.com/Ann/zm_tower/blob/main/maps/my%20map.map');
});
