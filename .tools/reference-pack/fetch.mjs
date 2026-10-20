import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { concatParts, listParts, safeRelative, sha256File } from './lib.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const inline = argv.find(argument => argument.startsWith(`--${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 3);
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? fallback : argv[at + 1];
};

const source = resolve(option('source', 'ref'));
const slug = option('map', 'kino');
const out = resolve(option('out', '.work/reference'));
const classes = new Set(String(option('classes', 'boot,background,lazy')).split(',').map(value => value.trim()).filter(Boolean));
const only = option('only') ? new RegExp(option('only'), 'i') : null;

const exists = async path => access(path).then(() => true, () => false);

const crlfMatches = async (file, expected) => {
  const text = (await readFile(file)).toString('latin1').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  return createHash('sha256').update(Buffer.from(text, 'latin1')).digest('hex') === expected;
};

const mapRoot = slug === 'five' ? source : join(source, slug);
const manifestFile = join(mapRoot, 'manifest.json');
const packRoot = join(mapRoot, 'pack');

if (!(await exists(manifestFile))) {
  console.error(`No manifest at ${manifestFile}. Check --source and --map.`);
  process.exit(2);
}

const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const assembledRoot = join(out, 'assembled');
await rm(assembledRoot, { recursive: true, force: true });
await mkdir(assembledRoot, { recursive: true });

const entries = [];
const totals = {};
const bump = status => { totals[status] = (totals[status] ?? 0) + 1; };

for (const entry of manifest.files) {
  if (!classes.has(entry.class ?? entry.priority)) continue;
  if (only && !only.test(entry.path)) continue;
  const relative = safeRelative(entry.path);
  if (!relative) {
    bump('rejected-path');
    entries.push({ path: entry.path, kind: entry.kind, status: 'rejected-path' });
    continue;
  }
  const record = { path: relative, kind: entry.kind, size: entry.size, status: 'missing', file: null };
  const whole = join(packRoot, relative);
  const parts = await listParts(`${whole}.part`);
  const fallbackHash = entry.fallback?.sha256;
  if (await exists(whole)) {
    const hash = await sha256File(whole);
    if (hash === entry.sha256) Object.assign(record, { status: 'ok', file: whole });
    else if (fallbackHash && hash === fallbackHash) Object.assign(record, { status: 'ok-fallback', file: whole, size: entry.fallback.size });
    else if (entry.size < 1048576 && (await crlfMatches(whole, entry.sha256))) Object.assign(record, { status: 'ok-line-endings', file: whole });
    else Object.assign(record, { status: 'mismatch', detail: `sha256 ${hash.slice(0, 16)} does not match the manifest` });
  } else if (parts) {
    const target = join(assembledRoot, relative);
    const hash = await concatParts(parts, target);
    if (hash === entry.sha256) Object.assign(record, { status: 'ok-assembled', file: target, parts: parts.length });
    else {
      await rm(target, { force: true });
      Object.assign(record, { status: 'mismatch', detail: `assembled sha256 ${hash.slice(0, 16)} does not match the manifest` });
    }
  } else if ((await exists(`${whole}.kop`)) || (await listParts(`${whole}.kop.part`))) {
    record.status = 'opus-only';
  }
  bump(record.status);
  entries.push(record);
}

const resolved = {
  map: manifest.map,
  slug,
  version: manifest.version,
  classBytes: manifest.class_bytes,
  totals,
  entries
};
await writeFile(join(out, 'resolved.json'), JSON.stringify(resolved, null, 1));

console.log(`map ${manifest.map} (${slug}), manifest ${manifest.version.slice(0, 12)}`);
console.log(Object.entries(totals).map(([status, count]) => `${status}: ${count}`).join('  '));
for (const record of entries.filter(item => item.status === 'mismatch')) console.error(`MISMATCH ${record.path}: ${record.detail}`);
for (const record of entries.filter(item => item.status === 'missing').slice(0, 20)) console.warn(`missing ${record.path}`);
process.exit(totals.mismatch || totals['rejected-path'] ? 1 : 0);
