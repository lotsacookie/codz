import { parseVector } from './bsp-parse.js';

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

export function extractLayout(parsed, buildDoor = () => null) {
  const { entities, models } = parsed;
  const origin = entity => toThree(parseVector(entity.origin));
  const layout = { spawn: null, sites: [], windows: [], doors: [], spawners: [] };

  const start = entities.find(e => e.classname === 'info_player_1_spawn') ?? entities.find(e => /^info_player/.test(e.classname));
  if (start) layout.spawn = { point: origin(start), yaw: entityYaw(start) };

  for (const entity of entities) {
    const role = NZP_ROLES[entity.classname];
    if (role && entity.origin) layout.sites.push({ role, point: origin(entity), yaw: entityYaw(entity) });
  }

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
