import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..'), out = path.join(root, 'artifacts/moon');
fs.mkdirSync(out, {recursive: true});
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const browser = await chromium.launch({executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const errors = [], failed = [], checks = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) failed.push(r.url() + ' ' + r.status()); });
const check = (name, passed, details = null) => { checks.push({name, passed: !!passed, details}); if (!passed) throw new Error(name + ': ' + JSON.stringify(details)); console.log('PASS', name); };
try {
  await page.goto((process.env.MOON_URL??'http://127.0.0.1:5173/?map=moon')+'&mode=explore', {waitUntil: 'load', timeout: 180000});
  await page.waitForFunction(() => window.moon?.ready || document.querySelector('#error')?.textContent, null, {timeout: 180000});
  check('Moon assets load', await page.evaluate(() => !!window.moon?.ready), await page.locator('#error').textContent());
  await page.screenshot({path: path.join(out, 'menu.png')});
  await page.locator('#start').click();
  await page.waitForFunction(() => moon.debug.snapshot().active);
  await page.waitForTimeout(800);
  const start = await page.evaluate(() => moon.debug.snapshot());
  check('Original No Man’s Land spawn has floor collision', start.grounded && start.position[0] > 13000 && !start.environment.lowGravity, start);
  await page.screenshot({path: path.join(out, 'area51.png')});
  await page.keyboard.down('KeyS'); await page.waitForTimeout(850); await page.keyboard.up('KeyS');
  const moved = await page.evaluate(() => moon.debug.snapshot());
  check('Keyboard movement uses the controller', Math.hypot(moved.position[0]-start.position[0], moved.position[2]-start.position[2]) > 40, moved);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !moon.debug.snapshot().active);
  const paused = await page.evaluate(() => moon.debug.snapshot().position);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(250); await page.keyboard.up('KeyW');
  check('Pause freezes movement', JSON.stringify(paused) === JSON.stringify(await page.evaluate(() => moon.debug.snapshot().position)));
  for (const destination of ['receiving', 'power', 'biodome']) {
    await page.locator(`[data-destination="${destination}"]`).click();
    await page.waitForFunction(() => moon.debug.snapshot().active);
    await page.waitForTimeout(1200);
    const snapshot = await page.evaluate(() => moon.debug.snapshot());
    check(destination + ' has traversable floor and lunar gravity', snapshot.grounded && snapshot.environment.lowGravity, snapshot);
    await page.screenshot({path: path.join(out, destination + '.png')});
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !moon.debug.snapshot().active);
  }
  await page.locator('[data-destination="receiving"]').click();
  await page.waitForFunction(() => moon.debug.snapshot().active);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(850); await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyF'); await page.waitForTimeout(150);
  check('Walk to the native P.E.S. station and equip with F', await page.evaluate(() => moon.state.hasSuit && moon.state.suit), await page.evaluate(() => moon.debug.snapshot()));
  await page.screenshot({path: path.join(out, 'pes.png')});
  await page.keyboard.press('KeyQ'); await page.waitForTimeout(450);
  check('Removing P.E.S. exposes the player to vacuum', await page.evaluate(() => !moon.state.suit && moon.state.exposure > .2));
  await page.keyboard.press('KeyQ'); await page.waitForTimeout(150);
  check('Replacing P.E.S. restores life support', await page.evaluate(() => moon.state.suit && moon.state.exposure === 0));
  await page.evaluate(() => { moon.player.setPosition(moon.camera.position.clone().set(390, 3, -625)); moon.camera.rotation.set(0, -Math.PI/2, 0); });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(950); await page.keyboard.up('KeyW');
  const closed = await page.evaluate(() => moon.debug.snapshot());
  check('Receiving Bay airlock blocks walking while closed', closed.position[0] < 490, closed);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(650);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1800); await page.keyboard.up('KeyW');
  const through = await page.evaluate(() => moon.debug.snapshot());
  check('Airlock slides open and can be walked through', through.doors.includes('pf1344_auto361') && through.position[0] > 730, through);
  await page.screenshot({path: path.join(out, 'airlock.png')});
  await page.evaluate(() => { moon.player.setPosition(moon.camera.position.clone().set(-20, -580, -3191)); moon.camera.rotation.set(0, -Math.PI/2, 0); });
  await page.waitForTimeout(300); await page.keyboard.press('KeyF');
  check('Native power switch responds to F', await page.evaluate(() => moon.state.power));
  await page.evaluate(() => moon.debug.relocate('receiving'));
  await page.waitForTimeout(350);
  check('Power restores Receiving Bay gravity and air', await page.evaluate(() => {const e=moon.debug.snapshot().environment;return e.gravity===800 && e.breathable;}));
  await page.evaluate(() => {
    const pad = moon.data.entities.find(e => e.targetname === 'nml_teleporter');
    moon.player.setPosition(moon.camera.position.clone().set(pad.position[0], -599, pad.position[2])); moon.state.cooldown = 0;
  });
  await page.waitForFunction(() => moon.debug.snapshot().position[0] < 100 && moon.state.cooldown > 0, null, {timeout: 8000});
  check('Area 51 pad automatically teleports to Receiving Bay', await page.evaluate(() => moon.debug.snapshot().checkpoint === 'receiving' && moon.state.suit));
  await page.evaluate(() => {
    const pad = moon.data.entities.find(e => e.targetname === 'generator_teleporter');
    moon.player.setPosition(moon.camera.position.clone().set(pad.position[0], -183, pad.position[2])); moon.state.cooldown = 0;
  });
  await page.waitForFunction(() => moon.debug.snapshot().position[0] > 13000 && moon.state.cooldown > 0, null, {timeout: 8000});
  const returned = await page.evaluate(() => moon.debug.snapshot());
  check('Generator pad returns to the native Area 51 return spawn', returned.checkpoint === 'area51' && returned.position[2] > 15400, returned);
  check('No browser or asset errors', !errors.length && !failed.length, {errors, failed});
} catch (error) {
  console.error(error); errors.push(String(error)); process.exitCode = 1;
  await page.screenshot({path: path.join(out, 'failure.png')}).catch(() => {});
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({checks, errors, failed}, null, 2));
  await browser.close();
}
