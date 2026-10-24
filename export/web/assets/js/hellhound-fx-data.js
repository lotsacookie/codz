// Hellhound effect tuning (pure). Covers the reference fx_zombie_dog_eyes, _fire_trail, _ash_trail
// and _explosion; the lightning spawn already lives in dog-spawn-fx.js. The reference records only
// hold names, so sizes and timings are tuned against the reference glow texture.
export const DOG_FX = Object.freeze({
  glowUrl: 'textures/fxt_light_glow.png',
  eye: Object.freeze({ size: 7, color: 0xff3010, spacing: 2.6 }),
  fire: Object.freeze({ rate: 26, life: 0.45, size: 30, color: 0xff7a1a, rise: 22 }),
  ash: Object.freeze({ rate: 14, life: 1.1, size: 36, color: 0x2b2622, rise: 14 }),
  explosion: Object.freeze({ puffs: 14, life: 0.7, size: 70, color: 0xff6a12, spread: 90 }),
  minSpeed: 25,
});

/** Emit count for `rate` per second with carry (same maths as the ray gun trail). */
export function emitDue(carry, dt, rate) {
  const total = carry + dt * rate;
  const count = Math.floor(total);
  return { count, carry: total - count };
}

/** Opacity/scale of a puff at age; fire flares then fades, ash fades slowly. */
export function puffState(age, life, additive) {
  const t = Math.min(1, Math.max(0, age / life));
  return { scale: 0.6 + t * (additive ? 0.9 : 1.6), opacity: additive ? (1 - t) ** 1.4 : 0.55 * (1 - t), done: age >= life };
}
