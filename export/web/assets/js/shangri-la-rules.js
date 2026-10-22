const isDoorTrigger = e => e.targetname === 'zombie_door' || e.targetname === 'zombie_debris';
const number = (value, fallback) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };

export function doorGroups(entities) {
  const groups = new Map();
  for (const trigger of entities.filter(isDoorTrigger)) {
    if (!trigger.target) continue;
    const group = groups.get(trigger.target) ?? { name: trigger.target, kind: trigger.targetname === 'zombie_debris' ? 'debris' : 'door', cost: 0, flag: trigger.script_flag ?? trigger.target, triggers: [], parts: [], clips: [] };
    group.cost = Math.max(group.cost, number(trigger.zombie_cost, 0));
    group.triggers.push(trigger.id);
    groups.set(trigger.target, group);
  }
  for (const entity of entities) {
    if (isDoorTrigger(entity)) continue;
    let group = groups.get(entity.targetname);
    if (!group && entity.targetname === 'rolling_door') group = [...groups.values()].find(g => g.flag === entity.script_string);
    if (!group) continue;
    if (entity.script_noteworthy === 'clip') group.clips.push(entity.id);
    else group.parts.push(entity.id);
  }
  return [...groups.values()];
}

export function barrierGroups(entities) {
  const byName = new Map();
  for (const entity of entities) {
    if (!entity.targetname) continue;
    if (!byName.has(entity.targetname)) byName.set(entity.targetname, []);
    byName.get(entity.targetname).push(entity);
  }
  return entities.filter(e => e.targetname === 'exterior_goal' && e.target).map(goal => {
    const members = byName.get(goal.target) ?? [];
    const boards = members.filter(m => m.script_parameters === 'board' || m.script_parameters?.startsWith('barricade_'))
      .sort((a, b) => number(a.script_noteworthy, 0) - number(b.script_noteworthy, 0)).map(m => m.id);
    const clip = members.find(m => m.script_noteworthy === 'clip' && m.classname === 'script_brushmodel')?.id ?? null;
    const anchor = members.find(m => m.classname === 'script_struct');
    return { id: goal.id, name: goal.target, outside: goal.position, inside: anchor?.position ?? goal.position, clip, boards };
  }).filter(b => b.boards.length > 0);
}

export function movingEntityIds(entities) {
  const ids = new Set();
  for (const group of doorGroups(entities)) { for (const id of group.parts) ids.add(id); for (const id of group.clips) ids.add(id); }
  for (const barrier of barrierGroups(entities)) { for (const id of barrier.boards) ids.add(id); if (barrier.clip !== null) ids.add(barrier.clip); }
  return ids;
}

export function wallWeapons(entities) {
  return entities.filter(e => e.targetname === 'weapon_upgrade' && e.zombie_weapon_upgrade).map(e => ({ id: e.id, weapon: e.zombie_weapon_upgrade, position: e.position, yaw: e.yaw }));
}

export function boxLocations(entities) {
  return entities.filter(e => e.targetname === 'treasure_chest_use' && e.target && e.script_noteworthy);
}

export function spawnPoints(entities) {
  return entities.filter(e => e.script_noteworthy === 'zombie_spawner' && e.position).map(e => ({ id: e.id, position: e.position, name: e.targetname }));
}

export function powerSwitches(entities) {
  return entities.filter(e => e.targetname === 'power_trigger_left' || e.targetname === 'power_trigger_right');
}
