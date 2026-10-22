import * as THREE from 'three';

const ROOT = 'ref/fly/footsteps/';
const MOVEMENTS = ['walk', 'run', 'sprint'];
const FALLBACK_ORDER = {
  walk: ['walk', 'run', 'sprint'],
  run: ['run', 'walk', 'sprint'],
  sprint: ['sprint', 'run', 'walk']
};
const SURFACE_ALIAS = { ice: 'concrete', water: 'water', mud: 'dirt', snow: 'snow', sand: 'sand', grass: 'grass' };

export const STRIDE = { walk: 44, run: 60, sprint: 78 };
export const PLAYER_STEP_GAIN = { walk: 0.3, run: 0.55, sprint: 0.7 };
export const ZOMBIE_STEP_GAIN = 0.34;
export const ZOMBIE_STEP_RANGE = 1100;
export const PRELOAD_SURFACES = ['concrete', 'wood', 'carpet', 'metal', 'dirt'];

export function stepPools(keys) {
  const pools = { walk: {}, run: {}, sprint: {}, land: {}, crawl: [], damage: [] };
  for (const key of keys) {
    if (!key.startsWith(ROOT)) continue;
    const parts = key.slice(ROOT.length).split('/');
    const [group, surface] = parts;
    if (group === 'prone' && surface === 'zmb') pools.crawl.push(key);
    else if (group === 'land' && surface === 'damage') pools.damage.push(key);
    else if (MOVEMENTS.includes(group) || group === 'land') (pools[group][surface] ??= []).push(key);
  }
  return pools;
}

export function normalizeSurface(surface) {
  return SURFACE_ALIAS[surface] ?? surface;
}

export function stepKeys(pools, movement, surface) {
  const wanted = normalizeSurface(surface);
  for (const gait of FALLBACK_ORDER[movement] ?? FALLBACK_ORDER.run) {
    const pool = pools[gait]?.[wanted];
    if (pool?.length) return pool;
  }
  for (const gait of FALLBACK_ORDER[movement] ?? FALLBACK_ORDER.run) {
    const pool = pools[gait]?.concrete;
    if (pool?.length) return pool;
  }
  return [];
}

export function pickStep(pools, movement, surface, last = null, random = Math.random) {
  const pool = stepKeys(pools, movement, surface);
  if (!pool.length) return undefined;
  if (pool.length === 1) return pool[0];
  let key = pool[Math.floor(random() * pool.length)];
  if (key === last) key = pool[(pool.indexOf(key) + 1) % pool.length];
  return key;
}

export function pickLanding(pools, surface, hard = false, random = Math.random) {
  if (hard && pools.damage.length) return pools.damage[Math.floor(random() * pools.damage.length)];
  const pool = pools.land[normalizeSurface(surface)] ?? pools.land.concrete ?? [];
  return pool.length ? pool[Math.floor(random() * pool.length)] : undefined;
}

export function pickCrawl(pools, last = null, random = Math.random) {
  const pool = pools.crawl;
  if (!pool.length) return undefined;
  let key = pool[Math.floor(random() * pool.length)];
  if (key === last && pool.length > 1) key = pool[(pool.indexOf(key) + 1) % pool.length];
  return key;
}

export function preloadStepKeys(pools, surfaces = PRELOAD_SURFACES) {
  const keys = [...pools.crawl];
  for (const surface of surfaces) {
    for (const gait of MOVEMENTS) keys.push(...(pools[gait][surface] ?? []));
    keys.push(...(pools.land[surface] ?? []));
  }
  return keys;
}

const RULES = [
  [/carpet|rug|curtain|cloth|velvet/, 'carpet'],
  [/wood|plank|board|parquet|floorboard/, 'wood'],
  [/metal|steel|grate|grating|rivet|gantry|iron|catwalk|deck/, 'metal'],
  [/grass|foliage|moss|leaf/, 'grass'],
  [/snow/, 'snow'],
  [/sand|beach/, 'sand'],
  [/water|puddle/, 'water'],
  [/dirt|mud|soil|gravel|rubble|trash|ground|earth|rock_rough|glo_dirt/, 'dirt'],
  [/concrete|tile|asphalt|stone|brick|plaster|marble|cement|sidewalk|floor|slate|rock/, 'concrete']
];

export function classifyMaterial(name, fallback = 'concrete') {
  const base = String(name ?? '').split(':')[0].toLowerCase();
  if (!base) return fallback;
  for (const [pattern, surface] of RULES) if (pattern.test(base)) return surface;
  return fallback;
}

export function createSurfaceResolver({ root, fallback = 'concrete', cell = 40, maxCache = 6000, minGapMs = 25, reach = 90, lift = 30 } = {}) {
  if (!root) return () => fallback;
  const cache = new Map();
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  let entries = null;
  let lastLookup = -Infinity;

  const collect = () => {
    entries = [];
    root.updateMatrixWorld(true);
    root.traverse(object => {
      if (!object.isMesh || !object.geometry || object.userData?.collisionOnly) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const box = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
      entries.push({ object, box });
    });
  };

  return (position, { cheap = false } = {}) => {
    const [x, y, z] = Array.isArray(position) ? position : [position.x, position.y, position.z];
    const keyed = `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
    const hit = cache.get(keyed);
    if (hit) return hit;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (cheap && now - lastLookup < minGapMs) return fallback;
    lastLookup = now;
    if (!entries) collect();
    origin.set(x, y + lift, z);
    raycaster.set(origin, down);
    raycaster.far = reach + lift;
    const candidates = [];
    for (const entry of entries) {
      const b = entry.box;
      if (!entry.object.visible || x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z || b.max.y < y - reach || b.min.y > y + lift) continue;
      candidates.push(entry.object);
    }
    let surface = fallback;
    if (candidates.length) {
      const hits = raycaster.intersectObjects(candidates, false);
      const first = hits[0];
      if (first) {
        const material = Array.isArray(first.object.material) ? first.object.material[first.face?.materialIndex ?? 0] : first.object.material;
        surface = classifyMaterial(material?.name, fallback);
      }
    }
    if (cache.size >= maxCache) cache.delete(cache.keys().next().value);
    cache.set(keyed, surface);
    return surface;
  };
}

export function bindPlayerFootsteps(player, getAudio) {
  if (!player) return;
  player.onFootstep = (type, movement, controller) => {
    const audio = getAudio?.();
    if (!audio) return;
    if (type === 'land') audio.playerLand(controller.getFeetPosition(), movement === 'hard');
    else audio.playerStep(movement, controller.getFeetPosition(), controller.crouched);
  };
}
