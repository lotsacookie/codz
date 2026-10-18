// Regenerates export/web/maps/bsp/maps.json from the .bsp files (and their .txt/.mb2/.nsz/.way sidecars).
// Run after adding or removing maps:  npm run build:bsp-index
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseBsp, summarizeEntities } from '../export/web/custom-maps/bsp-parse.js';

const dir = path.resolve(import.meta.dirname, '..', 'export', 'web', 'maps', 'bsp');
const unwrap = lines => lines.map(l => l.trim()).filter(Boolean).reduce((out, line) => (out.endsWith('-') ? out.slice(0, -1) + line : (out ? `${out} ${line}` : line)), '');
const pretty = id => id.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const maps = [];
for (const file of readdirSync(dir).filter(name => /\.bsp$/i.test(name)).sort()) {
  const id = file.replace(/\.bsp$/i, '');
  const side = ext => path.join(dir, `${id}.${ext}`);
  let title = pretty(id), description = '', author = '';
  if (existsSync(side('txt'))) {
    const lines = readFileSync(side('txt'), 'latin1').split(/\r?\n/);
    title = lines[0]?.trim() || title;
    author = lines[9]?.trim() ?? '';
    description = unwrap(lines.slice(1, 9));
  }
  let summary = {}, faces = 0;
  try {
    const parsed = parseBsp(readFileSync(path.join(dir, file)));
    summary = summarizeEntities(parsed.entities);
    faces = parsed.faces.length;
  } catch (error) {
    console.warn(`skipping ${file}: ${error.message}`);
    continue;
  }
  maps.push({
    id, title, author, description, file, size: statSync(path.join(dir, file)).size, faces,
    ...summary,
    hasZones: existsSync(side('nsz')), hasWaypoints: existsSync(side('way')),
  });
}
writeFileSync(path.join(dir, 'maps.json'), JSON.stringify({ version: 1, maps }, null, 2) + '\n');
console.log(`Wrote ${maps.length} maps to maps/bsp/maps.json`);
