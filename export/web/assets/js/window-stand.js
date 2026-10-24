import * as THREE from 'three';

// Where a zombie stands to tear down a window. The map's `exterior_goal` trigger sits 48 units from the window centre at
// whatever height the trigger was authored (not the floor), so zombies spawned or parked there hung in the air and stood
// too far back from the boards. The stand point is moved a little closer to the window and dropped onto the walkable floor.
export const WINDOW_CLOSER = 16;

export function windowStandPoint(outside, inside, closer = WINDOW_CLOSER) {
  const toward = new THREE.Vector3().subVectors(inside, outside).setY(0);
  if (toward.lengthSq() > 1e-6) toward.normalize();
  return outside.clone().addScaledVector(toward, closer);
}

// `ground` is the nearest walkable point to the stand point (from the navmesh). Returns true once the stand point is grounded.
export function groundStand(stand, ground, maxOffset = 60) {
  if (!ground || Math.hypot(ground.x - stand.x, ground.z - stand.z) > maxOffset) return false;
  stand.y = ground.y;
  return true;
}
