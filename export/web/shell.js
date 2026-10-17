import { assets } from './asset-loader.js';
import { preloadShared } from './shared-assets.js';
import { detectMobile, releaseRuntime } from './runtime-assets.js';
import { resetMapAssets } from './map-assets.js';
import { releaseModelCache } from './animation.js';
import { createListeners, disposeRenderer } from './dispose.js';
import { GraphicsSettings, detectLowEndBrowser } from './graphics.js';

const $ = id => document.getElementById(id);
const body = document.body;
const launcher = $('launcher'), list = $('map-list'), note = $('launcher-note'), errorBox = $('launcher-error');
const stage = $('stage'), viewport = $('viewport'), loading = $('loading'), pause = $('pause');
const buttons = [...list.querySelectorAll('button[data-map]')];
const IDLE_NOTE = note.textContent;
const SENSITIVITY_KEY = 'kino.lookSensitivity';
const pauseEls = {
  eyebrow: $('pause-eyebrow'), title: $('pause-title'), main: $('pause-main'), resume: $('start'), restart: $('pause-restart'),
  extra: $('pause-extra'), options: $('pause-options'), quit: $('pause-quit'), status: $('pause-status'), results: $('pause-results'),
  controls: $('pause-controls'), optionsView: $('pause-options-view'), slider: $('look-sensitivity'), sliderValue: $('look-sensitivity-value'),
  fullscreen: $('pause-fullscreen'), back: $('pause-options-back'), graphics: $('pause-graphics'),
};
// A cached older index.html (common on mobile) has no GRAPHICS button; create it so the rest of
// the shell never fails to start because of it.
if (!pauseEls.graphics) {
  pauseEls.graphics = document.createElement('button');
  pauseEls.graphics.id = 'pause-graphics';
  pauseEls.graphics.type = 'button';
  pauseEls.graphics.hidden = true;
  (pauseEls.fullscreen ?? pauseEls.back)?.before(pauseEls.graphics);
}
const loadEls = { label: $('load-label'), bar: $('load-progress'), actions: $('load-actions') };

function createHud(root) {
  const pristine = root.innerHTML;
  const cache = new Map();
  const el = id => {
    let found = cache.get(id);
    if (!found || !found.isConnected) { found = document.getElementById(id); cache.set(id, found); }
    return found;
  };
  return {
    root,
    el,
    text(id, value) { const e = el(id), t = String(value ?? ''); if (e && e.textContent !== t) e.textContent = t; },
    html(id, value) { const e = el(id); if (e && e.innerHTML !== value) e.innerHTML = value; },
    hidden(id, value) { const e = el(id); if (e && e.hidden !== !!value) e.hidden = !!value; },
    opacity(id, value) { const e = el(id), t = String(value); if (e && e.style.opacity !== t) e.style.opacity = t; },
    combat(on) { this.hidden('combat-hud', !on); },
    crosshair(on) { this.hidden('crosshair', !on); },
    reset() { root.innerHTML = pristine; cache.clear(); root.hidden = true; },
  };
}

const hud = createHud($('hud'));
const registry = new Map(buttons.map(button => [button.dataset.map, { ...button.dataset, button }]));
let session = null;
let busy = false;

const setEnabled = enabled => { for (const b of buttons) b.disabled = !enabled; };
const setState = state => { body.dataset.state = state; };
const showError = message => { errorBox.textContent = message; errorBox.hidden = false; };

function readSensitivity() {
  try {
    const value = Number(localStorage.getItem(SENSITIVITY_KEY));
    if (value > 0) return Math.min(3, Math.max(.25, value));
  } catch {}
  return 1;
}
let mouseSensitivity = readSensitivity();
const graphics = new GraphicsSettings({ lowEnd: detectLowEndBrowser() });

function loadStyle(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.media = 'not all';
    link.dataset.mapStyle = '';
    link.onload = () => resolve(link);
    link.onerror = () => { link.remove(); reject(new Error(`Could not load ${href}`)); };
    document.head.append(link);
  });
}

function prepareLoadscreen(entry) {
  const href = entry.loadscreen ? new URL(entry.loadscreen, location.href).href : '';
  loading.style.setProperty('--art', href ? `url("${href}")` : 'none');
  if (!href) return Promise.resolve();
  const image = new Image();
  image.src = href;
  return Promise.race([image.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]);
}

function setLoading(text, fraction) {
  loadEls.label.textContent = text;
  if (typeof fraction === 'number') loadEls.bar.style.width = `${Math.max(2, Math.min(100, fraction * 100))}%`;
}

function showLoading(on) {
  loading.hidden = !on;
  if (on) { loadEls.actions.replaceChildren(); loadEls.bar.style.width = '4%'; }
}

function addLoadButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  loadEls.actions.append(button);
  return button;
}

function showOptions(open) {
  if (pauseEls.optionsView.hidden !== open) return;
  pauseEls.optionsView.hidden = !open;
  pauseEls.main.hidden = open;
  if (open) syncOptions();
  pauseEls.title.textContent = open ? 'OPTIONS' : session?.pauseTitle ?? 'PAUSED';
}

function syncGraphics() {
  const supported = !!session?.graphicsEnabled;
  pauseEls.graphics.hidden = !supported;
  if (supported) pauseEls.graphics.textContent = `GRAPHICS: ${graphics.label()}`;
}

function syncOptions() {
  syncGraphics();
  const touch = !!session?.ctx.touch?.mode;
  const slider = pauseEls.slider;
  slider.min = touch ? .4 : .25;
  slider.max = touch ? 2 : 3;
  slider.step = touch ? .1 : .05;
  slider.value = touch ? session.ctx.touch.sensitivity : mouseSensitivity;
  pauseEls.sliderValue.textContent = Number(slider.value).toFixed(touch ? 1 : 2) + '×';
  pauseEls.fullscreen.hidden = !(touch && document.fullscreenEnabled);
}

pauseEls.slider.addEventListener('input', () => {
  const value = Number(pauseEls.slider.value);
  if (!(value > 0)) return;
  const touch = session?.ctx.touch;
  if (touch?.mode) touch.setSensitivity(value);
  else {
    mouseSensitivity = value;
    try { localStorage.setItem(SENSITIVITY_KEY, String(value)); } catch {}
  }
  pauseEls.sliderValue.textContent = value.toFixed(touch?.mode ? 1 : 2) + '×';
});
pauseEls.graphics.addEventListener('click', () => { graphics.cycle(); syncGraphics(); });
pauseEls.options.addEventListener('click', () => showOptions(true));
pauseEls.back.addEventListener('click', () => showOptions(false));
pauseEls.fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {}
});
addEventListener('keydown', event => {
  if (event.code === 'Escape' && !pauseEls.optionsView.hidden) { event.preventDefault(); showOptions(false); }
});

function renderPause({ title, resumeLabel, status = '', results = '', restart = false } = {}) {
  showOptions(false);
  session.pauseTitle = title;
  pauseEls.eyebrow.textContent = session.label.toUpperCase();
  pauseEls.title.textContent = title;
  pauseEls.resume.textContent = resumeLabel;
  pauseEls.restart.hidden = !restart;
  pauseEls.status.textContent = status;
  if (isTouch()) pauseEls.status.textContent = (status ? status + ' · ' : '') + 'TAP START · build ' + BUILD;
  pauseEls.results.hidden = !results;
  pauseEls.results.textContent = results;
  pauseEls.controls.textContent = session.controls;
  pause.hidden = false;
  hud.root.hidden = true;
}

// Phones have no pointer lock: START must activate directly. Trust the map's touch controls, the
// coarse-pointer media query, or a touch seen earlier (touch-controls adds body.touch-mode).
function isTouch() {
  return !!(session?.ctx.touch?.mode || body.classList.contains('touch-mode') || matchMedia('(pointer: coarse)').matches);
}

const BUILD = 'mobile-start-2';
console.info('[shell] build', BUILD);

function lock() {
  if (!session || !session.ready || busy) return;
  try { session.api.prepare?.(); } catch (error) { console.error(error); }
  if (isTouch()) { activate(); return; }  // phones: no pointer lock, the tap itself is the gesture
  try {
    const result = session.canvas.requestPointerLock?.();
    result?.catch?.(() => { pauseEls.status.textContent = 'Press the button to capture the mouse.'; });
  } catch { pauseEls.status.textContent = 'Press the button to capture the mouse.'; }
}

function activate() {
  if (!session || !session.ready || session.over || session.active) return;
  session.active = true;
  session.started = true;
  setState('playing');
  pause.hidden = true;
  hud.root.hidden = false;
  try {
    session.api.setActive?.(true);
  } catch (error) {
    // Never leave a dead screen: go back to the menu and say why.
    console.error(error);
    session.active = false;
    setState('paused');
    pause.hidden = false;
    hud.root.hidden = true;
    pauseEls.status.textContent = `Could not start: ${error?.message ?? error}`;
    return;
  }
  if (isTouch()) enterLandscape();
}

// Best effort: full screen + landscape give touch play the room it needs. Unsupported on iPhone Safari.
async function enterLandscape() {
  try { if (!document.fullscreenElement && document.fullscreenEnabled) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch {}
  try { await screen.orientation?.lock?.('landscape'); } catch {}
}

function deactivate() {
  if (!session || !session.active) return;
  session.active = false;
  session.api.setActive?.(false);
  if (session.over) return;
  setState('paused');
  renderPause({ title: 'PAUSED', resumeLabel: 'RESUME GAME', restart: !!session.api.restart });
}

async function restart() {
  if (!session || busy || !session.api.restart) return;
  busy = true;
  pauseEls.resume.disabled = pauseEls.restart.disabled = true;
  pauseEls.status.textContent = 'Restarting…';
  try {
    await session.api.restart();
    session.over = false;
    session.started = false;
    renderPause({ title: session.label.toUpperCase(), resumeLabel: 'START GAME', status: session.hint });
  } catch (error) {
    console.error(error);
    pauseEls.status.textContent = `Could not restart: ${error.message}`;
  } finally {
    busy = false;
    pauseEls.resume.disabled = pauseEls.restart.disabled = false;
  }
  if (session && !session.over) lock();
}

// Touch: act on pointerup as well as click, so a swallowed or delayed synthetic click cannot leave START dead.
let lastStart = 0;
async function pressStart() {
  if (!session) return;
  const now = performance.now();
  if (now - lastStart < 500) return;
  lastStart = now;
  if (session.over) { await restart(); return; }
  lock();
}
pauseEls.resume.addEventListener('click', pressStart);
pauseEls.resume.addEventListener('pointerup', event => { if (event.pointerType === 'touch') pressStart(); });
pauseEls.restart.addEventListener('click', () => { restart(); });
pauseEls.quit.addEventListener('click', () => { quit(); });

document.addEventListener('pointerlockchange', () => {
  if (!session || !session.ready) return;
  if (document.pointerLockElement === session.canvas) { activate(); return; }
  if (!isTouch()) deactivate();
});
document.addEventListener('pointerlockerror', () => {
  if (session?.ready) pauseEls.status.textContent = 'Press the button to capture the mouse.';
});
const interrupt = () => {
  if (!session?.active) return;
  document.exitPointerLock?.();
  if (isTouch()) deactivate();
};
addEventListener('blur', interrupt);
document.addEventListener('visibilitychange', () => { if (document.hidden) interrupt(); });

function createContext(entry) {
  const listeners = createListeners();
  const disposers = [];
  const exposed = [];
  const controller = new AbortController();
  // A map can keep calling its context after it was quit (late loads, WebGL events); only the
  // session this context belongs to may be changed, and only while it is still the current one.
  const live = () => (session && session.ctx === ctx ? session : null);
  const ctx = {
    id: entry.map,
    label: entry.label,
    mobile: detectMobile(),
    touch: null,
    viewport,
    hud,
    signal: controller.signal,
    listen: (target, type, handler, options) => listeners.add(target, type, handler, options),
    onDispose: fn => { disposers.push(fn); },
    attach(renderer) {
      const own = live();
      if (!own) return renderer.domElement;
      viewport.append(renderer.domElement);
      own.canvas = renderer.domElement;
      own.renderer = renderer;
      return renderer.domElement;
    },
    progress: setLoading,
    choice(text, labels) {
      return new Promise(resolve => {
        setLoading(text);
        loadEls.actions.replaceChildren();
        labels.forEach((label, index) => addLoadButton(label, () => { loadEls.actions.replaceChildren(); resolve(index); }));
      });
    },
    sensitivity: () => mouseSensitivity,
    // Maps that have shadows / god rays call this to get the shared Graphics setting and
    // to show the GRAPHICS row in the pause menu's options.
    useGraphics() { const own = live(); if (own) own.graphicsEnabled = true; return graphics; },
    setControls(text) { const own = live(); if (!own) return; own.controls = text; pauseEls.controls.textContent = text; },
    setHint(text) { const own = live(); if (own) own.hint = text; },
    setButtons(items) {
      pauseEls.extra.replaceChildren();
      for (const { label, run } of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          try { await run(); } catch (error) { console.error(error); } finally { busy = false; }
          lock();
        });
        pauseEls.extra.append(button);
      }
    },
    expose(name, value) { globalThis[name] = value; exposed.push(name); },
    pause: () => { document.exitPointerLock?.(); if (isTouch()) deactivate(); },
    gameOver({ title = 'GAME OVER', status = '', results = '' } = {}) {
      if (!live()) return;
      session.over = true;
      if (session.active) { session.active = false; session.api?.setActive?.(false); }
      document.exitPointerLock?.();
      setState('gameover');
      renderPause({ title, resumeLabel: 'TRY AGAIN', status, results, restart: false });
    },
    quit: () => quit(),
    fail(message) {
      showLoading(true);
      setLoading(message, 1);
      loadEls.actions.replaceChildren();
      addLoadButton('BACK TO MAPS', () => quit());
    },
    ready() {
      if (!live()) return;
      session.ready = true;
      showLoading(false);
      setState('paused');
      renderPause({ title: session.label.toUpperCase(), resumeLabel: 'START GAME', status: session.hint, restart: false });
    },
  };
  return {
    ctx,
    dispose() {
      controller.abort();
      listeners.clear();
      for (const fn of disposers.splice(0).reverse()) { try { fn(); } catch (error) { console.error(error); } }
      for (const name of exposed) delete globalThis[name];
    },
  };
}

async function boot(entry) {
  if (session || busy) return;
  busy = true;
  setEnabled(false);
  errorBox.hidden = true;
  note.textContent = `Loading ${entry.label}…`;
  const styles = [];
  try {
    for (const href of (entry.styles ?? '').split(/\s+/).filter(Boolean)) styles.push(await loadStyle(href));
  } catch (error) {
    for (const link of styles) link.remove();
    note.textContent = IDLE_NOTE;
    showError(error.message);
    setEnabled(true);
    busy = false;
    return;
  }
  for (const link of styles) link.media = 'all';
  await prepareLoadscreen(entry);
  const holder = createContext(entry);
  session = {
    ...entry, ctx: holder.ctx, holder, styles, canvas: null, renderer: null, api: null, ready: false, active: false, over: false, started: false,
    controls: '', hint: 'Click to capture the mouse · Esc to pause', pauseTitle: '', mounting: null, cancelled: false,
  };
  document.title = entry.title || document.title;
  body.dataset.map = entry.map;
  setState('loading');
  launcher.hidden = true;
  stage.hidden = false;
  showLoading(true);
  setLoading(`Loading ${entry.label}…`, .04);
  busy = false;
  const current = session;
  current.mounting = (async () => {
    const module = await import(entry.module);
    return module.mount(current.ctx);
  })();
  try {
    const api = await current.mounting;
    current.api = api ?? {};
    if (current.cancelled) return;
    if (!current.ready) current.ctx.ready();
    if (!current.cancelled && !isTouch()) lock();  // phones wait for a tap on START (audio and fullscreen need the gesture)
  } catch (error) {
    if (current.cancelled) return;
    console.error(error);
    current.ctx.fail(error?.message ?? String(error));
  }
}

async function teardown() {
  const old = session;
  session = null;
  document.exitPointerLock?.();
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
  try { await old.api?.dispose?.(); } catch (error) { console.error(error); }
  old.holder.dispose();
  if (old.renderer) disposeRenderer(old.renderer);
  old.canvas?.remove();
  viewport.replaceChildren();
  pauseEls.extra.replaceChildren();
  hud.reset();
  for (const link of old.styles) link.remove();
  body.classList.remove('touch-mode');
  releaseRuntime();
  resetMapAssets();
  assets.releaseTransient();
  await releaseModelCache();
}

async function quit() {
  const old = session;
  if (!old || old.quitting) return;
  old.quitting = true;
  old.cancelled = true;
  old.active = false;
  setState('closing');
  pause.hidden = true;
  showLoading(true);
  setLoading('Clearing the game…');
  try { await old.mounting?.catch(() => {}); } catch {}
  await teardown();
  stage.hidden = true;
  showLoading(false);
  pause.hidden = true;
  document.title = 'Zombies — Select a map';
  body.dataset.map = '';
  setState('launcher');
  launcher.hidden = false;
  note.textContent = IDLE_NOTE;
  setEnabled(true);
  const params = new URLSearchParams(location.search);
  if (params.has('map')) { params.delete('map'); history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : '')); }
}

list.addEventListener('click', event => {
  const button = event.target.closest('button[data-map]');
  if (button && !button.disabled) boot(registry.get(button.dataset.map));
});

function selectMap(button) {
  const chosen = button.closest('li');
  for (const item of list.children) item.classList.toggle('selected', item === chosen);
}
for (const type of ['pointerover', 'focusin']) {
  list.addEventListener(type, event => {
    const button = event.target.closest('button[data-map]');
    if (button) selectMap(button);
  });
}
list.addEventListener('keydown', event => {
  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
  const enabled = buttons.filter(button => !button.disabled);
  const at = enabled.indexOf(document.activeElement);
  if (!step || at < 0) return;
  event.preventDefault();
  enabled[(at + step + enabled.length) % enabled.length].focus();
});
if (buttons[0]) selectMap(buttons[0]);

const preloadEls = { root: $('preload'), label: $('preload-label'), bar: $('preload-bar') };
const MB = 1048576;

function preload() {
  const steps = [
    () => import('./animation.js'),
    () => import('./enemies.js'),
    () => import('./moon-combat.js'),
    () => import('./audio.js'),
    () => import('@recast-navigation/core').then(core => core.init()),
    () => fetch('audio/manifest.json').then(r => r.ok ? r.arrayBuffer() : null),
    () => fetch('game-data.json').then(r => r.ok ? r.arrayBuffer() : null),
    () => fetch('moon/combat-data.json').then(r => r.ok ? r.arrayBuffer() : null),
  ].map(step => () => Promise.resolve().then(step).catch(() => null));
  let finishedSteps = 0, loaded = 0, total = 0;
  const render = () => {
    const bytes = total ? Math.min(1, loaded / total) : 0;
    const fraction = .75 * bytes + .25 * (finishedSteps / steps.length);
    preloadEls.bar.style.width = `${Math.max(3, fraction * 100).toFixed(1)}%`;
    if (total) preloadEls.label.textContent = `Loading weapons and enemies · ${(loaded / MB).toFixed(0)} / ${(total / MB).toFixed(0)} MB`;
  };
  const stop = assets.onProgress(snapshot => {
    loaded = 0; total = 0;
    for (const file of snapshot.files) if (/\.pack(?:[?#].*)?$/i.test(file.url)) { loaded += file.got; total += file.total; }
    render();
  });
  render();
  const finish = (text, failed) => {
    stop();
    preloadEls.label.textContent = text;
    preloadEls.bar.style.width = '100%';
    preloadEls.root.classList.add(failed ? 'failed' : 'done');
    setTimeout(() => { preloadEls.root.hidden = true; }, failed ? 6000 : 1800);
  };
  const work = [
    preloadShared().catch(error => { console.warn('Shared packs unavailable:', error); throw error; }),
    ...steps.map(step => Promise.resolve().then(step).then(() => { finishedSteps++; render(); })),
  ];
  return Promise.allSettled(work).then(results => {
    const failed = results.some(result => result.status === 'rejected');
    finish(failed ? 'Some shared files will load with the map' : 'Weapons and enemies ready', failed);
  });
}

globalThis.zombies = { get state() { return body.dataset.state; }, get map() { return session?.map ?? null; }, quit, preloaded: preload() };

const requested = new URLSearchParams(location.search).get('map');
if (requested) {
  const entry = registry.get(requested);
  if (entry) boot(entry);
  else showError(`There is no map called "${requested}". Choose one from the list.`);
}
