import { parseIwmap, parseVector } from './iwmap-parse.js';
import { brushPolygons, patchPolygons } from './iwmap-brush.js';

const MAX_DEPTH = 8;
const IDENTITY = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
const RAD = Math.PI / 180;

export function rotationFromAngles([pitch, yaw, roll]) {
  const cp = Math.cos(pitch * RAD), sp = Math.sin(pitch * RAD);
  const cy = Math.cos(yaw * RAD), sy = Math.sin(yaw * RAD);
  const cr = Math.cos(roll * RAD), sr = Math.sin(roll * RAD);
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr,
    -sp, cp * sr, cp * cr,
  ];
}

const multiply = (a, b) => {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
};

export const applyTransform = (transform, [x, y, z]) => {
  const m = transform.m, t = transform.t;
  return [m[0] * x + m[1] * y + m[2] * z + t[0], m[3] * x + m[4] * y + m[5] * z + t[1], m[6] * x + m[7] * y + m[8] * z + t[2]];
};

export const compose = (parent, origin, angles, modelScale = 1) => {
  const local = rotationFromAngles(angles).map(v => v * modelScale);
  return { m: multiply(parent.m, local), t: applyTransform(parent, origin) };
};

export const yawOf = transform => Math.atan2(transform.m[3], transform.m[0]) / RAD;

export function normalizeName(name) {
  return String(name).replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
}

export function createPrefabIndex(files) {
  const index = new Map();
  for (const [name, content] of files) {
    const key = normalizeName(name);
    if (!key.endsWith('.map')) continue;
    index.set(key, content);
    const at = key.indexOf('_prefabs/');
    if (at > 0) index.set(key.slice(at), content);
  }
  return index;
}

export function createResolver(files) {
  const index = createPrefabIndex(files);
  const parsed = new Map();
  return model => {
    const key = normalizeName(model);
    if (parsed.has(key)) return parsed.get(key);
    let content = index.get(key);
    if (content === undefined) {
      const tail = `/${key}`;
      for (const [name, value] of index) {
        if (name.endsWith(tail)) {
          content = value;
          break;
        }
      }
    }
    let result = null;
    if (content !== undefined) {
      try {
        result = parseIwmap(typeof content === 'string' ? content : new TextDecoder().decode(content));
      } catch {
        result = null;
      }
    }
    parsed.set(key, result);
    return result;
  };
}

// The mod tools ship these prefabs, so a map's own folder rarely has them. What they stand for is clear
// from the name, so a missing one still leaves a marker at its place.
const STOCK_PREFABS = [
  [/(?:barricade|window)(?!.*(?:shutter|clip))/i, 'exterior_goal'],
  [/spawnable_weapon|wallbuy|weapon_wall/i, 'weapon_wall'],
  [/(?:^|[/_])packapunch/i, 'pack'],
  [/(?:^|[/_])magicbox(?!_platform)|(?:^|[/_])treasure_chest/i, 'chest'],
];

export function stockMarker(model, placed) {
  const name = normalizeName(model);
  const hit = STOCK_PREFABS.find(([pattern]) => pattern.test(name));
  if (!hit) return null;
  const base = { origin: placed.t, yaw: yawOf(placed), stock: name };
  switch (hit[1]) {
    case 'exterior_goal': return { ...base, classname: 'script_struct', targetname: 'exterior_goal' };
    case 'weapon_wall': return { ...base, classname: 'weapon_wall' };
    case 'pack': return { ...base, classname: 'zbarrier_zmcore_packapunch' };
    default: return { ...base, classname: 'zbarrier_zmcore_MagicBox' };
  }
}

export function flattenIwmap(map, { resolve = () => null, all = false } = {}) {
  const polygons = [];
  const entities = [];
  const stats = { brushes: 0, patches: 0, prefabs: 0, missingPrefabs: new Set(), models: 0 };
  const polygonCache = new WeakMap();
  const brushModels = new Map();

  const walk = (parsed, transform, depth, chain) => {
    for (const entity of parsed.entities) {
      const keys = entity.keys;
      const classname = keys.classname;
      let shape = null;
      if (classname !== 'worldspawn' && (entity.brushes.length || entity.patches?.length) && keys.targetname) {
        // Brush entities (doors, debris) are kept apart from the level so they can be bought away.
        const name = keys.targetname.toLowerCase();
        const list = brushModels.get(name) ?? [];
        for (const polygon of [...entity.brushes.flatMap(brush => brushPolygons(brush, { all: true })), ...(entity.patches ?? []).flatMap(patch => patchPolygons(patch, { all: true }))]) {
          list.push({ material: polygon.material, double: polygon.double, points: polygon.points.map(p => applyTransform(transform, p)) });
        }
        brushModels.set(name, list);
        if (/^trigger_/.test(classname)) shape = list.slice(-entity.brushes.length * 6 || undefined);
      }
      if (classname === 'worldspawn') {
        let local = polygonCache.get(entity);
        if (!local) {
          local = [...entity.brushes.flatMap(brush => brushPolygons(brush, { all })), ...(entity.patches ?? []).flatMap(patch => patchPolygons(patch, { all }))];
          polygonCache.set(entity, local);
        }
        stats.brushes += entity.brushes.length;
        stats.patches += entity.patches?.length ?? 0;
        for (const polygon of local) {
          polygons.push({ material: polygon.material, double: polygon.double, points: transform === IDENTITY ? polygon.points : polygon.points.map(p => applyTransform(transform, p)) });
        }
        continue;
      }
      const origin = parseVector(keys.origin);
      const angles = keys.angles ? parseVector(keys.angles) : [0, Number(keys.angle) || 0, 0];
      if (classname === 'misc_prefab') {
        const model = keys.model;
        if (!model || depth >= MAX_DEPTH) continue;
        const child = chain.has(model) ? null : resolve(model);
        if (!child) {
          if (!chain.has(model)) stats.missingPrefabs.add(model);
          const marker = stockMarker(model, compose(transform, origin, angles));
          if (marker) entities.push(marker);
          continue;
        }
        stats.prefabs++;
        const next = new Set(chain).add(model);
        walk(child, compose(transform, origin, angles, Number(keys.modelscale) || 1), depth + 1, next);
        continue;
      }
      if (classname === 'misc_model' || classname === 'script_model') stats.models++;
      const placed = compose(transform, origin, angles);
      entities.push({ ...keys, classname, origin: placed.t, yaw: yawOf(placed), ...(shape ? { shape } : {}) });
    }
  };

  walk(map, IDENTITY, 0, new Set());
  stats.missingPrefabs = [...stats.missingPrefabs];
  return { polygons, entities, stats, brushModels };
}
