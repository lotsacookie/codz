// Extracts vfx/sfx source assets from fetched reference packs (see fetch.mjs, which writes resolved.json).
// Existing output files are never replaced unless --overwrite is passed. --report-dir keeps reports out of the output tree.
//   node extract.mjs --resolved .work/reference/resolved.json --out .work/extracted [--only REGEX] [--kinds images,sounds,fx,scripts,raw]
// images: IWI -> PNG (decodeIwi). sounds: IWD .wav/.flac and KSPK clips, copied as-is (decode with ffmpeg later).
// scripts: GSC/CSC/other raw files stored in .ff zones (zlib payloads), written as plain text under scripts/.
// fx: names found in .ff zones that look like effects/particles (FX_PATTERN), written to fx-index.json. raw: other IWD entries.
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { FX_PATTERN, openZip, openKspk, inflateZone, scanNames, scanRawFiles, decodeIwi, encodePng, safeRelative } from './lib.mjs';

export function classifyEntry(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('/')) return 'dir';
  if (/\.iwi$/.test(lower)) return 'images';
  if (/\.(wav|flac|ogg|mp3)$/.test(lower)) return 'sounds';
  return 'raw';
}

export function iwiToPng(buffer) {
  const image = decodeIwi(buffer);
  if (image.error) return { error: image.error, width: image.width, height: image.height, format: image.format };
  return { png: encodePng(image.width, image.height, image.rgba), width: image.width, height: image.height, format: image.format };
}

export function fxNames(names) {
  return [...names].filter(name => FX_PATTERN.test(name)).sort();
}

const exists = file => access(file).then(() => true, () => false);

// Never replaces a file that is already there (unless --overwrite): returns { file, existed }.
export async function put(out, relative, data, overwrite = false) {
  const safe = safeRelative(relative);
  if (!safe) return { file: null, existed: false };
  const file = join(out, safe);
  if (!overwrite && await exists(file)) return { file: safe, existed: true };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, data);
  return { file: safe, existed: false };
}

// Where an archive entry lands, so existing outputs can be skipped before any reading or decoding.
export function targetFor(kind, name) {
  return kind === 'images' ? `images/${name.replace(/^images\//i, '').replace(/\.iwi$/i, '.png')}` : `${kind}/${name}`;
}

export async function extractArchive(file, { out, kinds, only, report, overwrite }) {
  const zip = await openZip(file);
  try {
    for (const entry of zip.entries) {
      const kind = classifyEntry(entry.name);
      if (kind === 'dir' || !kinds.has(kind) || (only && !only.test(entry.name))) continue;
      const target = safeRelative(targetFor(kind, entry.name));
      if (target && !overwrite && await exists(join(out, target))) { report.push({ archive: file, entry: entry.name, kind, file: target, status: 'exists' }); continue; }
      const raw = await zip.read(entry);
      const record = { archive: file, entry: entry.name, kind, sha256: createHash('sha256').update(raw).digest('hex') };
      let data = raw;
      if (kind === 'images') {
        const result = iwiToPng(raw);
        if (result.error) { report.push({ ...record, status: result.error, format: result.format }); continue; }
        data = result.png;
        Object.assign(record, { width: result.width, height: result.height, format: result.format });
      }
      const saved = await put(out, targetFor(kind, entry.name), data, overwrite);
      report.push({ ...record, file: saved.file, status: !saved.file ? 'rejected-path' : saved.existed ? 'exists' : 'ok' });
    }
  } finally { await zip.close(); }
}

export async function extractSoundPack(file, { out, only, report, overwrite }) {
  const pack = await openKspk(file);
  try {
    for (const record of pack.records) {
      if (only && !only.test(record.name)) continue;
      const target = safeRelative(`sounds/${record.name}`);
      if (target && !overwrite && await exists(join(out, target))) { report.push({ archive: file, entry: record.name, kind: 'sounds', file: target, status: 'exists' }); continue; }
      const saved = await put(out, `sounds/${record.name}`, await pack.read(record), overwrite);
      report.push({ archive: file, entry: record.name, kind: 'sounds', sha256: record.sha256, file: saved.file, status: !saved.file ? 'rejected-path' : saved.existed ? 'exists' : 'ok' });
    }
  } finally { await pack.close(); }
}

export async function indexZone(file, zone) {
  return { zone: file, names: fxNames(scanNames(zone)) };
}

export async function extractScripts(file, zone, { out, report, overwrite }) {
  for (const script of scanRawFiles(zone)) {
    const sha256 = createHash('sha256').update(script.data).digest('hex');
    const relative = script.name ? `scripts/${script.name}` : `scripts/unnamed/${sha256.slice(0, 16)}.bin`;
    const saved = await put(out, relative, script.data, overwrite);
    report.push({ archive: file, entry: script.name, kind: 'scripts', sha256, file: saved.file, status: !saved.file ? 'rejected-path' : saved.existed ? 'exists' : 'ok' });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => { const at = argv.indexOf(`--${name}`); return at < 0 ? fallback : argv[at + 1]; };
  const resolvedFile = resolve(option('resolved', '.work/reference/resolved.json'));
  const out = resolve(option('out', '.work/extracted'));
  const kinds = new Set(String(option('kinds', 'images,sounds,fx,scripts')).split(',').map(value => value.trim()));
  const overwrite = argv.includes('--overwrite');
  const reportDir = resolve(option('report-dir', out));
  const only = option('only') ? new RegExp(option('only'), 'i') : null;
  const resolved = JSON.parse(await readFile(resolvedFile, 'utf8'));
  const report = [], zones = [];
  for (const item of resolved.entries) {
    if (!item.file || !String(item.status).startsWith('ok')) continue;
    if (item.kind === 'iwd' || item.kind === 'iw_00') await extractArchive(item.file, { out, kinds, only, report, overwrite });
    else if (item.kind === 'loaded-sound' && kinds.has('sounds')) await extractSoundPack(item.file, { out, only, report, overwrite });
    else if (item.kind === 'zone' && (kinds.has('fx') || kinds.has('scripts'))) {
      const zone = inflateZone(await readFile(item.file));
      if (zone.error) { report.push({ archive: item.path, kind: 'zone', status: zone.error }); continue; }
      if (kinds.has('fx')) zones.push(await indexZone(item.path, zone.data));
      if (kinds.has('scripts')) await extractScripts(item.path, zone.data, { out, report, overwrite });
    }
  }
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, 'extract-report.json'), JSON.stringify(report, null, 1));
  if (zones.length) await writeFile(join(reportDir, 'fx-index.json'), JSON.stringify(zones, null, 1));
  const counts = {};
  for (const row of report) counts[`${row.kind}:${row.status}`] = (counts[`${row.kind}:${row.status}`] ?? 0) + 1;
  console.log(counts, `zones indexed: ${zones.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) await main();
