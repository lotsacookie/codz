import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'artifacts/shangri-la');
fs.mkdirSync(out, {recursive: true});
const savedUrl = path.join(root, 'artifacts/shangri-la-url.txt');
const url = process.env.SHANGRI_LA_URL || (fs.existsSync(savedUrl) ? fs.readFileSync(savedUrl, 'utf8').trim() : 'http://127.0.0.1:5173/?map=shangri-la');
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const browser = await chromium.launch({executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const errors = [], failed = [], checks = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
page.on('response', r => {if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);});
page.on('requestfailed', r => failed.push(`${r.url()} ${r.failure()?.errorText}`));
function check(name, passed, details = null) {
  checks.push({name, passed: Boolean(passed), details});
  if (!passed) throw new Error(`${name}: ${JSON.stringify(details)}`);
  console.log('PASS', name);
}
const snapshot = () => page.evaluate(() => shangriLa.debug.snapshot());
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
try {
  await page.goto(url, {waitUntil: 'load', timeout: 180000});
  await page.waitForFunction(() => window.shangriLa?.ready || document.getElementById('status').textContent.includes('could not load'), null, {timeout: 180000});
  check('Native Shangri-La assets load', await page.evaluate(() => !!window.shangriLa?.ready), await page.locator('#status').textContent());
  await page.waitForTimeout(1200);
  const spawn = await snapshot();
  check('Map renders immediately without a landing page', spawn.drawCalls > 0 && spawn.triangles > 10000 && !spawn.active && await page.locator('#status').isHidden(), spawn);
  // Native spawn markers sit above the sloped stone floor. Gravity settles the
  // capsule onto that floor; the marker's Z is not the floor elevation.
  check('Original spawn settles onto the map floor', spawn.grounded && Math.abs(spawn.feet[0] - 80) < 15 && Math.abs(spawn.feet[2] - 503.5) < 15 && spawn.feet[1] > -10 && spawn.feet[1] < 35, spawn);
  check('Static instances optimized', spawn.optimization.instances > 1000, spawn.optimization);
  await page.screenshot({path: path.join(out, 'spawn.png')});
  await page.locator('canvas').click();
  await page.waitForFunction(() => shangriLa.debug.snapshot().active);
  await page.keyboard.down('KeyS'); await page.waitForTimeout(700); await page.keyboard.up('KeyS');
  const blocked = await snapshot();
  check('The native Quick Revive prop behind spawn blocks walking', blocked.feet[2] < 530 && distance(spawn.feet, blocked.feet) < 30, blocked);
  await page.keyboard.press('KeyR');
  await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW');
  await page.waitForTimeout(150);
  const moved = await snapshot();
  check('Walking uses the shared controller and floor collision', moved.grounded && distance(spawn.feet, moved.feet) > 40 && distance(spawn.feet, moved.feet) < 240, moved);
  await page.keyboard.press('Space');
  await page.waitForTimeout(140);
  const jumped = await snapshot();
  check('Jump leaves the ground', !jumped.grounded && jumped.feet[1] > moved.feet[1] + 5, jumped);
  await page.waitForTimeout(900);
  check('Jump lands on the map', (await snapshot()).grounded);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !shangriLa.debug.snapshot().active);
  const paused = await snapshot();
  await page.keyboard.down('KeyW'); await page.waitForTimeout(300); await page.keyboard.up('KeyW');
  check('Esc releases the mouse and stops movement', distance(paused.position, (await snapshot()).position) < .01);
  // Chromium's pointer-lock cooldown also applies to rapid automation clicks.
  await page.waitForTimeout(1300);
  await page.locator('canvas').click();
  await page.waitForFunction(() => shangriLa.debug.snapshot().active);
  await page.keyboard.press('KeyF');
  const flyStart = await snapshot();
  await page.keyboard.down('Space'); await page.waitForTimeout(450); await page.keyboard.up('Space');
  const flew = await snapshot();
  check('Fly mode reaches the rest of the map', flew.flying && flew.position[1] > flyStart.position[1] + 100, flew);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !shangriLa.debug.snapshot().active);
  const flyPaused = await snapshot();
  await page.keyboard.down('Space'); await page.waitForTimeout(200); await page.keyboard.up('Space');
  check('Fly mode also pauses when the pointer is released', distance(flyPaused.position, (await snapshot()).position) < .01);

  // Controlled camera placements inspect native geometry across the map.
  // These screenshots are visual checks, not claims of physical traversal.
  const views = [
    ['temple', [50, 290, 1000], [0, 210, -100]],
    ['overview', [2600, 2400, 3200], [-300, -100, 700]],
    ['waterfall', [-1350, 190, 1400], [-1750, -190, 1500]],
    ['caves', [520, -320, 1260], [400, -320, 1550]],
  ];
  for (const [name, position, look] of views) {
    await page.evaluate(({position, look}) => {shangriLa.camera.position.fromArray(position); shangriLa.camera.lookAt(...look);}, {position, look});
    await page.waitForTimeout(400);
    check(`${name} renders`, (await snapshot()).triangles > 1000);
    await page.screenshot({path: path.join(out, name + '.png')});
  }
  await page.waitForTimeout(1300);
  await page.locator('canvas').click();
  await page.waitForFunction(() => shangriLa.debug.snapshot().active);
  await page.keyboard.press('KeyR');
  const reset = await snapshot();
  check('Reset returns to the original spawn in walk mode', !reset.flying && reset.grounded && distance(reset.feet, spawn.feet) < .1, reset);
  await page.keyboard.press('Escape');
  await page.setViewportSize({width: 1000, height: 650});
  await page.waitForTimeout(300);
  check('Canvas resizes with the browser', await page.evaluate(() => document.querySelector('canvas').clientWidth === 1000 && Math.abs(shangriLa.camera.aspect - 1000 / 650) < .001));
  const final = await snapshot();
  check('No browser or asset errors', !errors.length && !failed.length && !final.errors.length, {errors, failed, runtime: final.errors});
} catch (error) {
  console.error(error); errors.push(String(error)); process.exitCode = 1;
  await page.screenshot({path: path.join(out, 'failure.png')}).catch(() => {});
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({url, checks, errors, failed}, null, 2));
  await browser.close();
}
