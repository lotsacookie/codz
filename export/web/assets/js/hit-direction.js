// Damage-direction arcs (hit_direction.png in the T5 HUD): one arc per recent attacker, placed
// around the screen centre at the bearing of the attack relative to where the player is looking.

export const HIT_LIFE = 2.2;
export const HIT_MERGE_DEGREES = 22;
export const HIT_MAX = 6;

// Degrees clockwise from straight ahead (0 = in front, 90 = right, 180 = behind), in [0, 360).
// `yaw` is the camera rotation.y (three.js: forward is -Z at yaw 0, turning left is positive).
export function hitBearing(player, yaw, source) {
  const dx = source.x - player.x;
  const dz = source.z - player.z;
  const forward = dx * -Math.sin(yaw) + dz * -Math.cos(yaw);
  const right = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
  const degrees = Math.atan2(right, forward) * 180 / Math.PI;
  return (degrees % 360 + 360) % 360;
}

export function nearestAttacker(player, enemies, range = 170) {
  let best = null;
  let bestDistance = range;
  for (const z of enemies ?? []) {
    const at = z?.root?.position;
    if (!at || z.state === 'dead') continue;
    const distance = Math.hypot(at.x - player.x, at.z - player.z);
    if (distance < bestDistance) { bestDistance = distance; best = at; }
  }
  return best;
}

function angleGap(a, b) {
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
}

export class HitDirections {
  constructor({ life = HIT_LIFE, merge = HIT_MERGE_DEGREES, max = HIT_MAX } = {}) {
    this.life = life;
    this.merge = merge;
    this.max = max;
    this.items = [];
  }

  // Bearing is stored in world space (heading), so the arc keeps pointing at the attacker while the
  // player turns. `heading` = bearing - yaw at the moment of the hit; screenAngle() adds the current yaw back.
  add(bearing, yawDegrees = 0) {
    const heading = ((bearing - yawDegrees) % 360 + 360) % 360;
    const near = this.items.find(item => angleGap(item.heading, heading) <= this.merge);
    if (near) {
      near.heading = heading;
      near.age = 0;
      return near;
    }
    if (this.items.length >= this.max) this.items.shift();
    const item = { heading, age: 0 };
    this.items.push(item);
    return item;
  }

  update(dt) {
    for (const item of this.items) item.age += dt;
    this.items = this.items.filter(item => item.age < this.life);
  }

  opacity(item) {
    const t = item.age / this.life;
    return Math.max(0, Math.min(1, t < 0.1 ? t / 0.1 : (1 - t) / 0.9)) * 0.9;
  }

  // On-screen rotation for an item given the camera yaw in degrees.
  screenAngle(item, yawDegrees) {
    return ((item.heading + yawDegrees) % 360 + 360) % 360;
  }

  clear() {
    this.items.length = 0;
  }
}
