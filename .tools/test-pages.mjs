import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const url = process.env.KINO_URL ?? 'http://127.0.0.1:5190/?map=kino';
const out = path.join(root, 'artifacts', 'cloudflare', process.env.KINO_URL ? 'live' : 'local');
fs.mkdirSync(out, { recursive: true });
let server;
if (!process.env.KINO_URL) {
  server = spawn(process.execPath, [path.join(root, '.tools', 'serve.mjs'), '5190'], {
    windowsHide: true, stdio: 'pipe', env: { ...process.env, KINO_WEB_ROOT: path.join(root, '.work', 'cloudflare-pages') },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.stdout.once('data', resolve);
    server.once('exit', code => reject(new Error(`Server exited ${code}`)));
  });
}
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const args = ['--enable-webgl', '--ignore-gpu-blocklist'];
// An optional browser-only route diagnoses unreachable Cloudflare anycast
// ranges without changing Windows DNS or any game/player configuration.
if (process.env.KINO_EDGE_IP) args.push(`--host-resolver-rules=MAP ${new URL(url).hostname} ${process.env.KINO_EDGE_IP}`);
const browser = await chromium.launch({ executablePath, headless: true, args });
const report = { url, edgeOverride: process.env.KINO_EDGE_IP ?? null, checks: [], errors: [], failed: [] };
try {
  for (const mobile of [false, true]) {
    const mode = mobile ? 'mobile' : 'desktop';
    const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 }, hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(`${mode}: ${e}`));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(`${mode}: ${m.text()}`); });
    page.on('response', r => { if (r.status() >= 400) report.failed.push(`${r.status()} ${r.url()}`); });
    page.on('requestfailed', r => report.failed.push(`${r.failure()?.errorText} ${r.url()}`));
    const started = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => globalThis.kino?.debug.getState().ready || globalThis.kino?.debug.getState().errors.length, null, { timeout: 240000 });
    const state = () => page.evaluate(() => kino.debug.getState());
    assert((await state()).ready, JSON.stringify((await state()).errors));
    await page.screenshot({ path: path.join(out, `${mode}-menu.png`) });
    if (mobile) await page.locator('#start').tap();
    else await page.locator('#start').click();
    await page.waitForFunction(() => kino.debug.getState().active);
    await page.evaluate(() => { kino.debug.setInvulnerable(true); kino.debug.setAutoSpawn(false); });
    await page.waitForFunction(() => kino.debug.getState().viewmodelReady);
    await page.waitForTimeout(1000);
    if (!mobile) {
      assert(await page.evaluate(() => Boolean(document.pointerLockElement)), 'Start captures mouse');
      const before = (await state()).player.feet;
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(700);
      await page.keyboard.up('KeyW');
      const after = (await state()).player.feet;
      assert(Math.hypot(after[0] - before[0], after[2] - before[2]) > 20, 'Player walks on split collision mesh');
      const mag = (await state()).weapon.mag;
      await page.mouse.down();
      await page.waitForTimeout(200);
      await page.mouse.up();
      assert((await state()).weapon.mag < mag, 'Mouse fires starting pistol');
      await page.keyboard.press('KeyR');
      await page.waitForFunction(mag => kino.debug.getState().weapon.mag === mag, mag, { timeout: 10000 });
    } else {
      assert((await state()).input.touch.enabled, 'Touch controls activate');
      assert(await page.locator('#touch-controls').isVisible(), 'Touch controls visible');
      assert(await page.locator('#touch-controls button').evaluateAll(buttons => buttons.length > 5 && buttons.every(b => {
        const r = b.getBoundingClientRect();
        return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      })), 'Touch buttons fit phone viewport');
    }
    await page.screenshot({ path: path.join(out, `${mode}-playing.png`) });
    const snapshot = await state();
    const memory = await page.evaluate(() => kino.debug.memoryState());
    if (mobile) {
      assert(memory.mobile && memory.textureBytes < 160 * 1024 * 1024, 'Mobile texture profile is deployed');
      assert(memory.collisionBytes < 45 * 1024 * 1024, 'Compact collision is deployed');
    }
    fs.writeFileSync(path.join(out, `${mode}-state.json`), JSON.stringify(snapshot, null, 2));
    report.checks.push({ mode, passed: true, loadSeconds: (Date.now() - started) / 1000, memory });
    console.log(`PASS ${mode}: game loads and starts${mobile ? ' with touch controls' : ', walks, fires and reloads'}`);
    await context.close();
  }
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  assert.equal(report.failed.length, 0, report.failed.join('\n'));
} catch (error) {
  report.errors.push(String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  server?.kill();
}
