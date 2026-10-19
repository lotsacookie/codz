import { parseIwmap } from './iwmap-parse.js';
import { normalizeName } from './iwmap-flatten.js';

// A GitHub map repo (github.com/<user>/<repo>[/tree|blob/<ref>/...]) or a raw/blob link to one .map file.
export function parseGithubMapUrl(text) {
  const url = String(text).trim().replace(/[?#].*$/, '');
  let m = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+\.map)$/i.exec(url);
  if (m) return { owner: m[1], repo: m[2], ref: m[3], path: decodeURI(m[4]) };
  m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+\.map)$/i.exec(url);
  if (m) return { owner: m[1], repo: m[2], ref: m[3], path: decodeURI(m[4]) };
  m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+))?\/?$/i.exec(url);
  if (m) return { owner: m[1], repo: m[2], ref: m[3] ?? null, path: null };
  return null;
}
export const isGithubRepoUrl = text => {
  const parsed = parseGithubMapUrl(text);
  return Boolean(parsed && !parsed.path);
};

export const rawUrl = ({ owner, repo, ref }, path) => `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`;

const prefabModels = map => {
  const out = [];
  for (const entity of map.entities) if (entity.keys.classname === 'misc_prefab' && entity.keys.model) out.push(entity.keys.model);
  return out;
};

// Fetches the `_prefabs` files a map (and the prefabs inside those) refer to. Prefabs that 404 are the
// stock mod-tools ones; they are skipped, and the parser marks their place by name.
export async function fetchPrefabs(mapText, resolveUrl, { fetchImpl = globalThis.fetch.bind(globalThis), onProgress, limit = 6, maxFiles = 1500 } = {}) {
  const files = new Map();
  const seen = new Set();
  let queue = prefabModels(parseIwmap(mapText));
  let done = 0;
  while (queue.length && seen.size < maxFiles) {
    const batch = [...new Set(queue.map(normalizeName))].filter(name => name.endsWith('.map') && !seen.has(name));
    queue = [];
    batch.forEach(name => seen.add(name));
    for (let i = 0; i < batch.length; i += limit) {
      await Promise.all(batch.slice(i, i + limit).map(async name => {
        try {
          const response = await fetchImpl(resolveUrl(name));
          if (!response.ok) return;
          const text = await response.text();
          files.set(name, text);
          queue.push(...prefabModels(parseIwmap(text)));
        } catch {
          // an unreachable prefab only costs that prefab
        } finally {
          onProgress?.(++done, seen.size);
        }
      }));
    }
  }
  return files;
}

export async function loadGithubMap(target, { fetchImpl = globalThis.fetch.bind(globalThis), onProgress } = {}) {
  let { owner, repo, ref, path } = target;
  const api = async url => {
    const response = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub request failed (${response.status}).`);
    return response.json();
  };
  if (!ref) ref = (await api(`https://api.github.com/repos/${owner}/${repo}`)).default_branch;
  let tree = null;
  if (!path) {
    tree = (await api(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`)).tree.filter(node => node.type === 'blob');
    const maps = tree.filter(node => /\.map$/i.test(node.path) && !/(^|\/)_prefabs\//i.test(node.path));
    if (!maps.length) throw new Error('This repository has no .map file outside its _prefabs folder.');
    const preferred = maps.filter(node => /(^|\/)map_source\//i.test(node.path));
    path = (preferred.length ? preferred : maps).reduce((best, node) => ((node.size ?? 0) > (best.size ?? 0) ? node : best)).path;
  }
  const source = { owner, repo, ref };
  const response = await fetchImpl(rawUrl(source, path));
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  const text = await response.text();
  // Prefab paths in the map are relative to the folder that holds `_prefabs`, normally `map_source/`.
  const root = path.includes('/') ? path.slice(0, path.indexOf('/') + 1) : '';
  const candidates = [...new Set([root, 'map_source/', ''])];
  const known = tree && new Set(tree.map(node => node.path.toLowerCase()));
  const resolveUrl = name => {
    const base = candidates.find(c => known?.has(`${c}${name}`.toLowerCase())) ?? candidates[0];
    return rawUrl(source, `${base}${name}`);
  };
  const files = await fetchPrefabs(text, resolveUrl, { fetchImpl, onProgress });
  return { text, files, path };
}
