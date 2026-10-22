export const POWERUP_TYPES = ['nuke', 'insta_kill', 'double_points', 'full_ammo', 'carpenter', 'fire_sale'];

const finite = value => Number.isFinite(Number(value));
const coord = value => Math.round(Number(value) * 10) / 10;
const inRange = value => Math.abs(Number(value)) <= 1e6;
const cleanId = value => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < 2 ** 31 ? n : null;
};
const cleanType = value => (POWERUP_TYPES.includes(value) ? value : null);
const cleanArea = value => String(value ?? '').slice(0, 24);
const cleanPeer = value => String(value ?? '').replace(/[^a-z0-9_.:-]/gi, '').slice(0, 64);

function cleanPosition(raw) {
  if (![raw.x, raw.y, raw.z].every(finite) || ![raw.x, raw.y, raw.z].every(inRange)) return null;
  return { x: Number(raw.x), y: Number(raw.y), z: Number(raw.z) };
}

export function packDrop({ id, type, position, area = '' }) {
  return { i: id | 0, t: type, x: coord(position.x), y: coord(position.y), z: coord(position.z), a: cleanArea(area) };
}

export function cleanDrop(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanId(raw.i), type = cleanType(raw.t), position = cleanPosition(raw);
  if (id === null || !type || !position) return null;
  return { id, type, position, area: cleanArea(raw.a) };
}

export function packTake(id) {
  return { i: id | 0 };
}

export function cleanTake(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanId(raw.i);
  return id === null ? null : { id };
}

export function packGrab({ id, type, position, by }) {
  return { i: id | 0, t: type, x: coord(position.x), y: coord(position.y), z: coord(position.z), b: cleanPeer(by) };
}

export function cleanGrab(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanId(raw.i), type = cleanType(raw.t), position = cleanPosition(raw);
  if (id === null || !type || !position) return null;
  return { id, type, position, by: cleanPeer(raw.b) };
}
