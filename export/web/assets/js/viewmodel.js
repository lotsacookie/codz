const TAU = Math.PI * 2;
const damp = (from, to, rate, dt) => to + (from - to) * Math.exp(-rate * dt);

export const BOB = {
  walk: { rate: 1.05, x: 0.07, y: 0.05, z: 0.014, roll: 0.032, pitch: 0.018, yaw: 0.016 },
  sprint: { rate: 1.6, x: 0.11, y: 0.075, z: 0.03, roll: 0.055, pitch: 0.03, yaw: 0.026 }
};

export class ViewmodelBob {
  constructor() {
    this.phase = 0;
    this.amount = 0;
    this.sprint = 0;
    this.out = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  }

  reset() {
    this.phase = 0;
    this.amount = 0;
    this.sprint = 0;
    this.out = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  }

  update(dt, { moving = false, sprint = false, aim = 0, scale = 1 } = {}) {
    const target = moving ? 1 - aim * 0.9 : 0;
    this.amount = damp(this.amount, target, moving ? 9 : 7, dt);
    this.sprint = damp(this.sprint, sprint ? 1 : 0, 6, dt);
    if (this.amount < 0.002) {
      this.amount = 0;
      this.out = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
      return this.out;
    }
    const rate = BOB.walk.rate + (BOB.sprint.rate - BOB.walk.rate) * this.sprint;
    this.phase = (this.phase + dt * rate * TAU * (0.35 + 0.65 * this.amount)) % TAU;
    const mix = key => BOB.walk[key] + (BOB.sprint[key] - BOB.walk[key]) * this.sprint;
    const a = this.amount * scale;
    const side = Math.sin(this.phase);
    const step = Math.sin(this.phase * 2);
    const drop = -Math.abs(Math.sin(this.phase)) * 2 + 1;
    this.out = {
      x: side * mix('x') * a,
      y: (drop * 0.5 + step * 0.15) * mix('y') * a,
      z: Math.cos(this.phase * 2) * mix('z') * a,
      rx: -drop * mix('pitch') * a * 0.6 + step * mix('pitch') * a * 0.3,
      ry: -side * mix('yaw') * a,
      rz: -side * mix('roll') * a
    };
    return this.out;
  }
}

export class ViewmodelCache {
  constructor(limit = 6, evict = () => {}) {
    this.limit = limit;
    this.evict = evict;
    this.map = new Map();
  }
  has(key) { return this.map.has(key); }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  set(key, value, keep = new Set()) {
    this.map.delete(key);
    this.map.set(key, value);
    for (const [oldKey, oldValue] of this.map) {
      if (this.map.size <= this.limit) break;
      if (oldKey === key || keep.has(oldKey)) continue;
      this.map.delete(oldKey);
      this.evict(oldValue, oldKey);
    }
  }
  delete(key) { this.map.delete(key); }
  clear() {
    const values = [...this.map];
    this.map.clear();
    for (const [key, value] of values) this.evict(value, key);
  }
}

export function prefetchOtherSlots(session, view, { adjust = def => def, onBuilt = null } = {}) {
  const held = session.slot, defs = [];
  try {
    for (let i = 0; i < session.inventory.length; i++) {
      if (i === held) continue;
      session.slot = i;
      defs.push(adjust({ ...session.def }));
    }
  } finally { session.slot = held; }
  defs.reduce((chain, def) => chain.then(() => new Promise(resolve => setTimeout(resolve, 0)))
    .then(() => view.prepare(def)).then(entry => onBuilt?.(entry)).catch(() => {}), Promise.resolve());
  return defs.length;
}

export function prefetchWeapon(def, view, { onBuilt = null } = {}) {
  return new Promise(resolve => setTimeout(resolve, 0))
    .then(() => view.prepare(def))
    .then(entry => { onBuilt?.(entry); return entry; })
    .catch(() => null);
}

export function createOfferPrefetch({ weapons, view, adjust = def => def, onBuilt = null, warmAudio = null }) {
  return id => {
    const base = weapons?.[id];
    if (!base || !view) return null;
    try { warmAudio?.(base); } catch {}
    return prefetchWeapon(adjust({ ...base }), view, { onBuilt });
  };
}

export function warmEntry(renderer, scene, camera, entry) {
  if (!renderer || !entry?.root) return;
  try {
    renderer.compile(entry.root, camera, scene);
    entry.root.traverse(object => {
      for (const material of [object.material].flat()) {
        if (!material) continue;
        for (const value of Object.values(material)) if (value?.isTexture) renderer.initTexture(value);
      }
    });
  } catch (error) { console.warn('[viewmodel] warm-up skipped', error); }
}

const HANDS_STORAGE_KEY = 'codz.hands';
const HANDS_VARIANTS = [
  { id: 'arms', label: 'ARMS', character: 'viewmodel_usa_pow_arms' },
  { id: 'gloves', label: 'GLOVES', character: 'viewhands_usmc' },
];

const validHands = value => HANDS_VARIANTS.some(v => v.id === value);

function initialHands() {
  try {
    const stored = localStorage.getItem(HANDS_STORAGE_KEY);
    if (validHands(stored)) return stored;
  } catch {}
  try {
    const queried = new URLSearchParams(location.search).get('hands');
    if (validHands(queried)) return queried;
  } catch {}
  return HANDS_VARIANTS[0].id;
}

let currentHands = initialHands();

export function getHands() {
  return currentHands;
}

export function setHands(id) {
  if (!validHands(id)) return currentHands;
  currentHands = id;
  try { localStorage.setItem(HANDS_STORAGE_KEY, id); } catch {}
  return currentHands;
}

export function cycleHands() {
  const index = HANDS_VARIANTS.findIndex(v => v.id === currentHands);
  return setHands(HANDS_VARIANTS[(index + 1) % HANDS_VARIANTS.length].id);
}

export function handsLabel() {
  return HANDS_VARIANTS.find(v => v.id === currentHands)?.label ?? HANDS_VARIANTS[0].label;
}

export function handsModelFor(characters) {
  const variant = HANDS_VARIANTS.find(v => v.id === currentHands);
  if (!variant || variant.id === HANDS_VARIANTS[0].id) return undefined;
  return characters?.[variant.character] ?? undefined;
}
