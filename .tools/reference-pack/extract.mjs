// Extracts vfx/sfx source assets from fetched reference packs (see fetch.mjs, which writes resolved.json).
//   node extract.mjs --resolved .work/reference/resolved.json --out .work/extracted [--only REGEX] [--kinds images,sounds,fx,raw]
// images: IWI -> PNG (decodeIwi). sounds: IWD .wav/.flac and KSPK clips, copied as-is (decode with ffmpeg later).
// fx: names found in .ff zones that look like effects/particles (FX_PATTERN), written to fx-index.json. raw: other IWD entries.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { FX_PATTERN, openZip, openKspk, inflateZone, scanNames, decodeIwi, encodePng, safeRelative } from './lib.mjs';

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

async function put(out, relative, data) {
  const safe = safeRelative(relative);
  if (!safe) return null;
  const file = join(out, safe);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, data);
  return safe;
}

export async function extractArchive(file, { out, kinds, only, report }) {
  const zip = await openZip(file);
  try {
    for (const entry of zip.entries) {
      const kind = classifyEntry(entry.name);
      if (kind === 'dir' || !kinds.has(kind) || (only && !only.test(entry.name))) continue;
      const raw = await zip.read(entry);
      const record = { archive: file, entry: entry.name, kind, sha256: createHash('sha256').update(raw).digest('hex') };
      if (kind === 'images') {
        const result = iwiToPng(raw);
        if (result.error) { report.push({ ...record, status: result.error, format: result.format }); continue; }
        record.file = await put(out, `images/${entry.name.replace(/^images\//i, '').replace(/\.iwi$/i, '.png')}`, result.png);
        Object.assign(record, { width: result.width, height: result.height, format: result.format });
      } else record.file = await put(out, `${kind}/${entry.name}`, raw);
      report.push({ ...record, status: record.file ? 'ok' : 'rejected-path' });
    }
  } finally { await zip.close(); }
}

export async function extractSoundPack(file, { out, only, report }) {
  const pack = await openKspk(file);
  try {
    for (const record of pack.records) {
      if (only && !only.test(record.name)) continue;
      const data = await pack.read(record);
      const saved = await put(out, `sounds/${record.name}`, data);
      report.push({ archive: file, entry: record.name, kind: 'sounds', sha256: record.sha256, file: saved, status: saved ? 'ok' : 'rejected-path' });
    }
  } finally { await pack.close(); }
}

export async function indexZone(file, buffer) {
  const zone = inflateZone(buffer);
  if (zone.error) return { zone: file, error: zone.error };
  return { zone: file, names: fxNames(scanNames(zone.data)) };
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => { const at = argv.indexOf(`--${name}`); return at < 0 ? fallback : argv[at + 1]; };
  const resolvedFile = resolve(option('resolved', '.work/reference/resolved.json'));
  const out = resolve(option('out', '.work/extracted'));
  const kinds = new Set(String(option('kinds', 'images,sounds,fx')).split(',').map(value => value.trim()));
  const only = option('only') ? new RegExp(option('only'), 'i') : null;
  const resolved = JSON.parse(await readFile(resolvedFile, 'utf8'));
  const report = [], zones = [];
  for (const item of resolved.entries) {
    if (!item.file || !String(item.status).startsWith('ok')) continue;
    if (item.kind === 'iwd' || item.kind === 'iw_00') await extractArchive(item.file, { out, kinds, only, report });
    else if (item.kind === 'loaded-sound' && kinds.has('sounds')) await extractSoundPack(item.file, { out, only, report });
    else if (item.kind === 'zone' && kinds.has('fx')) zones.push(await indexZone(item.path, await readFile(item.file)));
  }
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'extract-report.json'), JSON.stringify(report, null, 1));
  if (zones.length) await writeFile(join(out, 'fx-index.json'), JSON.stringify(zones, null, 1));
  const counts = {};
  for (const row of report) counts[`${row.kind}:${row.status}`] = (counts[`${row.kind}:${row.status}`] ?? 0) + 1;
  console.log(counts, `zones indexed: ${zones.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) await main();
