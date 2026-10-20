// Gore: which guns are strong enough to blow a head or an arm off, the limb removal itself, and the
// arm hit detection. Bones are looked up once per zombie and cached.
import * as THREE from 'three';

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
  const bone = boneOf(zombie, 'j_head');
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

// ---- bones -----------------------------------------------------------------------------------

// Cached bone lookup (a name search walks the whole skeleton, so do it once per zombie).
export function boneOf(zombie, name) {
  const cache = (zombie.bones ??= {});
  if (name in cache) return cache[name] || null;
  const bone = zombie.root?.getObjectByName?.(name) ?? null;
  cache[name] = bone || false;
  return bone;
}

// ---- arms ------------------------------------------------------------------------------------

export const ARMS = {
  arm_le: { shoulder: 'j_shoulder_le', elbow: 'j_elbow_le', wrist: 'j_wrist_le' },
  arm_ri: { shoulder: 'j_shoulder_ri', elbow: 'j_elbow_ri', wrist: 'j_wrist_ri' }
};

// Per-shot body damage needed to take an arm off. Rifles from the Galil/FAL upward, the sniper
// rifles and the revolver pass it; SMGs, pistols and the M14 do not.
export const ARM_POP_DAMAGE = 150;

// 0 when the weapon cannot take an arm off, otherwise 1..3 for how violent the burst is.
export function limbBurstPower(def, distance = 0) {
  if (!def || def.projectileSpeed > 0 || def.explosionRadius > 0) return 0;
  const damage = def.damage ?? 0;
  if (def.pellets > 1) {
    if (distance > SHOTGUN_POP_RANGE || damage * def.pellets < SHOTGUN_POP_DAMAGE) return 0;
    return Math.min(3, 1 + (damage * def.pellets - SHOTGUN_POP_DAMAGE) / 1500);
  }
  if (damage < ARM_POP_DAMAGE) return 0;
  return Math.min(3, damage / ARM_POP_DAMAGE);
}

const armZone = new THREE.Box3();
const armSphere = new THREE.Sphere(new THREE.Vector3(), 4.6);
const hitPoint = new THREE.Vector3();
const S = new THREE.Vector3(), E = new THREE.Vector3(), W = new THREE.Vector3(), C = new THREE.Vector3();
const ARM_ZONE = 42;

// Nearest arm segment the ray passes through, or null. Cheap: one box test gates the sphere tests, and
// a removed arm (or forearm) is skipped. Needs the zombie's world matrices to be current.
export function findArmHit(ray, zombie, far = Infinity) {
  if (zombie.kind !== 'zombie' || !zombie.root || zombie.limbs?.arm_le === 'off' && zombie.limbs?.arm_ri === 'off') return null;
  const base = zombie.root.position;
  armZone.min.set(base.x - ARM_ZONE, base.y + 4, base.z - ARM_ZONE);
  armZone.max.set(base.x + ARM_ZONE, base.y + 68, base.z + ARM_ZONE);
  if (!ray.intersectsBox(armZone)) return null;
  let best = null;
  for (const [limb, names] of Object.entries(ARMS)) {
    const state = zombie.limbs?.[limb];
    if (state === 'off') continue;
    const shoulder = boneOf(zombie, names.shoulder), elbow = boneOf(zombie, names.elbow), wrist = boneOf(zombie, names.wrist);
    if (!shoulder || !elbow || !wrist) continue;
    shoulder.getWorldPosition(S);
    elbow.getWorldPosition(E);
    wrist.getWorldPosition(W);
    // Two spheres along the upper arm (cut at the shoulder) and, unless gone, two along the forearm (cut at the elbow).
    const spheres = state === 'forearm' ? 2 : 4;
    for (let i = 0; i < spheres; i++) {
      if (i < 2) C.lerpVectors(S, E, i === 0 ? 0.3 : 0.75);
      else C.lerpVectors(E, W, i === 2 ? 0.3 : 0.85);
      armSphere.center.copy(C);
      if (!ray.intersectSphere(armSphere, hitPoint)) continue;
      const distance = hitPoint.distanceTo(ray.origin);
      if (distance > far || best && best.distance <= distance) continue;
      best = { limb, cut: i < 2 ? 'shoulder' : 'elbow', point: hitPoint.clone(), distance };
    }
  }
  return best;
}

// Collapses the arm (from the shoulder) or forearm and hand (from the elbow) out of sight.
// Returns the severed part's geometry, or null if it was already gone.
export function amputate(zombie, limb, cut) {
  const names = ARMS[limb];
  if (!names || !zombie?.root) return null;
  const state = zombie.limbs?.[limb];
  if (state === 'off' || state === 'forearm' && cut === 'elbow') return null;
  const shoulder = boneOf(zombie, names.shoulder), elbow = boneOf(zombie, names.elbow), wrist = boneOf(zombie, names.wrist);
  const stumpBone = cut === 'shoulder' ? shoulder : elbow;
  if (!stumpBone || !elbow || !wrist) return null;
  zombie.root.updateMatrixWorld(true);
  const stump = stumpBone.getWorldPosition(new THREE.Vector3());
  const elbowAt = elbow.getWorldPosition(new THREE.Vector3());
  const wristAt = wrist.getWorldPosition(new THREE.Vector3());
  const length = cut === 'shoulder' && state !== 'forearm' ? stump.distanceTo(elbowAt) + elbowAt.distanceTo(wristAt) : elbowAt.distanceTo(wristAt);
  stumpBone.scale.setScalar(0.001);
  (zombie.limbs ??= {})[limb] = cut === 'shoulder' ? 'off' : 'forearm';
  return { stumpBone, stump, length: Math.min(40, Math.max(6, length)), limb, cut };
}

// Called after a shot hit a zombie's arm. Returns true when the arm came off.
export function popLimb({ blood, enemies, debris, zombie, limb, cut, def, distance = 0, awayFrom = null }) {
  const power = limbBurstPower(def, distance);
  if (power <= 0) return false;
  const part = amputate(zombie, limb, cut);
  if (!part) return false;
  const body = zombie.root.position;
  // Out from the body and a bit upward, for the stump spray and the flying arm.
  const out = new THREE.Vector3(part.stump.x - body.x, 0, part.stump.z - body.z);
  if (out.lengthSq() < 1e-3) out.set(1, 0, 0);
  out.normalize();
  const spray = out.clone().multiplyScalar(0.8).setY(0.9);
  blood?.burst(() => part.stumpBone.getWorldPosition(stumpAt), { power: Math.min(2.2, 0.8 + power * 0.5), direction: spray });
  if (debris) {
    const velocity = out.clone().multiplyScalar(70 + Math.random() * 60).setY(110 + Math.random() * 70);
    if (awayFrom) velocity.add(part.stump.clone().sub(awayFrom).setY(0).normalize().multiplyScalar(60));
    const floorY = body.y;
    const item = debris.spawn(part.stump, velocity, part.length, floorY);
    if (item) blood?.trail(() => item.mesh.position, { life: 0.55, rate: 45 });
  }
  return true;
}
const stumpAt = new THREE.Vector3();
