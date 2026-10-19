const toThree = ([x, y, z]) => [x, z, -y];

export const PERK_ROLES = {
  specialty_armorvest: 'specialty_armorvest',
  specialty_quickrevive: 'specialty_quickrevive',
  specialty_fastreload: 'specialty_fastreload',
  specialty_doubletap2: 'specialty_rof',
  specialty_rof: 'specialty_rof',
  specialty_staminup: 'specialty_longersprint',
  specialty_longersprint: 'specialty_longersprint',
  specialty_deadshot: 'specialty_deadshot',
  specialty_additionalprimaryweapon: 'specialty_additionalprimaryweapon',
  specialty_phdflopper: 'specialty_flakjacket',
  specialty_flakjacket: 'specialty_flakjacket',
};

const lower = value => String(value ?? '').toLowerCase();
const RISER = /^(?:riser_location|spawn_location|zombie_spawn_location|find_flesh_spawn)$/;
const ZONE_SPAWNER = /(?:^|_)zone_spawners?(?:_|$)|(?:^|_)spawners?$/;
const dedupe = (list, within) => list.filter((item, i) => !list.slice(0, i).some(other => Math.hypot(other.point[0] - item.point[0], other.point[2] - item.point[2]) < within && Math.abs(other.point[1] - item.point[1]) < 120));
const WINDOW_CLASS = /^zbarrier_.*(?:window|barricade|board)/i;

function lightOf(entity) {
  const color = String(entity._color ?? '1 1 1').trim().split(/\s+/).map(Number);
  const rgb = [0, 1, 2].map(i => (Number.isFinite(color[i]) ? Math.min(1, Math.max(0, color[i])) : 1));
  const radius = Number(entity.radius);
  const intensity = Math.max(90, (Number.isFinite(radius) && radius > 0 ? radius : 200) * 0.7);
  return { point: toThree(entity.origin), color: rgb, intensity };
}

function nearest(point, list, within = Infinity) {
  let best = null, bestDistance = within * within;
  for (const candidate of list) {
    const d = (candidate[0] - point[0]) ** 2 + (candidate[1] - point[1]) ** 2 + (candidate[2] - point[2]) ** 2;
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

export function extractIwmapLayout(entities) {
  const layout = { spawn: null, sites: [], windows: [], doors: [], spawners: [], walls: [], lights: [], environment: { sky: null, fog: null, skyColor: null } };
  const point = entity => toThree(entity.origin);
  const yaw = entity => entity.yaw ?? 0;

  const initial = entities.filter(e => e.classname === 'script_struct' && (lower(e.script_noteworthy) === 'initial_spawn' || lower(e.targetname) === 'initial_spawn_points'));
  const start = initial[0] ?? entities.find(e => e.classname === 'info_player_start');
  if (start) layout.spawn = { point: point(start), yaw: yaw(start) };

  for (const entity of entities) {
    const classname = lower(entity.classname);
    const targetname = lower(entity.targetname);
    const noteworthy = lower(entity.script_noteworthy);
    if (classname === 'light') {
      layout.lights.push(lightOf(entity));
    } else if (targetname === 'zm_perk_machine' || PERK_ROLES[noteworthy]) {
      const role = PERK_ROLES[noteworthy];
      if (role) layout.sites.push({ role, point: point(entity), yaw: yaw(entity) });
    } else if (/^zbarrier_zmcore_packapunch/.test(classname) || targetname === 'zm_pack_a_punch') {
      layout.sites.push({ role: 'pack', point: point(entity), yaw: yaw(entity) });
    } else if (/^zbarrier_zmcore_magicbox/.test(classname) || (classname === 'script_struct' && targetname === 'treasure_chest_use')) {
      layout.sites.push({ role: 'chest', point: point(entity), yaw: yaw(entity) });
    } else if (classname === 'weapon_wall' || (classname === 'script_struct' && /^weapon_upgrade|^wallbuy|^zm_weapon_wall/.test(targetname))) {
      layout.walls.push({ point: point(entity), yaw: yaw(entity) });
    } else if (classname === 'script_struct' && (RISER.test(noteworthy) || (ZONE_SPAWNER.test(targetname) && /^(?:riser|spawn)/.test(noteworthy)))) {
      layout.spawners.push(point(entity));
    } else if ((classname === 'script_struct' && targetname === 'exterior_goal') || WINDOW_CLASS.test(classname)) {
      layout.windows.push({ point: point(entity), yaw: yaw(entity), spawner: null, spawners: [] });
    }
  }

  layout.sites = dedupeSites(layout.sites);
  layout.windows = dedupe(layout.windows.map(w => ({ ...w })), 60);
  layout.walls = dedupe(layout.walls, 40);
  for (const window of layout.windows) {
    const hit = nearest(window.point, layout.spawners, 900);
    if (hit) {
      window.spawner = hit;
      window.spawners = [hit];
    }
  }
  return layout;
}

// The stock mod-tools prefab and the map's own struct both mark a box spot: keep one of each.
function dedupeSites(sites) {
  const out = [];
  for (const site of sites) {
    const twin = out.find(o => o.role === site.role && Math.hypot(o.point[0] - site.point[0], o.point[2] - site.point[2]) < (site.role === 'chest' ? 140 : 80) && Math.abs(o.point[1] - site.point[1]) < 120);
    if (!twin) out.push(site);
  }
  return out;
}

const flat2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export function playArea(layout, { margin = 3000, spawnReach = 9000, linkReach = 4500, height = 3000 } = {}) {
  const anchors = [...layout.sites.map(s => s.point), ...layout.windows.map(w => w.point)];
  if (!anchors.length) return null;
  // Zombie spawners and wall buys near the perks belong to the same level: they widen the box so the
  // outer rooms are drawn too. A spawner far from every anchor is another section of the map.
  const linked = [...layout.spawners].filter(p => anchors.some(a => flat2(a, p) < linkReach && Math.abs(a[1] - p[1]) < height));
  anchors.push(...linked);
  const spawnNear = layout.spawn && anchors.some(a => flat2(a, layout.spawn.point) < spawnReach && Math.abs(a[1] - layout.spawn.point[1]) < height);
  const points = spawnNear ? [...anchors, layout.spawn.point] : anchors;
  const min = [0, 1, 2].map(i => Math.min(...points.map(p => p[i])) - (i === 1 ? height : margin));
  const max = [0, 1, 2].map(i => Math.max(...points.map(p => p[i])) + (i === 1 ? height : margin));
  let spawn = layout.spawn;
  let relocated = false;
  if (!spawnNear) {
    const centre = [0, 1, 2].map(i => anchors.reduce((sum, p) => sum + p[i], 0) / anchors.length);
    const site = layout.sites.length ? layout.sites : layout.windows;
    const pick = site.reduce((best, s) => (flat2(s.point, centre) < flat2(best.point, centre) ? s : best));
    spawn = { point: [...pick.point], yaw: pick.yaw ?? 0 };
    relocated = true;
  }
  return { min, max, spawn, relocated };
}

export const inArea = (area, [x, y, z], pad = 0) => x >= area.min[0] - pad && x <= area.max[0] + pad && y >= area.min[1] - pad && y <= area.max[1] + pad && z >= area.min[2] - pad && z <= area.max[2] + pad;

export function restrictLayout(layout, area) {
  return {
    ...layout,
    spawn: area.spawn,
    spawners: layout.spawners.filter(p => inArea(area, p)),
    windows: layout.windows.filter(w => inArea(area, w.point)),
    walls: (layout.walls ?? []).filter(w => inArea(area, w.point)),
    lights: layout.lights.filter(l => inArea(area, l.point, 1500)),
  };
}
