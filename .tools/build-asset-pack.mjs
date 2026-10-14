import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodePack, parsePack } from '../export/web/asset-pack.js';

const defaultRoot = path.resolve(import.meta.dirname, '..', 'export', 'web');
const POINTER = 'version https://git-lfs.github.com/spec/v1';
const PROFILES = ['desktop', 'mobile'];
const mb = n => (n / 1048576).toFixed(1);

export const isPointer = bytes => bytes.byteLength < 512 && Buffer.from(bytes.subarray(0, POINTER.length)).toString('latin1') === POINTER;
export const packName = profile => `kino-${profile}.pack`;
// Every other map ships one pack of its texture folder (the map folders have no separate mobile images).
export const MAP_PACKS = ['moon', 'shangri-la', 'ascension', 'coast'];
export const mapPackName = map => `${map}.pack`;
const IMAGE = /\.(?:png|webp|jpe?g)$/i;

export function collectMapTextures(root, map) {
  const out = [];
  const walk = dir => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (IMAGE.test(entry.name)) out.push(rel);
    }
  };
  if (existsSync(path.join(root, map, 'textures'))) walk(`${map}/textures`);
  return out.sort();
}
export const profilePath = (rel, profile) => (profile === 'mobile' && rel.startsWith('textures/') ? `textures-mobile/${rel.slice('textures/'.length)}` : rel);

function glbJson(bytes, name) {
  if (isPointer(bytes)) throw new Error(`${name} is a Git LFS pointer. Run "git lfs pull" first.`);
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${name} is not a binary glTF`);
  return JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
}

export function collectAssets(root = defaultRoot) {
  const found = new Set();
  const add = rel => {
    const clean = path.posix.normalize(rel.replaceAll('\\', '/'));
    if (clean.startsWith('../') || path.posix.isAbsolute(clean)) throw new Error(`asset path escapes the web root: ${rel}`);
    found.add(clean);
  };
  const external = uri => uri && !uri.startsWith('data:');

  const gltf = JSON.parse(readFileSync(path.join(root, 'kino.gltf'), 'utf8'));
  for (const image of gltf.images ?? []) if (external(image.uri)) add(decodeURIComponent(image.uri));

  const modelDir = path.join(root, 'models');
  if (existsSync(modelDir)) {
    for (const name of readdirSync(modelDir).filter(n => n.endsWith('.glb')).sort()) {
      add(`models/${name}`);
      const json = glbJson(readFileSync(path.join(modelDir, name)), `models/${name}`);
      for (const image of json.images ?? []) if (external(image.uri)) add(path.posix.join('models', decodeURIComponent(image.uri)));
    }
  }

  const dataFile = path.join(root, 'game-data.json');
  if (existsSync(dataFile)) {
    for (const match of readFileSync(dataFile, 'utf8').matchAll(/textures\/[^"\\]+?\.(?:png|webp|jpe?g)/gi)) add(match[0]);
  }

  const animationDir = path.join(root, 'animations');
  if (existsSync(animationDir)) {
    for (const name of readdirSync(animationDir).filter(n => n.endsWith('.json')).sort()) add(`animations/${name}`);
  }
  return [...found].sort();
}

export function buildEntries(root, profile, rels) {
  const entries = [];
  const missing = [];
  const pointers = [];
  const base = path.resolve(root) + path.sep;
  for (const rel of rels) {
    const key = profilePath(rel, profile);
    const file = path.resolve(root, key);
    if (!file.startsWith(base)) throw new Error(`asset path escapes the web root: ${key}`);
    if (!existsSync(file) || !statSync(file).isFile()) { missing.push(key); continue; }
    const bytes = readFileSync(file);
    if (isPointer(bytes)) { pointers.push(key); continue; }
    entries.push({ path: key, bytes });
  }
  return { entries, missing, pointers };
}

function describeProblems(profile, { missing, pointers }) {
  const lines = [];
  if (pointers.length) lines.push(`${pointers.length} Git LFS pointer file(s) in the ${profile} set (run "git lfs pull"): ${pointers.slice(0, 5).join(', ')}${pointers.length > 5 ? ', ...' : ''}`);
  if (missing.length) lines.push(`${missing.length} missing file(s) in the ${profile} set: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}`);
  return lines;
}

export function writePacks({ root = defaultRoot, outDir = path.join(root, 'asset-pack'), profiles = PROFILES, maps = MAP_PACKS } = {}) {
  const rels = profiles.length ? collectAssets(root) : [];
  mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const profile of profiles) {
    const built = buildEntries(root, profile, rels);
    const problems = describeProblems(profile, built);
    if (problems.length) throw new Error(problems.join('\n'));
    const bytes = encodePack(built.entries);
    const file = path.join(outDir, packName(profile));
    writeFileSync(file, bytes);
    results.push({ profile, file, files: built.entries.length, bytes: bytes.byteLength });
  }
  for (const map of maps) {
    const rels = collectMapTextures(root, map);
    if (!rels.length) continue;
    const built = buildEntries(root, 'desktop', rels);
    const problems = describeProblems(map, built);
    if (problems.length) throw new Error(problems.join('\n'));
    const bytes = encodePack(built.entries);
    const file = path.join(outDir, mapPackName(map));
    writeFileSync(file, bytes);
    results.push({ profile: map, file, files: built.entries.length, bytes: bytes.byteLength });
  }
  return results;
}

export function verifyPacks({ root = defaultRoot, outDir = path.join(root, 'asset-pack'), profiles = PROFILES, maps = MAP_PACKS } = {}) {
  const rels = profiles.length ? collectAssets(root) : [];
  const problems = [];
  for (const profile of profiles) {
    const file = path.join(outDir, packName(profile));
    if (!existsSync(file)) { problems.push(`${packName(profile)} does not exist`); continue; }
    let pack;
    try { pack = parsePack(readFileSync(file)); } catch (error) { problems.push(`${packName(profile)}: ${error.message}`); continue; }
    const built = buildEntries(root, profile, rels);
    problems.push(...describeProblems(profile, built));
    const expected = new Map(built.entries.map(e => [e.path, e.bytes]));
    const stale = [];
    for (const [key, bytes] of expected) {
      const packed = pack.get(key);
      if (!packed) problems.push(`${packName(profile)} is missing ${key}`);
      else if (Buffer.compare(Buffer.from(packed), bytes) !== 0) stale.push(key);
    }
    if (stale.length) problems.push(`${packName(profile)} has ${stale.length} stale file(s): ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ', ...' : ''}`);
    const extra = pack.paths().filter(key => !expected.has(key));
    if (extra.length) problems.push(`${packName(profile)} has ${extra.length} file(s) no longer used: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ', ...' : ''}`);
  }
  for (const map of maps) {
    const rels = collectMapTextures(root, map);
    if (!rels.length) continue;
    const name = mapPackName(map), file = path.join(outDir, name);
    if (!existsSync(file)) { problems.push(`${name} does not exist`); continue; }
    let pack;
    try { pack = parsePack(readFileSync(file)); } catch (error) { problems.push(`${name}: ${error.message}`); continue; }
    const built = buildEntries(root, 'desktop', rels);
    problems.push(...describeProblems(map, built));
    const expected = new Map(built.entries.map(e => [e.path, e.bytes]));
    const stale = [];
    for (const [key, bytes] of expected) {
      const packed = pack.get(key);
      if (!packed) problems.push(`${name} is missing ${key}`);
      else if (Buffer.compare(Buffer.from(packed), bytes) !== 0) stale.push(key);
    }
    if (stale.length) problems.push(`${name} has ${stale.length} stale file(s): ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ', ...' : ''}`);
    const extra = pack.paths().filter(key => !expected.has(key));
    if (extra.length) problems.push(`${name} has ${extra.length} file(s) no longer used: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ', ...' : ''}`);
  }
  return problems;
}

function main(argv) {
  const option = name => argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
  const profile = option('profile');
  if (profile && !PROFILES.includes(profile)) { console.error(`--profile must be one of: ${PROFILES.join(', ')}`); return 2; }
  const map = option('map');
  if (map && !MAP_PACKS.includes(map)) { console.error(`--map must be one of: ${MAP_PACKS.join(', ')}`); return 2; }
  const options = { profiles: map ? [] : profile ? [profile] : PROFILES, maps: map ? [map] : profile ? [] : MAP_PACKS };
  const root = option('root');
  if (root) options.root = path.resolve(root);
  const out = option('out');
  if (out) options.outDir = path.resolve(out);
  try {
    if (argv.includes('--verify')) {
      const problems = verifyPacks(options);
      if (problems.length) { for (const line of problems) console.error(line); return 1; }
      console.log('asset packs match the files on disk');
      return 0;
    }
    for (const r of writePacks(options)) console.log(`${path.basename(r.file)}: ${r.files} files, ${mb(r.bytes)} MB`);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
