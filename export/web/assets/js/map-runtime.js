import * as THREE from 'three';

// Pieces of map runtime that Moon and the survival maps each carried their own copy of.

// Soft collision against living zombies: returns a push-out {normal, depth} for the capsule, or null.
export function enemyCapsuleHit(combat, capsule) {
  if (!combat?.enabled) return null;
  for (const z of combat.enemies.list) {
    const p = z.root.position, feet = capsule.start.y - capsule.radius, top = capsule.end.y + capsule.radius;
    if (feet > p.y + 65 || top < p.y + 4) continue;
    const normal = new THREE.Vector3(capsule.start.x - p.x, 0, capsule.start.z - p.z), distance = normal.length(), depth = capsule.radius + 15 - distance;
    if (depth > 0) return { normal: distance > .001 ? normal.divideScalar(distance) : new THREE.Vector3(1, 0, 0), depth };
  }
  return null;
}

// Logs each distinct runtime fault once, records it for the debug hooks and shows a short notice.
export function createFaultReporter({ label, errors, notify }) {
  const faults = new Map();
  return function reportFault(error) {
    const key = String(error?.message ?? error), n = (faults.get(key) ?? 0) + 1;
    faults.set(key, n);
    if (n === 1) {
      console.error(typeof label === 'function' ? label() : label, error);
      errors.push(key);
      notify('Game error: ' + key.slice(0, 80), 6);
    }
  };
}
