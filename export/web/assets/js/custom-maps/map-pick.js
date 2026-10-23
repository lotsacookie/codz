// Picks the Radiant .map to load from a repo's file list ({ path, size, type? } entries). Shared by the loader and the Workshop
// index so both agree. Skips prefabs and folders that only hold test data, backups or autosaves; prefers `map_source/`, then the biggest file.
const IGNORED_DIR = /^(?:_?prefabs|templates?|node_modules|dist|testdata|fixtures?|examples?|samples?|docs?|backups?|bak|autosaves?)$|(?:^|[_-])tests?$/i;
// Browser source maps (bundle.js.map) are not Radiant maps.
const SOURCE_MAP = /\.(?:m?js|cjs|jsx?|tsx?|css|scss)\.map$/i;
const IGNORED_FILE = /(?:^|[._-])(?:autosave|backup|bak)(?:[._-]|$)/i;

export function mapFiles(tree) {
  return (tree ?? []).filter(node => (node.type ?? 'blob') === 'blob' && /\.map$/i.test(node.path)).filter(node => {
    const parts = node.path.split('/');
    return !parts.slice(0, -1).some(part => IGNORED_DIR.test(part)) && !IGNORED_FILE.test(parts.at(-1)) && !SOURCE_MAP.test(parts.at(-1));
  });
}

export function pickMapFile(tree) {
  const maps = mapFiles(tree);
  if (!maps.length) return null;
  const preferred = maps.filter(node => /(^|\/)map_source\//i.test(node.path));
  return (preferred.length ? preferred : maps).reduce((best, node) => ((node.size ?? 0) > (best.size ?? 0) ? node : best));
}
