import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { openKspk, parseKsixNames, safeRelative } from './lib.mjs';

const exists = file => access(file).then(() => true, () => false);

export function parsePointer(buffer) {
  if (buffer.length > 1024) return null;
  const text = buffer.toString('utf8');
  if (!text.startsWith('version https://git-lfs.github.com/spec/v1')) return null;
  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(text);
  const size = /^size (\d+)$/m.exec(text);
  if (!oid || !size) return null;
  return { oid: oid[1], size: Number(size[1]) };
}

export async function fetchLfsObject(repo, pointer, fetchImpl = fetch) {
  const batch = await fetchImpl(`https://github.com/${repo}.git/info/lfs/objects/batch`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.git-lfs+json', 'Content-Type': 'application/vnd.git-lfs+json' },
    body: JSON.stringify({ operation: 'download', transfers: ['basic'], objects: [{ oid: pointer.oid, size: pointer.size }] })
  });
  if (!batch.ok) throw new Error(`LFS batch request failed: HTTP ${batch.status}`);
  const answer = await batch.json();
  const object = answer.objects?.[0];
  if (object?.error) throw new Error(`LFS object unavailable: ${object.error.code} ${object.error.message}`);
  const action = object?.actions?.download;
  if (!action?.href) throw new Error('LFS batch answer has no download link');
  const response = await fetchImpl(action.href, { headers: action.header ?? {} });
  if (!response.ok) throw new Error(`LFS download failed: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const sha = createHash('sha256').update(data).digest('hex');
  if (sha !== pointer.oid || data.length !== pointer.size) throw new Error(`LFS object does not match its pointer (got ${sha}, ${data.length} bytes)`);
  return data;
}

export function clipNames(indexBuffer) {
  const names = {};
  for (const [clip, name] of parseKsixNames(indexBuffer)) names[clip] = name.replace(/\\/g, '/');
  return names;
}

export async function applyNames(soundsDir, names) {
  const moved = [], skipped = [];
  for (const [clip, name] of Object.entries(names)) {
    const from = join(soundsDir, clip);
    const relative = safeRelative(name);
    if (!relative || !(await exists(from))) { skipped.push({ clip, reason: relative ? 'missing' : 'unsafe-name' }); continue; }
    const to = join(soundsDir, relative);
    if (await exists(to)) { skipped.push({ clip, reason: 'target-exists', name: relative }); continue; }
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    moved.push({ clip, name: relative });
  }
  return { moved, skipped };
}

async function readIndex(packFile, repo, fetchImpl) {
  const pack = await openKspk(packFile);
  try {
    const record = pack.records.find(item => item.name === 'sounds.bin');
    if (!record) throw new Error('sound pack has no sounds.bin record');
    const stored = await pack.read(record);
    const pointer = parsePointer(stored);
    return pointer ? { data: await fetchLfsObject(repo, pointer, fetchImpl), pointer } : { data: stored, pointer: null };
  } finally { await pack.close(); }
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => { const at = argv.indexOf(`--${name}`); return at < 0 ? fallback : argv[at + 1]; };
  const packFile = resolve(option('pack', ''));
  const repo = option('repo', 'UMMMM-GUYSSS/Call-of-Duty-Black-Ops-Zombies');
  const map = option('map', 'kino');
  const soundsDir = resolve(option('out', 'export/web/reference/sounds'));
  const apply = argv.includes('--apply');
  const { data, pointer } = await readIndex(packFile, repo);
  await mkdir(join(soundsDir, 'index'), { recursive: true });
  await writeFile(join(soundsDir, 'index', `${map}-sounds.bin`), data);
  const names = clipNames(data);
  const namesFile = join(soundsDir, 'clip-names.json');
  const previous = (await exists(namesFile)) ? JSON.parse(await readFile(namesFile, 'utf8')) : {};
  const merged = Object.fromEntries(Object.entries({ ...previous, ...names }).sort(([a], [b]) => (a < b ? -1 : 1)));
  await writeFile(namesFile, JSON.stringify(merged, null, 1) + '\n');
  const pack = await openKspk(packFile);
  const total = pack.records.filter(item => item.name.startsWith('clips/')).length;
  await pack.close();
  const mine = Object.keys(names).length;
  console.log({ map, lfs: pointer ? pointer.oid : 'embedded', indexBytes: data.length, clipsInPack: total, named: mine, unnamed: Math.max(0, total - mine) });
  if (apply) {
    const result = await applyNames(soundsDir, names);
    await writeFile(join(soundsDir, `apply-${map}-report.json`), JSON.stringify(result, null, 1) + '\n');
    console.log({ moved: result.moved.length, skipped: result.skipped.length });
  }
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) await main();
