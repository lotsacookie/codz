// Extracts vfx/sfx source assets from fetched reference packs (see fetch.mjs, which writes resolved.json).
// Existing output files are never replaced unless --overwrite is passed. --report-dir keeps reports out of the output tree.
//   node extract.mjs --resolved .work/reference/resolved.json --out .work/extracted [--only REGEX] [--kinds images,sounds,fx,scripts,animations,models,raw]
// images: IWI -> PNG (decodeIwi). sounds: IWD .wav/.flac and KSPK clips, copied as-is (decode with ffmpeg later).
// scripts: GSC/CSC/other raw files stored in .ff zones (zlib payloads), written as plain text under scripts/.
// fx: names found in .ff zones that look like effects/particles (FX_PATTERN), written to fx-index.json. raw: other IWD entries.
// animations/models: XAnimParts and XModel assets walked out of the .ff zones by zone-assets.py (python3), one JSON per asset under animations/ and models/,
// with animations-index.json and models-index.json listing the names per zone. Names starting with a comma are empty reference stubs: they are listed
// under references and not written, so they cannot take the place of the real asset. IWD entries that look like xanim/xmodel files are copied as-is.
import { mkdir, mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { FX_PATTERN, openZip, openKspk, inflateZone, scanNames, scanRawFiles, decodeIwi, encodePng, safeRelative } from './lib.mjs';

const execFileAsync = promisify(execFile);
const ZONE_ASSETS_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'zone-assets.py');
export const ZONE_ASSET_KINDS = ['animations', 'models'];

export function classifyEntry(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('/')) return 'dir';
  if (/\.iwi$/.test(lower)) return 'images';
  if (/\.(wav|flac|ogg|mp3)$/.test(lower)) return 'sounds';
  if (/(^|\/)xanim(_parts)?\//.test(lower) || /\.(xanim|xanim_parts)$/.test(lower)) return 'animations';
  if (/(^|\/)xmodel(surfs|parts)?\//.test(lower) || /\.(xmodel|xmodelsurfs|xmodelpart|glb|gltf)$/.test(lower)) return 'models';
  return 'raw';
}

export function zoneAssetKinds(kinds) {
  return ZONE_ASSET_KINDS.filter(kind => kinds.has(kind));
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

export async function extractZoneAssets(file, zoneName, { out, kinds, only, report, overwrite, python = process.env.ZONE_ASSETS_PYTHON || 'python3' }) {
  const walkKinds = zoneAssetKinds(kinds);
  const work = await mkdtemp(join(tmpdir(), 'zone-assets-'));
  const reportFile = join(work, 'report.json');
  const args = [ZONE_ASSETS_SCRIPT, '--zone', file, '--zone-name', zoneName, '--out', out, '--kinds', walkKinds.join(','), '--report', reportFile];
  if (only) args.push('--only', only.source);
  if (overwrite) args.push('--overwrite');
  try {
    await execFileAsync(python, args, { maxBuffer: 1 << 26 });
    const result = JSON.parse(await readFile(reportFile, 'utf8'));
    report.push(...result.rows);
    if (result.resyncs) report.push({ archive: zoneName, kind: 'zone', status: 'resynced', count: result.resyncs, warnings: result.warnings });
    if (result.summary.unnamed.length) report.push({ archive: zoneName, kind: 'zone', status: 'unnamed-summary', unnamed: result.summary.unnamed, samples: result.summary.samples });
    console.log(`${zoneName}: ${result.status}, ${result.assets} assets walked, ${result.resyncs} resyncs`, result.types);
    if (result.error) console.log(`  walk error: ${result.error}`);
    for (const [kind, field, count] of result.summary.unnamed.slice(0, 5)) console.log(`  unnamed ${kind} x${count}: ${field}`);
    return { zone: zoneName, status: result.status, error: result.error, assets: result.assets, resyncs: result.resyncs, types: result.types, index: result.index };
  } catch (error) {
    report.push({ archive: zoneName, kind: 'zone', status: `zone-assets failed: ${String(error.message).split('\n')[0]}` });
    return { zone: zoneName, status: 'failed', assets: 0, index: {} };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
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
  const walked = { animations: [], models: [] };
  for (const item of resolved.entries) {
    if (!item.file || !String(item.status).startsWith('ok')) continue;
    if (item.kind === 'iwd' || item.kind === 'iw_00') await extractArchive(item.file, { out, kinds, only, report, overwrite });
    else if (item.kind === 'loaded-sound' && kinds.has('sounds')) await extractSoundPack(item.file, { out, only, report, overwrite });
    else if (item.kind === 'zone') {
      if (kinds.has('fx') || kinds.has('scripts')) {
        const zone = inflateZone(await readFile(item.file));
        if (zone.error) report.push({ archive: item.path, kind: 'zone', status: zone.error });
        else {
          if (kinds.has('fx')) zones.push(await indexZone(item.path, zone.data));
          if (kinds.has('scripts')) await extractScripts(item.path, zone.data, { out, report, overwrite });
        }
      }
      if (zoneAssetKinds(kinds).length) {
        const result = await extractZoneAssets(item.file, item.path, { out, kinds, only, report, overwrite });
        for (const kind of zoneAssetKinds(kinds)) {
          const found = result.index[kind];
          if (found?.names.length || found?.references.length) walked[kind].push({ zone: item.path, names: found.names, references: found.references });
        }
      }
    }
  }
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, 'extract-report.json'), JSON.stringify(report, null, 1));
  if (zones.length) await writeFile(join(reportDir, 'fx-index.json'), JSON.stringify(zones, null, 1));
  for (const kind of zoneAssetKinds(kinds)) if (walked[kind].length) await writeFile(join(reportDir, `${kind}-index.json`), JSON.stringify(walked[kind], null, 1));
  const counts = {};
  for (const row of report) counts[`${row.kind}:${row.status}`] = (counts[`${row.kind}:${row.status}`] ?? 0) + 1;
  console.log(counts, `zones indexed: ${zones.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) await main();
