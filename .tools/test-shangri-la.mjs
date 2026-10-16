import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'artifacts/shangri-la');
fs.mkdirSync(out, {recursive: true});
const savedUrl = path.join(root, 'artifacts/shangri-la-url.txt');
const url = process.env.SHANGRI_LA_URL || (fs.existsSync(savedUrl) ? fs.readFileSync(savedUrl, 'utf8').trim() : 'http://127.0.0.1:5173/?map=shangri-la');
const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/opt/pw-browsers/chromium'].find(fs.existsSync);
const browser = await chromium.launch({executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: 1280, height: 720}});
const errors = [], failed = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
page.on('response', r => {if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);});
function check(name, passed, details = null) {
  if (!passed) throw new Error(`${name}: ${JSON.stringify(details)}`);
  console.log('PASS', name);
}
const snapshot = () => page.evaluate(() => shangriLa.debug.snapshot());
try {
  await page.goto(url, {waitUntil: 'load', timeout: 180000});
  await page.waitForFunction(() => window.shangriLa?.ready, null, {timeout: 240000});
  const start = await snapshot();
  check('Survival map loads with the player grounded', start.grounded && start.combat.phase === 'preparing', start);
  await page.evaluate(() => { shangriLa.debug.resume(); });
  await page.waitForFunction(() => shangriLa.debug.snapshot().combat.phase === 'fighting', null, {timeout: 20000});
  await page.waitForFunction(() => shangriLa.debug.snapshot().combat.enemies.length > 0, null, {timeout: 30000});
  const fight = await snapshot();
  check('Round 1 spawns zombies that path toward the player', fight.combat.enemies.some(z => z.pathLength > 1), fight.combat.enemies);
  check('No power until both switches are thrown', fight.power === false, fight);
  check('No resource errors', !errors.length && !failed.length, {errors, failed});
} finally {
  await browser.close();
}
