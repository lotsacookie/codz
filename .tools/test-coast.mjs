import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..'), out = path.join(root, 'artifacts/call-of-the-dead');
fs.mkdirSync(out, {recursive: true});
execFileSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'.tools/play-coast.ps1'),'-NoBrowser']);
const url = process.env.COAST_URL || fs.readFileSync(path.join(out, 'url.txt'), 'utf8').trim().replace(/^\uFEFF/, '');
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const browser = await chromium.launch({executablePath, headless: true, args: ['--enable-webgl','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const errors = [], failed = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
page.on('response', response => {if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);});
const check = (name, passed, details) => {
  checks.push({name, passed: Boolean(passed), details}); console.log(passed ? 'PASS' : 'FAIL', name);
  if (!passed) throw new Error(`${name}: ${JSON.stringify(details)}`);
};
const snapshot = () => page.evaluate(() => coast.snapshot());
const distance = (a,b) => Math.hypot(...a.map((v,i) => v-b[i]));
async function hold(key, milliseconds) {
  await page.keyboard.down(key); await page.waitForTimeout(milliseconds); await page.keyboard.up(key);
}
try {
  const started = performance.now();
  await page.goto(url+(url.includes('?')?'&':'?')+'debug', {waitUntil: 'load', timeout: 180000});
  await page.waitForFunction(() => window.coast?.ready || document.querySelector('#error').textContent, null, {timeout: 180000});
  check('Native map, textures, sky and collision load', await page.evaluate(() => coast.ready), {milliseconds: Math.round(performance.now()-started), error: await page.locator('#error').textContent()});
  check('Map opens directly with no landing page', await page.locator('canvas').isVisible() && await page.locator('#status').isHidden() && await page.locator('button').count() === 0);
  await page.screenshot({path: path.join(out,'spawn.png')});
  const before = await snapshot();
  check('Original beach spawn has floor collision', before.grounded && Math.abs(before.feet[0]+2200.8)<20 && Math.abs(before.feet[2]+783.3)<20, before);
  check('Native props use Kino static instancing', before.optimization.instances > 1000, before.optimization);
  await page.locator('canvas').click();
  await page.waitForFunction(() => coast.snapshot().active);
  const start = await snapshot();
  await hold('KeyW', 1300);
  const walked = await snapshot();
  check('WASD walks across the beach with collision', distance(start.position, walked.position)>60 && walked.resetCount===0, walked);
  const beforeJump = await snapshot();
  await hold('Space', 130);
  check('Jump leaves the beach floor', (await snapshot()).position[1] > beforeJump.position[1]+8 && !(await snapshot()).grounded, await snapshot());
  await page.waitForFunction(() => coast.snapshot().grounded, null, {timeout: 7000});
  check('Jump returns to the beach floor', (await snapshot()).grounded);
  await page.keyboard.down('ControlLeft'); await page.waitForTimeout(300);
  check('Crouch uses Kino controller', (await snapshot()).crouched);
  await page.keyboard.up('ControlLeft'); await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !coast.snapshot().active);
  const paused = (await snapshot()).position;
  await hold('KeyW', 450);
  check('Escape releases mouse and freezes movement', distance(paused, (await snapshot()).position) === 0);
  check('Esc keeps the map visible', await page.locator('canvas').isVisible() && await page.locator('#status').isHidden());
  await page.locator('canvas').click(); await page.waitForFunction(() => coast.snapshot().active);
  await page.keyboard.press('KeyV');
  const flightStart = await snapshot();
  await hold('Space', 1300);
  check('Free flight climbs above the map', (await snapshot()).flying && (await snapshot()).position[1]>flightStart.position[1]+150, await snapshot());
  await page.screenshot({path: path.join(out,'beach-overview.png')});
  await page.keyboard.press('KeyR'); await page.waitForTimeout(500);
  check('R returns from flight to walking at spawn', !(await snapshot()).flying && distance((await snapshot()).position,before.position)<5, await snapshot());
  for (const name of ['lighthouse','lighthouseTop','shipBow','shipBridge','lagoon','residence']) {
    await page.evaluate(name => coast.relocate(name), name);
    // Source path nodes may be above a rock edge. Require a stable landing,
    // rather than observing a single contact while the capsule slides down.
    await page.evaluate(() => window.coastStableFrames = 0);
    await page.waitForFunction(() => {
      const stable = coast.snapshot().grounded && coast.player.velocity.length()<3;
      window.coastStableFrames = stable ? window.coastStableFrames+1 : 0;
      return window.coastStableFrames >= 30;
    }, null, {timeout: 12000});
    const state = await snapshot();
    check(`${name}: source landmark has walkable floor`, state.grounded && state.resetCount===0, state);
    await page.screenshot({path: path.join(out, name+'.png')});
  }
  await page.evaluate(() => {coast.camera.position.set(5000,3200,4600); coast.camera.lookAt(0,300,-500);});
  // Pause the controller without adding an overlay to inspect the full map.
  await page.keyboard.press('Escape');
  await page.evaluate(() => {coast.camera.position.set(5000,3200,4600); coast.camera.lookAt(0,300,-500);});
  await page.waitForTimeout(200);
  await page.screenshot({path: path.join(out, 'overview.png')});
  await page.setViewportSize({width: 1024, height: 768});
  await page.waitForTimeout(200);
  check('Viewport resize updates canvas and camera', await page.evaluate(() => document.querySelector('canvas').clientWidth===1024 && Math.abs(coast.camera.aspect-1024/768)<.001));
  check('No browser errors or missing asset requests', !errors.length && !failed.length && !(await snapshot()).errors.length, {errors,failed});
} catch (error) {
  errors.push(String(error)); console.error(error); process.exitCode = 1;
  await page.screenshot({path: path.join(out,'failure.png')}).catch(() => {});
} finally {
  fs.writeFileSync(path.join(out,'report.json'), JSON.stringify({url, checks, errors, failed}, null, 2));
  await browser.close();
}
