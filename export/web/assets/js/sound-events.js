// Maps the game's generic event cues onto the reference (T5) sound aliases so every
// purchase, board, door, power, teleport, pickup and body fall uses the real clips.
const ZG = 'ref/evt/zombie_global/';
// Each layer: prefix (picked at random from the manifest), gain, delay in ms.
export const EVENT_LAYERS = {
  buy: () => [{ prefix: ZG + 'purchase/accept/', gain: 1 }],
  deny: () => [{ prefix: ZG + 'purchase/deny/', gain: 1 }],
  board: () => [{ prefix: ZG + 'boards/repair/', gain: 1 }],
  boardTear: () => [{ prefix: ZG + 'boards/snap/', gain: 1 }, { prefix: ZG + 'boards/slam/', gain: .6, delay: 60 }],
  teleport: () => [{ prefix: ZG + 'teleporter/teleport_2d_fnt', gain: 1 }, { prefix: ZG + 'teleporter/teleport_2d_rear', gain: .7 }],
  explosion: () => [{ prefix: 'ref/exp/generic/explosion/', gain: 1 }],
  door: () => [{ prefix: ZG + 'doors/slide/open/', gain: 1 }],
  doorWood: () => [{ prefix: ZG + 'doors/wood/', gain: 1 }],
  doorHeavy: () => [{ prefix: ZG + 'doors/heavy/slide/open/', gain: 1 }],
  doorFence: () => [{ prefix: ZG + 'doors/fence/', gain: 1 }],
  power: () => [
    { prefix: ZG + 'switch/power/flux/flux_l', gain: .7 }, { prefix: ZG + 'switch/power/flux/flux_r', gain: .7 },
    { prefix: ZG + 'switch/surge/', gain: .8 }, { prefix: ZG + 'power_on/surge/', gain: .6, delay: 250 },
    { prefix: ZG + 'switch/turn_on/', gain: .6 },
  ],
  trap: () => [{ prefix: ZG + 'traps/elec/start/', gain: 1 }],
  papReady: () => [{ prefix: ZG + 'pap/ready', gain: 1 }],
  papDeny: () => [{ prefix: ZG + 'pap/deny', gain: 1 }],
  weaponPickup: () => [{ prefix: 'ref/fly/pickups/weapon/', gain: .8 }],
  ammoPickup: () => [{ prefix: 'ref/fly/pickups/ammo/', gain: .8 }],
  grenadePickup: () => [{ prefix: 'ref/fly/pickups/grenade/', gain: .8 }],
  weaponWall: () => [{ prefix: ZG + 'weap_wall/buy/', gain: .9 }],
  zombieFall: () => [{ prefix: 'ref/fly/bodyfall/zmb/', gain: .9 }],
  headGib: () => [{ prefix: 'ref/fly/gibs/zombie/head/', gain: .8 }],
  window: () => [{ prefix: ZG + 'windows/', gain: .8 }],
  land: () => [{ prefix: 'ref/chr/dive_to_prone/land/concrete/', gain: .6 }],
};

const prefixCache = new WeakMap();
function keysFor(manifest, prefix) {
  let map = prefixCache.get(manifest);
  if (!map) prefixCache.set(manifest, map = new Map());
  if (!map.has(prefix)) map.set(prefix, Object.keys(manifest).filter(key => key.startsWith(prefix)));
  return map.get(prefix);
}

// Resolve a generic event into concrete manifest keys (empty when nothing exists).
export function resolveEvent(name, manifest, position = null, pick = list => list[Math.floor(Math.random() * list.length)]) {
  const build = EVENT_LAYERS[name];
  if (!build) return [];
  const out = [];
  for (const layer of build(position)) {
    const keys = keysFor(manifest, layer.prefix);
    const key = keys.length ? pick(keys) : null;
    if (key) out.push({ key, gain: layer.gain, delay: layer.delay ?? 0 });
  }
  return out;
}
