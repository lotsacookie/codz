export const GRAPHICS_LEVELS = Object.freeze(['high', 'medium', 'low']);
export const GRAPHICS_SETTINGS = Object.freeze(['auto', ...GRAPHICS_LEVELS]);

export const LOW_SUN_SCALE = 0.7;

export const GRAPHICS_PRESETS = Object.freeze({
  high: Object.freeze({ shadows: true, shadowMapSize: 2048, godRays: true, sunScale: 1, postProcess: true, resolution: 1, minResolution: 0.65, farScale: 1, muzzleLight: true, overlay: true }),
  medium: Object.freeze({ shadows: true, shadowMapSize: 1024, godRays: false, sunScale: 1, postProcess: true, resolution: 1, minResolution: 0.6, farScale: 0.8, muzzleLight: true, overlay: true }),
  low: Object.freeze({ shadows: false, shadowMapSize: 0, godRays: false, sunScale: LOW_SUN_SCALE, postProcess: false, resolution: 0.7, minResolution: 0.55, farScale: 0.4, muzzleLight: false, overlay: false })
});

export const GRAPHICS_LABELS = Object.freeze({ auto: 'AUTO', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' });

const KEY = 'codz.graphics';
const AUTO_KEY = 'codz.graphics.auto';

export const isSetting = value => GRAPHICS_SETTINGS.includes(value);
export const isLevel = value => GRAPHICS_LEVELS.includes(value);
export const nextSetting = setting => GRAPHICS_SETTINGS[(GRAPHICS_SETTINGS.indexOf(setting) + 1) % GRAPHICS_SETTINGS.length];
export const lowerLevel = level => GRAPHICS_LEVELS[Math.min(GRAPHICS_LEVELS.length - 1, GRAPHICS_LEVELS.indexOf(level) + 1)] ?? 'low';

export function detectLowEnd({ userAgent = '', hardwareConcurrency = 0, deviceMemory = 0 } = {}) {
  if (/\bCrOS\b/.test(userAgent)) return true;
  if (deviceMemory > 0 && deviceMemory <= 4) return true;
  if (hardwareConcurrency > 0 && hardwareConcurrency <= 2) return true;
  return false;
}

export function detectLowEndBrowser(scope = globalThis) {
  const nav = scope.navigator;
  if (!nav) return false;
  return detectLowEnd({ userAgent: nav.userAgent ?? '', hardwareConcurrency: nav.hardwareConcurrency ?? 0, deviceMemory: nav.deviceMemory ?? 0 });
}

const WEAK_GPU = /swiftshader|llvmpipe|softpipe|software|microsoft basic|mali-|powervr|adreno|videocore|(?:uhd|hd) graphics (?:4\d\d|5\d\d|600|605)\b/i;

export const isWeakGpu = name => WEAK_GPU.test(String(name ?? ''));

export function gpuName(gl) {
  try {
    const info = gl?.getExtension?.('WEBGL_debug_renderer_info');
    if (info) return String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '');
    return String(gl?.getParameter?.(gl.RENDERER) ?? '');
  } catch {
    return '';
  }
}

function safeStorage(storage) {
  try { return storage ?? globalThis.localStorage ?? null; } catch { return null; }
}

export class GraphicsSettings {
  constructor({ storage, lowEnd = false } = {}) {
    this.storage = safeStorage(storage);
    this.listeners = new Set();
    const saved = this.read(KEY);
    this.chosen = isSetting(saved);
    this.lowEnd = !!lowEnd;
    this.setting = this.chosen ? saved : (this.lowEnd ? 'low' : 'auto');
    const savedAuto = this.read(AUTO_KEY);
    this.autoLevel = isLevel(savedAuto) ? savedAuto : (this.lowEnd ? 'low' : 'high');
  }

  read(key) { try { return this.storage?.getItem(key) ?? null; } catch { return null; } }
  write(key, value) { try { this.storage?.setItem(key, value); } catch { return; } }

  get level() { return this.setting === 'auto' ? this.autoLevel : this.setting; }
  get preset() { return GRAPHICS_PRESETS[this.level]; }

  set(setting) {
    if (!isSetting(setting)) return false;
    this.chosen = true;
    if (setting === 'auto') { this.autoLevel = 'high'; this.write(AUTO_KEY, 'high'); }
    if (setting === this.setting && setting !== 'auto') { this.write(KEY, setting); return false; }
    this.setting = setting;
    this.write(KEY, setting);
    this.emit();
    return true;
  }

  cycle() { this.set(nextSetting(this.setting)); return this.setting; }

  assessGpu(name) {
    if (this.chosen || !isWeakGpu(name)) return false;
    this.lowEnd = true;
    if (this.setting === 'low') return false;
    this.setting = 'low';
    this.autoLevel = 'low';
    this.emit();
    return true;
  }

  stepDown() {
    if (this.setting !== 'auto') return false;
    const lower = lowerLevel(this.autoLevel);
    if (lower === this.autoLevel) return false;
    this.autoLevel = lower;
    this.write(AUTO_KEY, lower);
    this.emit();
    return true;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of [...this.listeners]) { try { fn(this); } catch (error) { console.warn('[graphics] listener failed', error); } } }

  label() { return this.setting === 'auto' ? `AUTO · ${GRAPHICS_LABELS[this.autoLevel]}` : GRAPHICS_LABELS[this.setting]; }
}

export class AutoGraphics {
  constructor({ targetMs = 1000 / 60, windowFrames = 45, slowFactor = 1.25, strikesToDrop = 3, graceFrames = 150, hitchMs = 100, severeFactor = 2.2 } = {}) {
    Object.assign(this, { targetMs, windowFrames, slowFactor, strikesToDrop, graceFrames, hitchMs, severeFactor });
    this.reset();
  }

  reset() { this.sum = 0; this.n = 0; this.strikes = 0; this.skip = this.graceFrames; }

  sample(ms, strained = false) {
    if (!(ms > 0) || ms >= this.hitchMs) return false;
    if (this.skip > 0) { this.skip--; return false; }
    this.sum += ms; this.n++;
    if (this.n < this.windowFrames) return false;
    const avg = this.sum / this.n;
    this.sum = 0; this.n = 0;
    if (avg > this.targetMs * this.severeFactor) this.strikes += 2;
    else if (strained || avg > this.targetMs * this.slowFactor) this.strikes++;
    else this.strikes = Math.max(0, this.strikes - 1);
    if (this.strikes < this.strikesToDrop) return false;
    this.reset();
    return true;
  }
}
