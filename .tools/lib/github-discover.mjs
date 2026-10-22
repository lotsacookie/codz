// Finds Black Ops 3 map repos straight on GitHub, so the Workshop list does not depend on authors linking their source
// in a Steam description. Only repos that really contain a Radiant .map file are kept.
const API = 'https://api.github.com';
export const GH_QUERIES = [
  'topic:black-ops-3', 'topic:bo3', 'topic:call-of-duty-black-ops-3', 'topic:bo3-mod-tools', 'topic:radiant', 'topic:zombies-map',
  'bo3 zombies map in:name,description', 'black ops 3 custom zombie map in:name,description', 'black ops iii map radiant in:name,description',
  'zm_ bo3 in:name', 'treyarch radiant map in:name,description', 'bo3 mod tools custom map in:name,description', 'cod zombies custom map bo3 in:description',
];
const RELEVANT = /bo3|bo-3|black[\s_-]?ops[\s_-]?(?:3|iii)|zm_|treyarch|radiant|zombie|mod[\s_-]?tools/i;
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function call(url, { fetchImpl, token }) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'codz-workshop-index', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  return response.json();
}

export function pickMap(tree) {
  const maps = (tree?.tree ?? []).filter(node => node.type === 'blob' && /\.map$/i.test(node.path) && !/(?:^|\/)_prefabs\//i.test(node.path));
  return maps.sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]?.path ?? '';
}

export async function discover({ fetchImpl = globalThis.fetch.bind(globalThis), token = '', sleep = defaultSleep, queries = GH_QUERIES, pages = 5, maxRepos = 600, delay = 2500, log = () => {} } = {}) {
  const tools = { fetchImpl, token };
  const repos = new Map();
  for (const q of queries) {
    for (let page = 1; page <= pages; page++) {
      let body;
      try {
        body = await call(`${API}/search/repositories?${new URLSearchParams({ q, per_page: '100', page: String(page), sort: 'updated' })}`, tools);
      } catch (error) { log(`github "${q}" page ${page}: ${error.message}`); await sleep(delay * 4); break; }
      for (const repo of body.items ?? []) {
        const text = [repo.name, repo.description, ...(repo.topics ?? [])].join(' ');
        if (!repos.has(repo.full_name) && RELEVANT.test(text)) repos.set(repo.full_name, repo);
      }
      log(`github "${q}" page ${page}: ${body.items?.length ?? 0} repos, ${repos.size} relevant so far`);
      if ((body.items?.length ?? 0) < 100) break;
      await sleep(delay);
    }
    await sleep(delay);
  }
  const out = [];
  for (const repo of [...repos.values()].slice(0, maxRepos)) {
    try {
      const tree = await call(`${API}/repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`, tools);
      const file = pickMap(tree);
      if (!file && !tree.truncated) continue;
      const base = `https://github.com/${repo.full_name}`;
      out.push({
        id: `gh:${repo.full_name}`,
        name: String(repo.name).replace(/[-_]+/g, ' '),
        author: repo.owner?.login ?? '',
        thumb: repo.owner?.avatar_url ?? '',
        rating: 0,
        subscribers: repo.stargazers_count ?? 0,
        size: 0,
        updated: Math.floor(Date.parse(repo.pushed_at) / 1000) || 0,
        tags: ['GitHub', ...(repo.topics ?? []).slice(0, 3)],
        source: file ? `${base}/blob/${repo.default_branch}/${file.split('/').map(encodeURIComponent).join('/')}` : base,
      });
    } catch (error) { log(`${repo.full_name}: ${error.message}`); }
    await sleep(150);
  }
  return out;
}
