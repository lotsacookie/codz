// Head explosions: which guns are strong enough to blow a head apart, and the head removal itself.

// Per-shot head damage needed to pop a head. Rifles like the Galil, FAL, AUG and the sniper
// rifles and revolver pass it; SMGs and pistols leave the head on.
export const HEAD_POP_DAMAGE = 500;
// Shotguns fire many weak pellets, so they pop heads from their combined damage, up close only.
export const SHOTGUN_POP_DAMAGE = 1000;
export const SHOTGUN_POP_RANGE = 300;

// 0 when the weapon leaves the head intact, otherwise 1..3 for how violent the burst is.
export function headBurstPower(def, distance = 0) {
  if (!def || def.projectileSpeed > 0 || def.explosionRadius > 0) return 0;
  const damage = def.damage ?? 0;
  if (def.pellets > 1) {
    if (distance > SHOTGUN_POP_RANGE || damage * def.pellets < SHOTGUN_POP_DAMAGE) return 0;
    return Math.min(3, 1 + (damage * def.pellets - SHOTGUN_POP_DAMAGE) / 1500);
  }
  const perShot = damage * Math.max(1, def.headMultiplier ?? 1);
  if (perShot < HEAD_POP_DAMAGE) return 0;
  return Math.min(3, perShot / HEAD_POP_DAMAGE);
}

// Shrinks the head bone out of sight. Animation clips only drive position/rotation, so it stays gone.
export function decapitate(zombie) {
  if (!zombie?.root || zombie.headless) return false;
  const bone = zombie.root.getObjectByName?.('j_head');
  if (!bone) return false;
  bone.scale.setScalar(0.001);
  zombie.headless = true;
  return true;
}

// Called after a shot killed a zombie with a headshot. Returns true when the head burst.
export function popHead({ blood, enemies, zombie, def, distance = 0 }) {
  const power = headBurstPower(def, distance);
  if (power <= 0 || !decapitate(zombie)) return false;
  blood?.headBurst(() => enemies.headPosition(zombie), { power });
  return true;
}
