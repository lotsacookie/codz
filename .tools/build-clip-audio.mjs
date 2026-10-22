import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const exists = file => access(file).then(() => true, () => false);

export function cueKey(name) {
  const parts = String(name).split('/').filter(Boolean);
  if (!parts.length || parts.includes('..')) return null;
  const root = parts[0] === 'english' ? 'english' : '';
  const body = parts.filter((part, at) => !(at === 0 && part === 'english') && !(at === (root ? 1 : 0) && part === 'sound'));
  if (!body.length) return null;
  const file = body.join('/').replace(/\.wav$/i, '').replace(/[^A-Za-z0-9_./-]/g, '_');
  return 'ref/' + (root ? 'english/' : '') + file;
}

export function selectClips(names, only) {
  const pattern = only ? new RegExp(only, 'i') : null;
  const picked = [];
  const seen = new Set();
  for (const [clip, name] of Object.entries(names).sort(([, a], [, b]) => (a < b ? -1 : 1))) {
    if (pattern && !pattern.test(name)) continue;
    const key = cueKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    picked.push({ clip, name, key });
  }
  return picked;
}

// Named WAVs that already sit under <sounds>/sound and <sounds>/english (no hashed clip needed).
export async function treeNames(soundsDir) {
  const names = {};
  const walk = async dir => {
    for (const entry of await readdir(join(soundsDir, dir), { withFileTypes: true }).catch(() => [])) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(rel);
      else if (/\.wav$/i.test(entry.name)) names[rel] = rel;
    }
  };
  await walk('sound');
  await walk('english');
  return names;
}

async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels:format=duration', '-of', 'json', file]);
  const data = JSON.parse(stdout);
  return { duration: Number(Number(data.format.duration).toFixed(3)), sampleRate: Number(data.streams[0].sample_rate), channels: data.streams[0].channels };
}

async function convert(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await run('ffmpeg', ['-v', 'error', '-y', '-i', source, '-vn', '-c:a', 'libvorbis', '-q:a', '3', target]);
}

async function pool(items, size, task) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  });
  await Promise.all(workers);
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => { const at = argv.indexOf(`--${name}`); return at < 0 ? fallback : argv[at + 1]; };
  const soundsDir = resolve(option('sounds', 'export/web/assets/reference/sounds'));
  const audioDir = resolve(option('audio', 'export/web/assets/audio'));
  const only = option('only', '');
  const names = argv.includes('--tree') ? await treeNames(soundsDir) : JSON.parse(await readFile(join(soundsDir, 'clip-names.json'), 'utf8'));
  const manifestFile = join(audioDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const picked = selectClips(names, only);
  const stats = { converted: 0, existing: 0, missing: 0, failed: 0, keptKeys: 0 };
  const entries = new Map();
  await pool(picked, 6, async ({ clip, name, key }) => {
    if (manifest[key]) { stats.keptKeys++; return; }
    const source = join(soundsDir, clip);
    if (!(await exists(source))) { stats.missing++; return; }
    const target = join(audioDir, key + '.ogg');
    try {
      if (await exists(target)) stats.existing++;
      else { await convert(source, target); stats.converted++; }
      const info = await probe(target);
      entries.set(key, { url: `audio/${key}.ogg`, source: `reference/sounds/${clip}`, sourceName: name, sourceSha256: clip.startsWith('clips/') ? clip.slice(6, 70) : createHash('sha256').update(await readFile(source)).digest('hex'), ...info });
    } catch (error) {
      stats.failed++;
      console.error(`failed ${name}: ${error.message}`);
    }
  });
  for (const { key } of picked) if (entries.has(key)) manifest[key] = entries.get(key);
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log({ selected: picked.length, ...stats, manifestKeys: Object.keys(manifest).length });
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) await main();
