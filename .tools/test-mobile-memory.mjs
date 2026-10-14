import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, webkit } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const engine = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const out = path.join(root, 'artifacts', 'mobile-memory', engine);
fs.mkdirSync(out, { recursive: true });
const port = engine === 'webkit' ? 5192 : 5191;
const server = spawn(process.execPath, [path.join(root, '.tools/serve.mjs'), String(port)], {
  windowsHide: true, stdio: 'pipe', env: { ...process.env, KINO_WEB_ROOT: path.join(root, '.work/cloudflare-pages') },
});
await new Promise((resolve, reject) => { server.once('error', reject); server.stdout.once('data', resolve); server.once('exit', code => reject(new Error(`Server exited ${code}`))); });
const options = { headless: true };
if (engine === 'chromium') options.executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const browser = await (engine === 'webkit' ? webkit : chromium).launch(options);
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' });
const page = await context.newPage();
const report = { engine, checks: [], samples: [], errors: [], failed: [], originalTextures: [], navigations: 0, crashes: 0 };
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
page.on('response', response => { if (response.status() >= 400) report.failed.push(`${response.status()} ${response.url()}`); });
page.on('request', request => { if (/\/textures\//.test(request.url()) && !/\/textures\/game\//.test(request.url())) report.originalTextures.push(request.url()); });
page.on('framenavigated', frame => { if (frame === page.mainFrame()) report.navigations++; });
page.on('crash', () => report.crashes++);
const check = (name, condition) => { assert(condition, name); report.checks.push(name); console.log('PASS', engine, name); };
const state = () => page.evaluate(() => kino.debug.getState());
const memory = () => page.evaluate(() => kino.debug.memoryState());
const settle = () => page.waitForTimeout(250);
try {
  await page.goto(`http://127.0.0.1:${port}/?map=kino`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => globalThis.kino?.debug.getState().ready || globalThis.kino?.debug.getState().errors.length, null, { timeout: 240000 });
  check('boots successfully', (await state()).ready);
  await page.locator('#start').tap();
  await page.waitForFunction(() => kino.debug.getState().active && kino.debug.getState().viewmodelReady);
  await page.evaluate(() => { kino.debug.setInvulnerable(true); kino.debug.setAutoSpawn(false); });
  await settle();
  const boot = await memory(); report.samples.push({ phase: 'boot', ...boot });
  report.audioSupport = await page.evaluate(() => Boolean(globalThis.AudioContext || globalThis.webkitAudioContext));
  check('phone textures are selected before image decoding', boot.mobile && !report.originalTextures.length);
  check('map textures fit the mobile GPU budget', boot.textureBytes < 160 * 1024 * 1024);
  check('lossless collision fits below 45 MiB', boot.collisionBytes < 45 * 1024 * 1024);
  check('mobile multisampling is disabled', boot.antialias === false);
  const weapons = ['m1911_zm', 'm14_zm', 'mp40_zm', 'ray_gun_zm'];
  // Warm each pickup texture before measuring allocations. Combat can reveal
  // a previously unseen pickup, which is an expected one-time upload.
  await page.evaluate(() => {const p=kino.debug.getState().player.feet;for(const type of ['nuke','insta_kill','double_points','full_ammo','carpenter','fire_sale'])kino.debug.dropPowerup(type,[p[0],p[1],p[2]-150]);});
  await settle();
  await page.evaluate(() => kino.debug.step(30));
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const id of weapons) {
      await page.evaluate(id => kino.debug.giveWeapon(id), id);
      await page.waitForFunction(() => kino.debug.getState().viewmodelReady);
      await settle();
    }
    await page.evaluate(() => {
      const p = kino.debug.getState().player.feet;
      for (let i = 0; i < 24; i++) kino.debug.spawnEnemy([p[0] + (i % 6 - 3) * 28, p[1], p[2] - 120 - Math.floor(i / 6) * 32]);
    });
    await settle();
    await page.evaluate(() => { kino.debug.clearEnemies(); kino.debug.step(5); });
    await settle();
    report.samples.push({ phase: `combat-${cycle}`, ...await memory() });
  }
  const warmed = report.samples[2], repeated = report.samples.at(-1);
  check('GPU texture count stabilizes across repeated combat and weapon swaps', repeated.textures <= warmed.textures + 2);
  const before = await state();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  const hidden = await memory();
  await page.waitForTimeout(1000);
  check('backgrounding stops rendering', (await memory()).renderedFrames === hidden.renderedFrames);
  check('backgrounding pauses the current run', !(await state()).active && (await state()).round === before.round);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.locator('#start').tap();
  check('returning resumes the current run', (await state()).active && (await state()).points === before.points);
  for (let i = 0; i < 6; i++) {
    await page.setViewportSize(i % 2 ? { width: 844, height: 390 } : { width: 390, height: 844 });
    await settle();
    if (!(await state()).active) await page.locator('#start').tap();
  }
  check('repeated phone rotation keeps the game running', (await state()).ready && report.navigations === 1);
  const afterRotation = (await memory()).renderedFrames;
  await page.waitForFunction(frames => kino.debug.memoryState().renderedFrames > frames + 2, afterRotation);
  check('frames continue after returning and rotating', true);
  if (engine === 'chromium') {
    const points = (await state()).points;
    await page.evaluate(() => kino.debug.simulateContextLoss());
    await page.waitForFunction(() => kino.debug.memoryState().contextLost);
    check('graphics loss pauses without reloading', !(await state()).active && report.navigations === 1);
    await page.waitForTimeout(500);
    await page.evaluate(() => kino.debug.simulateContextRestore());
    await page.waitForFunction(() => !kino.debug.memoryState().contextLost);
    await page.locator('#start').tap();
    await settle();
    check('graphics restoration preserves points and gameplay', (await state()).active && (await state()).points === points);
  }
  const canvasImage = await page.evaluate(() => new Promise((resolve, reject) => {
    const canvas=document.querySelector('body > canvas'),gl=canvas.getContext('webgl2'),started=performance.now();
    const sample=()=>{
      const pixel=new Uint8Array(4);gl.readPixels(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      if(pixel[0]+pixel[1]+pixel[2]>0)resolve(canvas.toDataURL());
      else if(performance.now()-started>10000)reject(new Error('No rendered pixels after resuming/rotation'));
      else requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  }));
  fs.writeFileSync(path.join(out,'canvas.png'),Buffer.from(canvasImage.split(',')[1],'base64'));
  check('resumed WebGL canvas contains rendered pixels', true);
  await page.screenshot({ path: path.join(out, 'playing.png') });
  check('no tab crashes, reloads, JavaScript errors or missing assets', !report.crashes && report.navigations === 1 && !report.errors.length && !report.failed.length);
} catch (error) {
  report.errors.push(String(error)); console.error(error); process.exitCode = 1;
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close(); server.kill();
}
