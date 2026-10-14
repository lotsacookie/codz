import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'artifacts/ascension');
fs.mkdirSync(out, {recursive: true});
const savedUrl = path.join(root, 'artifacts/ascension-url.txt');
const url = process.env.ASCENSION_URL || (fs.existsSync(savedUrl) ? fs.readFileSync(savedUrl, 'utf8').trim() : 'http://127.0.0.1:5173/?map=ascension');
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
const snapshot = () => page.evaluate(() => ascension.debug.snapshot());
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
try {
  await page.goto(url, {waitUntil: 'load', timeout: 180000});
  await page.waitForFunction(() => window.ascension?.ready || document.getElementById('status').textContent.includes('could not load'), null, {timeout: 180000});
  check('Native Ascension assets load', await page.evaluate(() => !!window.ascension?.ready), await page.locator('#status').textContent());
  await page.waitForTimeout(1200);
  const spawn = await snapshot();
  check('Map renders immediately without a landing page', spawn.drawCalls > 0 && spawn.triangles > 10000 && !spawn.active && await page.locator('#status').isHidden(), spawn);
  check('Original centrifuge-room spawn settles onto the floor', spawn.grounded && Math.abs(spawn.feet[0] + 762.5) < 15 && Math.abs(spawn.feet[2] + 22.4) < 15 && spawn.feet[1] > -485 && spawn.feet[1] < -450, spawn);
  check('Static instances optimized', spawn.optimization.instances > 1000, spawn.optimization);
  const arrival = await page.evaluate(async () => {
    const T = await import('three');
    // The parent "lander" brush is invisible clip geometry; its visible base
    // model is the rendered child that must follow the docking transform.
    const entity = ascension.data.entities.find(e => e.script_noteworthy === 'lander_base');
    let object;
    ascension.world.traverse(o => {if (o.userData.entityId === entity.id) object = o;});
    const position = object.getWorldPosition(new T.Vector3());
    const origin = position.clone().add(new T.Vector3(0, 70, 0)), down = new T.Vector3(0, -1, 0);
    const hit = ascension.collision.rayIntersect(new T.Ray(origin, down), 0, 140);
    const visibleHit = new T.Raycaster(origin, down, 0, 140).intersectObject(object, true)[0];
    return {position: position.toArray(), floor: hit?.position.toArray(), visibleSurface: visibleHit?.point.toArray()};
  });
  check('Lander renders and collides at the native arrival station', distance(arrival.position, [-669, -479, 145.5]) < .01 && arrival.floor && arrival.visibleSurface && distance(arrival.floor, arrival.visibleSurface) < .1, arrival);
  await page.screenshot({path: path.join(out, 'spawn.png')});
  await page.locator('canvas').click();
  await page.waitForFunction(() => ascension.debug.snapshot().active);
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
  const lookStart = (await snapshot()).rotation;
  await page.mouse.move(780, 440);
  await page.waitForTimeout(100);
  check('Captured mouse input changes the view', distance(lookStart, (await snapshot()).rotation) > .01);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !ascension.debug.snapshot().active);
  const paused = await snapshot();
  await page.keyboard.down('KeyW'); await page.waitForTimeout(300); await page.keyboard.up('KeyW');
  check('Esc releases the mouse and stops movement', distance(paused.position, (await snapshot()).position) < .01);
  // Chromium's pointer-lock cooldown also applies to rapid automation clicks.
  await page.waitForTimeout(1300);
  await page.locator('canvas').click();
  await page.waitForFunction(() => ascension.debug.snapshot().active);
  await page.keyboard.press('KeyF');
  const flyStart = await snapshot();
  await page.keyboard.down('Space'); await page.waitForTimeout(450); await page.keyboard.up('Space');
  const flew = await snapshot();
  check('Fly mode reaches the rest of the map', flew.flying && flew.position[1] > flyStart.position[1] + 100, flew);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !ascension.debug.snapshot().active);
  const flyPaused = await snapshot();
  await page.keyboard.down('Space'); await page.waitForTimeout(200); await page.keyboard.up('Space');
  check('Fly mode also pauses when the pointer is released', distance(flyPaused.position, (await snapshot()).position) < .01);

  // Controlled camera placements inspect native geometry across the map.
  // These screenshots are visual checks, not claims of physical traversal.
  const views = [
    ['centrifuge', [-550, -420, 250], [-600, -420, -100]],
    ['overview', [4200, 3500, 4800], [0, -50, 0]],
    ['rocket', [2800, 500, 850], [1379, 1500, -384]],
    ['power', [-676, 315, -1397], [-100, 360, -1320]],
    ['storage', [206, -40, 1671], [150, -60, 2200]],
  ];
  for (const [name, position, look] of views) {
    await page.evaluate(({position, look}) => {ascension.camera.position.fromArray(position); ascension.camera.lookAt(...look);}, {position, look});
    await page.waitForTimeout(400);
    check(`${name} renders`, (await snapshot()).triangles > 1000);
    await page.screenshot({path: path.join(out, name + '.png')});
  }
  await page.waitForTimeout(1300);
  await page.locator('canvas').click();
  await page.waitForFunction(() => ascension.debug.snapshot().active);
  await page.keyboard.press('KeyR');
  const reset = await snapshot();
  check('Reset returns to the original spawn in walk mode', !reset.flying && reset.grounded && distance(reset.feet, spawn.feet) < .1, reset);
  await page.keyboard.press('Escape');
  await page.setViewportSize({width: 1000, height: 650});
  await page.waitForTimeout(300);
  check('Canvas resizes with the browser', await page.evaluate(() => document.querySelector('canvas').clientWidth === 1000 && Math.abs(ascension.camera.aspect - 1000 / 650) < .001));
  const final = await snapshot();
  check('No browser or asset errors', !errors.length && !failed.length && !final.errors.length, {errors, failed, runtime: final.errors});
} catch (error) {
  console.error(error); errors.push(String(error)); process.exitCode = 1;
  await page.screenshot({path: path.join(out, 'failure.png')}).catch(() => {});
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({url, checks, errors, failed}, null, 2));
  await browser.close();
}
