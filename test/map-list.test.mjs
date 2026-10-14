import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const web = path.resolve(import.meta.dirname, '..', 'export', 'web');
const html = readFileSync(path.join(web, 'index.html'), 'utf8');
const entries = [...html.matchAll(/<button type="button" data-map="([^"]+)"([^>]*)>/g)].map(match => ({
  id: match[1],
  attributes: Object.fromEntries([...match[2].matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])),
}));

test('the page lists every map once', () => {
  assert.deepEqual(entries.map(entry => entry.id), ['kino', 'moon', 'shangri-la', 'ascension', 'call-of-the-dead']);
});

test('each map has a layout template, a module and stylesheets that exist', () => {
  for (const { id, attributes } of entries) {
    assert.ok(html.includes(`<template id="map-${id}">`), `${id} template`);
    assert.ok(existsSync(path.join(web, attributes.module)), `${id} module`);
    for (const style of attributes.styles.split(/\s+/).filter(Boolean)) assert.ok(existsSync(path.join(web, style)), `${id} ${style}`);
  }
});

test('the page itself loads no map code or map assets', () => {
  const outside = html.replace(/<template[\s\S]*?<\/template>/g, '');
  assert.equal([...outside.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(match => match[1]).join(), 'launcher.js');
  assert.deepEqual([...outside.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(match => match[1]), ['launcher.css']);
  assert.ok(!/<(?:img|audio|video)\b/.test(outside));
});

test('map markup stays inside inert templates so ids cannot clash', () => {
  const outside = html.replace(/<template[\s\S]*?<\/template>/g, '');
  for (const id of ['menu', 'hud', 'status', 'crosshair', 'debug']) assert.ok(!outside.includes(`id="${id}"`), id);
});

test('the loader fixes hold: Moon uses the resilient map loader and viewers keep mobile textures out of map folders', () => {
  const moon = readFileSync(path.join(web, 'moon.js'), 'utf8');
  assert.ok(moon.includes("loadMapGltf('moon/moon.gltf'") && !moon.includes('new GLTFLoader'));
  const runtime = readFileSync(path.join(web, 'runtime-assets.js'), 'utf8');
  assert.ok(!runtime.includes(".replace('/textures/', '/textures-mobile/')"));
});
