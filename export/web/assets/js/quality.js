export class AdaptiveResolution {
  constructor({ min = .65, max = 1, step = .1, targetMs = 1000 / 60, windowFrames = 40, hitchMs = 100, enabled = true } = {}) {
    Object.assign(this, { min, max, step, targetMs, windowFrames, hitchMs, enabled });
    this.scale = max; this.sum = 0; this.n = 0; this.stable = 0; this.holdWindows = 4; this.probed = false;
  }
  sample(ms) {
    if (!this.enabled || !(ms > 0) || ms >= this.hitchMs) return null; // ignore pauses, tab switches and load hitches
    this.sum += ms; this.n++;
    if (this.n < this.windowFrames) return null;
    const avg = this.sum / this.n; this.sum = 0; this.n = 0;
    if (avg > this.targetMs * 1.15 && this.scale > this.min) {
      if (this.probed) this.holdWindows = Math.min(64, this.holdWindows * 2);
      this.probed = false; this.stable = 0;
      this.scale = Math.max(this.min, +(this.scale - this.step).toFixed(3));
      return this.scale;
    }
    if (avg <= this.targetMs * 1.05 && this.scale < this.max) {
      this.probed = false;
      if (++this.stable >= this.holdWindows) {
        this.stable = 0; this.probed = true;
        this.scale = Math.min(this.max, +(this.scale + this.step / 2).toFixed(3));
        return this.scale;
      }
    } else if (this.scale >= this.max) this.stable = 0;
    return null;
  }
}

const TEXTURE_SLOTS = ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'lightMap'];
export function applyAnisotropy(root, level) {
  const seen = new Set();
  if (!(level > 1)) return 0;
  root.traverse(object => {
    for (const material of [].concat(object.material ?? [])) {
      for (const slot of TEXTURE_SLOTS) {
        const texture = material?.[slot];
        if (texture && !seen.has(texture)) { seen.add(texture); texture.anisotropy = Math.max(texture.anisotropy || 1, level); }
      }
    }
  });
  return seen.size;
}

export function applyDithering(root) {
  let count = 0;
  root.traverse(object => {
    for (const material of [].concat(object.material ?? [])) {
      if (material && 'dithering' in material && !material.dithering) { material.dithering = true; material.needsUpdate = true; count++; }
    }
  });
  return count;
}

export function createPerfOverlay(search = globalThis.location?.search ?? '', doc = globalThis.document) {
  if (!/[?&]perf=1\b/.test(search) || !doc) return null;
  const el = doc.createElement('div');
  el.style.cssText = 'position:fixed;left:6px;top:6px;z-index:99;font:11px/1.3 \'Helvetica Neue Medium Condensed 67\',\'Helvetica Neue\',\'Arial Narrow\',Arial,sans-serif;color:#9f9;background:#0008;padding:3px 6px;pointer-events:none;white-space:pre';
  doc.body.appendChild(el);
  const draw = (fps, scale, calls, triangles) => { el.textContent = `${fps} fps  scale ${scale.toFixed(2)}\n${calls} calls  ${(triangles / 1000).toFixed(0)}k tris`; };
  draw.remove = () => el.remove();
  return draw;
}
