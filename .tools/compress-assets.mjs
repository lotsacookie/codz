import { createReadStream, createWriteStream, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createGzip, constants } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? join(import.meta.dirname, '..', 'export', 'web'));
const MIN = 1 << 20;
const manifest = {};
for (const name of readdirSync(root)) {
  const file = join(root, name);
  if (!name.endsWith('.bin') || statSync(file).size < MIN) continue;
  const head = Buffer.alloc(40); const fd = (await import('node:fs')).openSync(file, 'r'); (await import('node:fs')).readSync(fd, head, 0, 40, 0); (await import('node:fs')).closeSync(fd);
  if (head.toString().startsWith('version https://git-lfs')) { console.error(`skip ${name}: Git LFS pointer (run git lfs pull first)`); continue; }
  await pipeline(createReadStream(file), createGzip({ level: constants.Z_BEST_COMPRESSION }), createWriteStream(file + '.gz'));
  const raw = statSync(file).size, gz = statSync(file + '.gz').size;
  manifest[name] = { gz: name + '.gz', size: raw, gzSize: gz };
  console.log(`${name}: ${(raw / 1048576).toFixed(1)} MB -> ${(gz / 1048576).toFixed(1)} MB (${(100 * gz / raw).toFixed(0)}%)`);
}
writeFileSync(join(root, 'asset-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`wrote asset-manifest.json (${Object.keys(manifest).length} files)`);
