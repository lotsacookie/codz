// Scaffold a solo-survival map: node .tools/new-map.mjs <id> "<Label>" [loadscreen.webp]
// Creates export/web/maps/<id>.js (config only), adds the launcher button to index.html and
// the pack name to build-asset-pack.mjs. Map data (gltf, collision, navigation, map-data.json)
// still has to be baked into export/web/<id>/ by the usual .tools/bake-* scripts.
import fs from 'node:fs';
import path from 'node:path';

const [id, label, loadscreen = `art/loadscreen_zombie_${id.replace(/-/g, '_')}.webp`] = process.argv.slice(2);
if (!id || !label || !/^[a-z0-9-]+$/.test(id)) { console.error('usage: node .tools/new-map.mjs <id> "<Label>" [loadscreen]'); process.exit(1); }
const web = path.resolve(import.meta.dirname, '../export/web');
const file = path.join(web, 'maps', `${id}.js`);
if (fs.existsSync(file)) { console.error(`${file} already exists`); process.exit(1); }
fs.writeFileSync(file, `import { createSurvivalMap } from './survival-map.js';

const map = createSurvivalMap({
  id: '${id}',
  label: '${label}',
  base: './${id}',
  // Optional: lighting, fov, far, player, controls, startHint, classes: { session, enemies, features, navigation }
});

export async function mount(ctx) { return map.mount(ctx); }
`);
const indexPath = path.join(web, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const button = `      <li><button type="button" data-map="${id}" data-label="${label}" data-module="./maps/${id}.js" data-styles="touch-controls.css hud.css" data-title="${label} — Zombies" data-loadscreen="${loadscreen}"><strong>${label}</strong><span>Solo survival.</span></button></li>\n`;
const last = html.lastIndexOf('</li>');
const end = html.indexOf('\n', last) + 1;
html = html.slice(0, end) + button + html.slice(end);
fs.writeFileSync(indexPath, html);
const packPath = path.resolve(import.meta.dirname, 'build-asset-pack.mjs');
const pack = fs.readFileSync(packPath, 'utf8');
if (!pack.includes(`'${id}'`)) fs.writeFileSync(packPath, pack.replace(/(MAP_PACKS = \[)([^\]]*)\]/, (_, a, b) => `${a}${b}, '${id}']`));
console.log(`Added ${id}. Next: bake data into export/web/${id}/, run npm run build:pack, update test/map-list.test.mjs.`);
