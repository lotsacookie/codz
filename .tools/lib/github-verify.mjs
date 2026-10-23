import { parseGithubMapUrl } from '../../export/web/assets/js/custom-maps/iwmap-remote.js';
import { mapFiles, pickMapFile } from '../../export/web/assets/js/custom-maps/map-pick.js';

const API = 'https://api.github.com';
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');

// A Workshop description can link tools, wikis or other people's repos next to the real source. This checks candidate links
// in order and returns the first that really holds a loadable .map (as a direct link to that file), or '' when none does.
// A repo that cannot be checked (rate limit, network) is kept as the plain link instead of being dropped.
export async function verifySource(candidates, { fetchImpl = globalThis.fetch.bind(globalThis), token = '', cache = new Map(), log = () => {} } = {}) {
  for (const link of candidates) {
    const target = parseGithubMapUrl(link);
    const direct = target?.path ?? (!target && /\.map(?:\?|$)/i.test(link) ? decodeURI(link.replace(/^https?:\/\/[^/]+\//, '').replace(/[?#].*$/, '')) : '');
    if (direct) {
      if (mapFiles([{ path: direct }]).length) return link;
      continue;
    }
    if (!target) continue;
    const key = `${target.owner}/${target.repo}@${target.ref ?? 'HEAD'}`.toLowerCase();
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const response = await fetchImpl(`${API}/repos/${target.owner}/${target.repo}/git/trees/${encodeURIComponent(target.ref ?? 'HEAD')}?recursive=1`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'codz-workshop-index', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (response.status === 404 || response.status === 409) return { none: true };
        if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
        const tree = await response.json();
        const file = pickMapFile(tree.tree);
        return file ? { path: file.path } : tree.truncated ? { unknown: true } : { none: true };
      })().catch(error => { log(`${key}: ${error.message}`); return { unknown: true }; }));
    }
    const result = await cache.get(key);
    if (result.path) return `https://github.com/${target.owner}/${target.repo}/blob/${target.ref ?? 'HEAD'}/${encodePath(result.path)}`;
    if (result.unknown) return link;
  }
  return '';
}
