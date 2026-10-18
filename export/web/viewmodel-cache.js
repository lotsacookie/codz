// Small LRU of promises for built viewmodels. Switching guns used to rebuild the hands, the gun, every knife and
// every animation clip from scratch (the one second freeze); keeping the built models makes a switch instant.
// `evict(value)` runs for entries pushed out; entries named in `keep` are never evicted.
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

// Builds the viewmodels of the guns that are equipped but not in hand, one per task so no single frame pays for
// them, so a later switch finds them ready. `session` needs inventory, slot and def (rules.js sessions do);
// `adjust` lets the caller change a def the way it does when equipping it (for example the hands model).
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

// Compiles the shaders and uploads the textures of a built viewmodel ahead of its first frame in hand.
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
