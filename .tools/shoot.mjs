#!/usr/bin/env node
// Headless render check for the composed Kino scene.
//   node .tools/shoot.mjs [url] [out.png]
// Uses SwiftShader so it renders the same with or without a GPU.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:5173/?map=kino';
const OUT = process.argv[3] || 'artifacts/kino.png';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

const executablePath = CANDIDATES.find(p => existsSync(p));
if (!executablePath) throw new Error('no Chrome/Edge found; set BROWSER_PATH');

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const notFound = [];
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', e => errors.push(String(e)));
page.on('response', r => r.status() === 404 && notFound.push(r.url()));

await page.goto(URL, { waitUntil: 'load' });

// The scene is large; wait for the loader to report ready rather than a timer.
// Signature is (fn, arg, options) -- options must go third or the default
// 30s timeout applies and the 54 MB buffer will not have finished loading.
await page.waitForFunction(
  () => document.getElementById('s-status')?.textContent === 'ready',
  null,
  { timeout: 180000 },
);

// The splash sits at 90% opacity over the scene; it would dominate the capture.
await page.evaluate(() => document.getElementById('splash')?.classList.add('hidden'));

// Let a few frames run so the stats read something real.
await page.waitForTimeout(3000);

await page.screenshot({ path: OUT });

// Read the HUD *after* the capture. Sampling before it catches the first frames,
// while textures are still uploading, and reports an empty fast-drawing scene.
const stats = await page.evaluate(() => ({
  status: document.getElementById('s-status').textContent,
  tris: document.getElementById('s-tris').textContent,
  calls: document.getElementById('s-calls').textContent,
  fps: document.getElementById('s-fps').textContent,
}));
console.log('stats :', JSON.stringify(stats));
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
console.log('404s  :', notFound.length ? `${notFound.length}: ${notFound.slice(0, 5).join(', ')}` : 'none');
console.log('wrote :', OUT);

await browser.close();
