import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const layoutOnly = process.argv.includes('--layout');
const out = path.join(root, layoutOnly ? 'artifacts/mobile-layout' : 'artifacts/mobile');
fs.mkdirSync(out, { recursive: true });
const port = 5185;
const server = spawn(process.execPath, [path.join(root, '.tools/serve.mjs'), String(port)], { windowsHide: true, stdio: 'pipe' });
let serverLog = '';
server.stdout.on('data', chunk => { serverLog += chunk; });
server.stderr.on('data', chunk => { serverLog += chunk; });
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const report = { checks: [], errors: [], failed: [] };
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  for (let i = 0; i < 100 && !serverLog.includes('kino:'); i++) {
    if (server.exitCode !== null) throw new Error(serverLog);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const map of (process.argv.includes('--kino') ? ['kino'] : process.argv.includes('--moon') ? ['moon'] : ['kino', 'moon'])) {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', e => report.errors.push(`${map}: ${e}`));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(`${map}: ${m.text()}`); });
    page.on('response', r => { if (r.status() >= 400) report.failed.push(`${r.status()} ${r.url()}`); });
    const state = () => page.evaluate(() => {
      const s = globalThis.moon?.debug.snapshot() ?? globalThis.kino?.debug.getState();
      if (!s) return null;
      return { active: s.active, touch: s.input.touch, primary: s.input.primary, ads: s.input.ads,
        feet: s.player?.feet ?? s.position,
        rotation: s.player?.rotation, crouched: s.player?.crouched, grounded: s.player?.grounded ?? s.grounded,
        session: s.combat ?? s, suit: s.suit, errors: s.errors };
    });
    const states = {};
    const shot = async name => {
      await page.evaluate(() => new Promise(requestAnimationFrame));
      states[name] = await state();
      await page.screenshot({ path: path.join(out, `${map}-${name}.png`), timeout: 60000 });
      fs.writeFileSync(path.join(out, `${map}-states.json`), JSON.stringify(states, null, 2));
      return states[name];
    };
    const check = (name, passed) => {
      report.checks.push({ map, name, passed: Boolean(passed) });
      console.log(passed ? 'PASS' : 'FAIL', map, name);
      assert.ok(passed, `${map}: ${name}`);
    };
    const center = async selector => {
      const b = await page.locator(selector).boundingBox();
      assert.ok(b, `${selector} is visible`);
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const tap = async (selector, name) => {
      await page.locator(selector).scrollIntoViewIfNeeded();
      const p = await center(selector);
      await page.touchscreen.tap(p.x, p.y);
      return shot(name);
    };
    const fits = () => page.locator('#touch-controls button').evaluateAll((buttons, width) => innerWidth === width && buttons.every(button => {
      const r = button.getBoundingClientRect();
      const middle = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.width >= 44 && r.height >= 44 && r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && button.contains(middle);
    }), page.viewportSize().width);
    const cdp = await context.newCDPSession(page);
    const points = new Map();
    const contact = async (type, id, position) => {
      if (type === 'touchEnd') {
        await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [points.get(id)] });
        points.delete(id);
      } else {
        points.set(id, { id, ...position, radiusX: 8, radiusY: 8, force: 1 });
        await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...points.values()] });
      }
    };
    const release = async (type = 'touchEnd') => {
      points.clear();
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [] });
    };
    try {
      await page.goto(`http://127.0.0.1:${port}/?map=${map}`, { waitUntil: 'load', timeout: 180000 });
      await page.waitForFunction(() => globalThis.moon?.ready || globalThis.kino?.debug.getState().ready, null, { timeout: 180000 });
      await shot('menu-landscape');
      await tap('#start', 'started');
      check('tap starts without pointer lock', (await state()).active && (await state()).touch.enabled && await page.evaluate(() => !document.pointerLockElement));
      await page.evaluate(() => {
        if (globalThis.moon) { moon.combat.session.effects.invulnerable = Infinity; moon.combat.enemies.spawnDelay = 999; }
        else kino.debug.setInvulnerable(true);
      });
      await shot('safe-start');
      check('landscape buttons fit and receive touches', await fits());
      if (layoutOnly) {
        for (const [name, size] of [['portrait', { width: 390, height: 844 }], ['small-phone', { width: 320, height: 568 }], ['tablet', { width: 1024, height: 768 }]]) {
          await page.setViewportSize(size);
          await shot(name);
          check(`${name} buttons fit and receive touches`, await fits());
          await tap('#touch-pause', `${name}-menu`);
          check(`${name} menu fits`, await page.evaluate(() => document.getElementById('menu').scrollWidth <= innerWidth));
          await tap('#start', `${name}-resumed`);
        }
        continue;
      }
      const before = await state();
      const origin = await center('.touch-stick');
      await contact('touchStart', 1, origin);
      await contact('touchMove', 1, { x: origin.x, y: origin.y - 28 });
      await page.waitForTimeout(350);
      const walking = await shot('walking');
      check('analog walking moves player', walking.touch.forward > .3 && walking.touch.forward < .8 && !walking.touch.sprint && Math.hypot(...walking.feet.map((v, i) => v - before.feet[i])) > 1);
      await contact('touchMove', 1, { x: origin.x, y: origin.y - 55 });
      const sprint = await shot('sprinting');
      check('push stick to sprint', sprint.touch.sprint);
      await contact('touchStart', 2, { x: 450, y: 110 });
      await contact('touchMove', 2, { x: 490, y: 120 });
      const look = await shot('move-look');
      check('two fingers move and look together', look.touch.pointers === 2 && Math.abs(look.rotation[1] - sprint.rotation[1]) > .1);
      await contact('touchEnd', 2);
      await shot('look-released');
      const fire = await center('[data-touch="fire"]');
      const ammo = (await state()).session.weapon.mag;
      await contact('touchStart', 3, fire);
      await contact('touchMove', 3, { x: fire.x - 30, y: fire.y - 10 });
      await page.waitForTimeout(400);
      const firing = await shot('move-fire');
      check('fire while moving and drag to aim', firing.session.weapon.mag < ammo && firing.touch.forward > .9 && !firing.touch.sprint && Math.abs(firing.rotation[1] - look.rotation[1]) > .05);
      await release();
      const released = await shot('released');
      check('release clears movement and firing', released.touch.pointers === 0 && !released.primary && released.touch.forward === 0);
      const aiming = await tap('[data-touch="aim"]', 'aim');
      check('aim toggles on', aiming.touch.aim && aiming.ads);
      const hip = await tap('[data-touch="aim"]', 'hip');
      check('aim toggles off', !hip.touch.aim && !hip.ads);
      await tap('[data-touch="crouch"]', 'crouch');
      check('crouch toggles on', (await state()).crouched);
      await tap('[data-touch="crouch"]', 'stand');
      check('crouch toggles off', !(await state()).crouched);
      await tap('[data-touch="reload"]', 'reload');
      await page.waitForFunction(() => (globalThis.moon?.combat.session.reloadLeft ?? globalThis.kino?.debug.getState().reloadLeft) === 0);
      check('reload fills magazine', (await state()).session.weapon.mag > firing.session.weapon.mag);
      await shot('reloaded');
      await page.evaluate(feet => {
        if (globalThis.moon) moon.player.setPosition(moon.camera.position.clone().set(...feet));
        else kino.debug.teleportPlayer(feet);
      }, before.feet);
      await page.waitForTimeout(500);
      const jumpBefore = await shot('jump-setup');
      const jump = await tap('[data-touch="jump"]', 'jump');
      check('quick jump tap leaves ground', jump.feet[1] > jumpBefore.feet[1] + 1);
      const knife = await tap('[data-touch="melee"]', 'knife');
      check('knife action reaches combat', knife.session.meleeLeft > 0);
      await page.waitForFunction(() => (globalThis.moon?.combat.session.meleeLeft ?? globalThis.kino?.debug.getState().meleeLeft) === 0);
      const grenades = (await state()).session.grenades;
      await tap('[data-touch="grenade"]', 'grenade');
      check('grenade action consumes equipment', (await state()).session.grenades === grenades - 1);
      if (map === 'moon') {
        await page.evaluate(() => { moon.state.hasSuit = true; moon.state.suit = false; });
        await shot('suit-setup');
        const suited = await tap('[data-touch="suit"]', 'suit');
        check('P.E.S. button equips suit', suited.suit);
        await tap('[data-touch="journal"]', 'objective');
        check('objective is reachable', await page.locator('#journal').isVisible());
        await tap('[data-touch="journal"]', 'objective-closed');
      }
      await contact('touchStart', 1, await center('[data-touch="use"]'));
      const using = await shot('use-held');
      check('use remains held for repair', using.touch.use);
      await release('touchCancel');
      const cancelled = await shot('cancelled');
      check('cancel clears held action', !cancelled.touch.use && cancelled.touch.pointers === 0);
      await contact('touchStart', 1, await center('.touch-stick'));
      await contact('touchStart', 2, await center('[data-touch="fire"]'));
      await shot('pause-setup');
      await contact('touchStart', 3, await center('#touch-pause'));
      const paused = await shot('paused');
      await release();
      check('third finger pauses and releases all contacts', !paused.active && !paused.touch.visible && paused.touch.pointers === 0 && !paused.primary);
      // Kino keeps look sensitivity behind OPTIONS; Moon still shows it in the pause panel.
      if (map === 'kino') await tap('#options', 'options');
      await tap(map === 'kino' ? '#look-sensitivity' : '#touch-sensitivity', 'settings');
      check('settings do not resume gameplay', !(await state()).active);
      const sensitivity = (await state()).touch.sensitivity;
      check('sensitivity is saved', await page.evaluate(value => Number(localStorage.getItem('zombies.touchSensitivity')) === value, sensitivity));
      if (map === 'kino') await tap('#options-back', 'options-back');
      await tap('#start', 'resumed');
      await contact('touchStart', 1, await center('[data-touch="fire"]'));
      await shot('rotation-setup');
      await page.setViewportSize({ width: 390, height: 844 });
      await release();
      const portrait = await shot('portrait');
      check('rotation clears fire', !portrait.primary && portrait.touch.pointers === 0);
      check('portrait buttons fit and receive touches', await fits());
      await tap('#touch-pause', 'menu-portrait');
      check('portrait menu has no horizontal overflow', await page.evaluate(() => document.getElementById('menu').scrollWidth <= innerWidth));
      await tap('#start', 'portrait-resumed');
      for (const [name, size] of [['small-phone', { width: 320, height: 568 }], ['tablet', { width: 1024, height: 768 }]]) {
        await page.setViewportSize(size);
        await shot(name);
        check(`${name} buttons fit and receive touches`, await fits());
      }
      await page.evaluate(() => dispatchEvent(new Event('blur')));
      const blurred = await shot('blur');
      check('interruption pauses and clears input', !blurred.active && blurred.touch.pointers === 0);
      await tap('#start', 'after-blur');
      await page.evaluate(() => {
        if (globalThis.moon) { moon.combat.session.effects.invulnerable = 0; moon.combat.damage(10000); }
        else { kino.debug.setInvulnerable(false); kino.debug.damagePlayer(10000); }
      });
      const dead = await shot('gameover');
      check('game over disables touch', dead.session.phase === 'gameover' && !dead.touch.enabled && !dead.active);
      await tap('#start', 'retry');
      check('touch can restart after game over', (await state()).active && (await state()).session.phase !== 'gameover');
      check('no game errors', !(await state()).errors.length);
    } catch (error) {
      await shot('failure').catch(() => {});
      throw error;
    } finally {
      await context.tracing.stop({ path: path.join(out, `${map}-trace.zip`) });
      await context.close();
    }
  }
  assert.deepEqual(report.errors, [], 'browser errors');
  assert.deepEqual(report.failed, [], 'failed asset requests');
} catch (error) {
  report.errors.push(String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, 'server.log'), serverLog);
  await browser.close();
  server.kill();
}
