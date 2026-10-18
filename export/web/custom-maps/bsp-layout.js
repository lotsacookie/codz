import { parseVector } from './bsp-parse.js';
import { lightsFromEntities } from './lights.js';

// NZ:P entity classname -> the game's perk id.
export const NZP_ROLES = {
  perk_juggernog: 'specialty_armorvest',
  perk_revive: 'specialty_quickrevive',
  perk_speed: 'specialty_fastreload',
  perk_double: 'specialty_rof',
  perk_staminup: 'specialty_longersprint',
  perk_deadshot: 'specialty_deadshot',
  perk_mule: 'specialty_additionalprimaryweapon',
  perk_flopper: 'specialty_flakjacket',
  perk_phd: 'specialty_flakjacket',
  perk_pap: 'pack',
  mystery_box: 'chest',
};

// Quake is Z-up with Y forward; three.js is Y-up. This is a rotation, so handedness is kept.
export const toThree = ([x, y, z]) => [x, z, -y];

export function entityYaw(entity) {
  if (entity.angles) return parseVector(entity.angles)[1];
  const angle = Number(entity.angle);
  return Number.isFinite(angle) && angle >= 0 ? angle : 0;
}

function boundsOf(model) {
  const a = toThree(model.mins), b = toThree(model.maxs);
  return { min: a.map((v, i) => Math.min(v, b[i])), max: a.map((v, i) => Math.max(v, b[i])) };
}

// worldspawn: `fog` is "start end r g b" (colour 0-255), `sky` names the skybox, `r_skycolor` a flat sky colour.
export function extractEnvironment(entities) {
  const world = entities.find(e => e.classname === 'worldspawn') ?? {};
  const get = key => world[key] ?? world[` ${key}`];
  const env = { sky: String(get('sky') ?? '').trim().toLowerCase() || null, fog: null, skyColor: null };
  const fog = String(get('fog') ?? '').trim().split(/\s+/).map(Number);
  if (fog.length >= 5 && fog.every(Number.isFinite) && fog[1] > fog[0]) env.fog = { near: fog[0], far: fog[1], color: fog.slice(2, 5).map(v => Math.min(255, Math.max(0, v)) / 255) };
  const skyColor = String(get('r_skycolor') ?? '').trim().split(/\s+/).map(Number);
  if (skyColor.length >= 3 && skyColor.slice(0, 3).every(Number.isFinite)) env.skyColor = skyColor.slice(0, 3).map(v => Math.min(255, Math.max(0, v)) / 255);
  return env;
}

export function extractLayout(parsed, buildDoor = () => null) {
  const { entities, models } = parsed;
  const origin = entity => toThree(parseVector(entity.origin));
  const layout = { spawn: null, sites: [], windows: [], doors: [], spawners: [], walls: [], lights: lightsFromEntities(entities, parseVector, toThree), environment: extractEnvironment(entities) };

  const start = entities.find(e => e.classname === 'info_player_1_spawn') ?? entities.find(e => /^info_player/.test(e.classname));
  if (start) layout.spawn = { point: origin(start), yaw: entityYaw(start) };

  for (const entity of entities) {
    const role = NZP_ROLES[entity.classname];
    if (role && entity.origin) layout.sites.push({ role, point: origin(entity), yaw: entityYaw(entity) });
  }

  const displays = entities.filter(e => e.classname === 'weapon_wall' && e.origin);
  const linked = new Set();
  const facing = e => (e.angles || e.angle !== undefined ? entityYaw(e) : null);
  for (const entity of entities.filter(e => e.classname === 'buy_weapon')) {
    const match = /^\*(\d+)$/.exec(entity.model ?? '');
    const model = match && models[Number(match[1])];
    const display = entity.target ? displays.find(d => String(d.targetname ?? '').toLowerCase() === String(entity.target).toLowerCase()) : null;
    if (display) linked.add(display);
    let point = null;
    if (model && model.faceCount) {
      const box = boundsOf(model);
      point = box.min.map((v, i) => (v + box.max[i]) / 2);
      if (display) point[1] = origin(display)[1];
    } else if (display) point = origin(display);
    else if (entity.origin) point = origin(entity);
    if (point) layout.walls.push({ point, yaw: display ? facing(display) : null });
  }
  for (const display of displays) if (!linked.has(display)) layout.walls.push({ point: origin(display), yaw: facing(display) });

  const spawners = entities.filter(e => e.classname === 'spawn_zombie' && e.origin);
  layout.spawners = spawners.map(origin);
  for (const entity of entities.filter(e => e.classname === 'item_barricade' && e.origin)) {
    const spawner = entity.targetname ? spawners.find(s => s.target === entity.targetname) : null;
    layout.windows.push({ point: origin(entity), yaw: entityYaw(entity), spawner: spawner ? origin(spawner) : null });
  }

  let doorIndex = 0;
  for (const entity of entities.filter(e => e.classname === 'func_door_nzp')) {
    const match = /^\*(\d+)$/.exec(entity.model ?? '');
    const model = match && models[Number(match[1])];
    if (!model || !model.faceCount) continue;
    const object = buildDoor(Number(match[1]));
    if (!object) continue;
    layout.doors.push({ name: `nzp_door_${doorIndex++}`, cost: Number(entity.cost) || 750, ...boundsOf(model), object });
  }
  return layout;
}
