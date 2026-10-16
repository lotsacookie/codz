import assert from 'node:assert/strict';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { compactCollision } from './compact-collision.mjs';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'export', 'web');
const destination = path.join(root, '.work', 'cloudflare-pages');
const limit = 24 * 1024 * 1024;
const included = new Set();
mkdirSync(destination, { recursive: true });

function write(relative, contents) {
  assert(!path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'));
  const output = path.join(destination, relative);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, contents);
  included.add(relative.replaceAll('\\', '/'));
}

function copy(relative) {
  const input = path.join(source, relative);
  if (statSync(input).isDirectory()) {
    for (const name of readdirSync(input)) copy(path.join(relative, name));
    return;
  }
  assert(statSync(input).size <= limit, `Oversized asset: ${relative}`);
  const output = path.join(destination, relative);
  mkdirSync(path.dirname(output), { recursive: true });
  copyFileSync(input, output);
  included.add(relative.replaceAll('\\', '/'));
}

// Include only Kino's entry point, modules and local runtime assets.
const modules = new Set();
function includeModule(relative) {
  if (modules.has(relative)) return;
  modules.add(relative);
  const code = readFileSync(path.join(source, relative), 'utf8');
  copy(relative);
  for (const match of code.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
    includeModule(path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])));
  }
}
includeModule('shell.js');
includeModule('maps/kino.js');
for (const file of ['shell.css', 'touch-controls.css', 'hud.css', 'game-data.json', 'navigation.bin',
  'art/mapselect-supported.webp', 'art/mapselect-row-kino.webp', 'art/mapselect-hl-kino.webp', 'art/mapselect-panel-kino.webp', 'art/loadscreen_zombie_theater.webp']) copy(file);
const kinoOnlyPage = readFileSync(path.join(source, 'index.html'), 'utf8')
  .replace(/\s*<li><button type="button" data-map="(?!kino")[^"]*"[\s\S]*?<\/li>/g, '');
assert(kinoOnlyPage.includes('data-map="kino"') && !/data-map="(?!kino")/.test(kinoOnlyPage), 'Staged map list must contain only Kino');
write('index.html', kinoOnlyPage);
for (const directory of ['animations', 'audio', 'models', 'textures', 'textures-mobile', 'vendor', 'social']) copy(directory);

// glTF supports multiple buffers natively. Repack complete buffer views with
// four-byte alignment, and verify every view against the original geometry.
const original = JSON.parse(readFileSync(path.join(source, 'kino.gltf'), 'utf8'));
const gltf = structuredClone(original);
const inputs = original.buffers.map(buffer => readFileSync(path.join(source, buffer.uri)));
const chunks = [];
let pieces = [], size = 0;
function flush() {
  if (!size) return;
  chunks.push(Buffer.concat(pieces, size));
  pieces = [];
  size = 0;
}
for (let i = 0; i < gltf.bufferViews.length; i++) {
  const view = gltf.bufferViews[i];
  const input = original.bufferViews[i];
  assert(view.byteLength <= limit, `Oversized glTF view ${i}`);
  let padding = (4 - size % 4) % 4;
  if (size + padding + view.byteLength > limit) { flush(); padding = 0; }
  if (padding) { pieces.push(Buffer.alloc(padding)); size += padding; }
  view.buffer = chunks.length;
  view.byteOffset = size;
  const bytes = inputs[input.buffer].subarray(input.byteOffset ?? 0, (input.byteOffset ?? 0) + input.byteLength);
  assert.equal(bytes.length, input.byteLength);
  pieces.push(bytes);
  size += bytes.length;
}
flush();
gltf.buffers = chunks.map((bytes, i) => {
  const uri = `kino-part-${i}.bin`;
  write(uri, bytes);
  return { uri, byteLength: bytes.length };
});
for (let i = 0; i < gltf.bufferViews.length; i++) {
  const view = gltf.bufferViews[i], input = original.bufferViews[i];
  assert(chunks[view.buffer].subarray(view.byteOffset, view.byteOffset + view.byteLength)
    .equals(inputs[input.buffer].subarray(input.byteOffset ?? 0, (input.byteOffset ?? 0) + input.byteLength)), `Changed glTF view ${i}`);
}
write('kino.gltf', JSON.stringify(gltf));

// Reassemble these parts in the collision loader, preserving the baked BVH.
const originalCollision = JSON.parse(readFileSync(path.join(source, 'collision.json'), 'utf8'));
const originalBinary = readFileSync(path.join(source, originalCollision.binary));
assert.equal(originalBinary.length, originalCollision.byteLength);
const { metadata: collision, binary, report: collisionCompaction } = compactCollision(originalCollision, originalBinary);
collision.binaryParts = [];
for (let offset = 0; offset < binary.length; offset += limit) {
  const bytes = binary.subarray(offset, offset + limit);
  const uri = `collision-part-${collision.binaryParts.length}.bin`;
  write(uri, bytes);
  collision.binaryParts.push({ uri, byteLength: bytes.length });
}
delete collision.binary;
assert(Buffer.concat(collision.binaryParts.map(part => readFileSync(path.join(destination, part.uri)))).equals(binary));
write('collision.json', JSON.stringify(collision));
// Remove only obsolete generated collision parts inside this exact output
// directory; a smaller lossless collision buffer may need fewer parts.
for (const name of readdirSync(destination)) {
  if (!/^collision-part-\d+\.bin$/.test(name) || included.has(name)) continue;
  const file = path.resolve(destination, name);
  assert.equal(path.dirname(file), destination);
  assert(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
  unlinkSync(file);
}
write('404.html', '<!doctype html><html lang="en"><meta charset="utf-8"><title>Page not found</title><h1>Page not found</h1><a href="/">Play Kino der Toten</a></html>');
write('_headers', '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/*.bin\n  Content-Type: application/octet-stream\n/*.gltf\n  Content-Type: model/gltf+json\n/*.js\n  Cache-Control: no-cache\n/*.html\n  Cache-Control: no-cache\n/*.css\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n');

let count = 0, bytes = 0, largest = 0;
function validate(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Symlinks are not allowed in the deployment');
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { validate(file); continue; }
    const relative = path.relative(destination, file).replaceAll('\\', '/');
    assert(included.has(relative), `Unexpected file in deployment: ${relative}. Use a fresh output directory.`);
    const length = statSync(file).size;
    assert(length <= 25 * 1024 * 1024, `Cloudflare file limit: ${relative}`);
    count++; bytes += length; largest = Math.max(largest, length);
  }
}
validate(destination);
assert(count < 20000, 'Cloudflare file count limit');
assert(!existsSync(path.join(destination, 'moon.html')));
mkdirSync(path.join(root, 'artifacts', 'cloudflare'), { recursive: true });
const report = { directory: destination, files: count, bytes, largestFile: largest,
  geometryParts: chunks.length, collisionParts: collision.binaryParts.length, verifiedGeometryViews: gltf.bufferViews.length,
  collisionBytesVerified: binary.length, collisionCompaction, maps: ['kino'] };
writeFileSync(path.join(root, 'artifacts', 'cloudflare', 'stage.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
