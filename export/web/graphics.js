// One "Graphics" setting drives every lighting effect: sun shadows, god rays and dust motes.
//   auto   starts at HIGH and steps down (HIGH -> MEDIUM -> LOW) while the frame rate stays low
//   high   cascaded shadows (2048) + god rays + motes
//   medium cascaded shadows (1024), no god rays
//   low    no shadows, no god rays; the sun is dimmed a little so the scene reads slightly dark
export const GRAPHICS_LEVELS = Object.freeze(['high', 'medium', 'low']);
export const GRAPHICS_SETTINGS = Object.freeze(['auto', ...GRAPHICS_LEVELS]);

export const LOW_SUN_SCALE = 0.7;

export const GRAPHICS_PRESETS = Object.freeze({
  high: Object.freeze({ shadows: true, shadowMapSize: 2048, godRays: true, sunScale: 1 }),
  medium: Object.freeze({ shadows: true, shadowMapSize: 1024, godRays: false, sunScale: 1 }),
  low: Object.freeze({ shadows: false, shadowMapSize: 0, godRays: false, sunScale: LOW_SUN_SCALE })
});

export const GRAPHICS_LABELS = Object.freeze({ auto: 'AUTO', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' });

const KEY = 'codz.graphics';
const AUTO_KEY = 'codz.graphics.auto';

export const isSetting = value => GRAPHICS_SETTINGS.includes(value);
export const isLevel = value => GRAPHICS_LEVELS.includes(value);
export const nextSetting = setting => GRAPHICS_SETTINGS[(GRAPHICS_SETTINGS.indexOf(setting) + 1) % GRAPHICS_SETTINGS.length];
export const lowerLevel = level => GRAPHICS_LEVELS[Math.min(GRAPHICS_LEVELS.length - 1, GRAPHICS_LEVELS.indexOf(level) + 1)] ?? 'low';

function safeStorage(storage) {
  try { return storage ?? globalThis.localStorage ?? null; } catch { return null; }
}

export class GraphicsSettings {
  constructor({ storage } = {}) {
    this.storage = safeStorage(storage);
    this.listeners = new Set();
    const saved = this.read(KEY);
    this.setting = isSetting(saved) ? saved : 'auto';
    const savedAuto = this.read(AUTO_KEY);
    this.autoLevel = isLevel(savedAuto) ? savedAuto : 'high';
  }

  read(key) { try { return this.storage?.getItem(key) ?? null; } catch { return null; } }
  write(key, value) { try { this.storage?.setItem(key, value); } catch { /* storage can be unavailable */ } }

  /** The level actually in effect (never 'auto'). */
  get level() { return this.setting === 'auto' ? this.autoLevel : this.setting; }
  get preset() { return GRAPHICS_PRESETS[this.level]; }

  set(setting) {
    if (!isSetting(setting)) return false;
    if (setting === 'auto') { this.autoLevel = 'high'; this.write(AUTO_KEY, 'high'); }
    if (setting === this.setting && setting !== 'auto') return false;
    this.setting = setting;
    this.write(KEY, setting);
    this.emit();
    return true;
  }

  cycle() { this.set(nextSetting(this.setting)); return this.setting; }

  /** Auto mode only: drop one level because the frame rate is too low. Returns true if it changed. */
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

// Watches frame times while the game is running and says when Auto should drop a level.
// Frames right after start / a level change are ignored (shader compiles hitch), as are
// long hitches (tab switches, pauses).
export class AutoGraphics {
  constructor({ targetMs = 1000 / 60, windowFrames = 60, slowFactor = 1.25, strikesToDrop = 3, graceFrames = 240, hitchMs = 100 } = {}) {
    Object.assign(this, { targetMs, windowFrames, slowFactor, strikesToDrop, graceFrames, hitchMs });
    this.reset();
  }

  reset() { this.sum = 0; this.n = 0; this.strikes = 0; this.skip = this.graceFrames; }

  // strained: the resolution scaler has already had to shrink the picture, which counts as lag too.
  sample(ms, strained = false) {
    if (!(ms > 0) || ms >= this.hitchMs) return false;
    if (this.skip > 0) { this.skip--; return false; }
    this.sum += ms; this.n++;
    if (this.n < this.windowFrames) return false;
    const avg = this.sum / this.n;
    this.sum = 0; this.n = 0;
    if (strained || avg > this.targetMs * this.slowFactor) this.strikes++;
    else this.strikes = Math.max(0, this.strikes - 1);
    if (this.strikes < this.strikesToDrop) return false;
    this.reset();
    return true;
  }
}
