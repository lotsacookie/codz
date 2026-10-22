import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const web = path.resolve(import.meta.dirname, '..', 'export', 'web');
const assets = path.join(web, 'assets'), js = path.join(assets, 'js');
const html = readFileSync(path.join(web, 'index.html'), 'utf8');
const entries = [...html.matchAll(/<button type="button" data-map="([^"]+)"([^>]*)>/g)].map(match => ({
  id: match[1],
  attributes: Object.fromEntries([...match[2].matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])),
}));
const count = pattern => (html.match(pattern) ?? []).length;

test('the page lists every map once', () => {
  assert.deepEqual(entries.map(entry => entry.id), ['kino', 'moon', 'shangri-la', 'ascension', 'call-of-the-dead', 'one-window-challenge']);
});

test('each map has a module that mounts into the shell and stylesheets that exist', () => {
  for (const { id, attributes } of entries) {
    assert.ok(existsSync(path.join(js, attributes.module)), `${id} module`);
    assert.match(readFileSync(path.join(js, attributes.module), 'utf8'), /export async function mount\(ctx\)/, `${id} exports mount(ctx)`);
    for (const style of attributes.styles.split(/\s+/).filter(Boolean)) assert.ok(existsSync(path.join(assets, style)), `${id} ${style}`);
  }
});

test('there is exactly one viewport, HUD and pause menu, and no per-map templates', () => {
  for (const id of ['viewport', 'hud', 'pause', 'stage', 'preload']) assert.equal(count(new RegExp(`id="${id}"`, 'g')), 1, id);
  assert.equal(count(/<template/g), 0);
  assert.equal(count(/id="start"/g), 1);
  assert.equal(count(/id="points"/g), 1);
});

test('the page loads only the shell, and no map code or assets', () => {
  assert.deepEqual([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(match => match[1]), ['js/orientation.js', 'js/shell.js']);
  assert.deepEqual([...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(match => match[1]), ['shell.css']);
});

test('maps never touch the page chrome directly', () => {
  for (const { attributes } of entries) {
    const code = readFileSync(path.join(js, attributes.module), 'utf8');
    assert.ok(!/document\.body\.prepend|getElementById\(['"](?:menu|start)['"]\)/.test(code), `${attributes.module} stays inside the shell`);
  }
});

test('the shell tears a map down: disposers, renderer, HUD, styles and caches, but not downloaded packs', () => {
  const shell = readFileSync(path.join(js, 'shell.js'), 'utf8');
  for (const call of ['holder.dispose()', 'disposeRenderer(old.renderer)', 'hud.reset()', 'releaseRuntime()', 'assets.releaseTransient()', 'releaseModelCache()', 'link.remove()']) assert.ok(shell.includes(call), call);
  const loader = readFileSync(path.join(js, 'asset-loader.js'), 'utf8');
  assert.ok(/releaseTransient\(\)[\s\S]*?this\.blobUrls\.clear\(\)/.test(loader));
  assert.ok(!/releaseTransient\(\)[\s\S]{0,400}this\.packs\.clear/.test(loader), 'packs survive teardown');
});

test('the launcher preloads shared packs with a progress bar in the bottom-left corner', () => {
  assert.ok(html.includes('id="preload-bar"'));
  assert.ok(readFileSync(path.join(js, 'shell.js'), 'utf8').includes('preloadShared()'));
  assert.match(readFileSync(path.join(assets, 'shell.css'), 'utf8'), /#preload\{position:fixed;[^}]*left:[^}]*bottom:/);
});

test('the loader fixes hold: Moon uses the resilient map loader and viewers keep mobile textures out of map folders', () => {
  const moon = readFileSync(path.join(js, 'maps', 'moon.js'), 'utf8');
  assert.ok(moon.includes("loadMapGltf('moon/moon.gltf'") && !moon.includes('new GLTFLoader'));
  const runtime = readFileSync(path.join(js, 'runtime-assets.js'), 'utf8');
  assert.ok(!runtime.includes(".replace('/textures/', '/textures-mobile/')"));
});

test('the launcher is a flat button list with Multiplayer and one Custom Maps entry and a detail panel, and no image rows', () => {
  assert.ok(!html.includes('mapselect-'), 'old image menu is gone');
  assert.deepEqual([...html.matchAll(/<button type="button" data-menu="([^"]+)"/g)].map(match => match[1]), ['multiplayer', 'custom-maps']);
  assert.ok(!/NZ:P Maps<\/strong>|Black Ops 3 Workshop<\/strong>/.test(html), 'NZ:P and Workshop live inside Custom Maps');
  assert.ok(html.includes('id="map-detail"'));
  assert.ok(!existsSync(path.join(assets, 'art', 'mapselect-supported.webp')));
});
