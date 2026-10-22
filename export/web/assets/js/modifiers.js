export const MODIFIERS = [
  { id: 'endless', label: 'Endless Horde', description: 'Zombies keep spawning after the round count has spawned. The next round starts the moment that many are killed, with no break and no dog rounds.' },
  { id: 'no_perk_limit', label: 'No Perk Limit', description: 'Buy every perk you can afford. Removes the four-perk cap.' },
  { id: 'keep_perks', label: 'Perks Never Drop', description: 'Keep all your perks when you go down.' },
  { id: 'infinite_ammo', label: 'Infinite Ammo', description: 'Shooting never uses up the magazine.' },
  { id: 'insta_kill', label: 'Permanent Insta-Kill', description: 'Every hit kills.' },
  { id: 'double_points', label: 'Double Points', description: 'All points earned are doubled, and stack with the Double Points power-up.' },
  { id: 'rich_start', label: 'Rich Start', description: 'Begin with 50,000 points.' },
  { id: 'tank_zombies', label: 'Tank Zombies', description: 'Zombies have three times the health.' },
  { id: 'glass_cannon', label: 'Glass Cannon', description: 'One hit takes you down.' },
];

const KEY = 'codz-modifiers';
const known = new Set(MODIFIERS.map(m => m.id));
const listeners = new Set();
let current = null;

function readStored() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(id => known.has(id)) : []);
  } catch {
    return new Set();
  }
}

function persist() {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify([...current])); } catch {}
  for (const listener of listeners) listener(new Set(current));
}

export function activeModifiers() {
  current ??= readStored();
  return new Set(current);
}

export function hasModifier(id) {
  current ??= readStored();
  return current.has(id);
}

export function setModifier(id, on) {
  if (!known.has(id)) return;
  current ??= readStored();
  if (on) current.add(id); else current.delete(id);
  persist();
}

export function clearModifiers() {
  current = new Set();
  persist();
}

export function onModifiersChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
