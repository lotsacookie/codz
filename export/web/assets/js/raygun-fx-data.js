// Ray gun effect tuning (pure data + math, no three.js). The reference fx names this covers are
// fx_raygun_view/world (muzzle), fx_trail_raygun_ring_emit (projectile rings) and
// fx_exp_raygun_impact; the reference FxEffectDef records only carry names, so timings are tuned
// against the reference ring/glow textures instead of copied emitter values.
export const RAYGUN_FX = Object.freeze({
  ringUrl: 'textures/fxt_fx_raygun_ring.png',
  glowUrl: 'textures/fxt_exp_glow.png',
  upgradedTint: 0xff9ad8,
  trail: Object.freeze({ rate: 36, life: 0.32, size: 14, grow: 2.2 }),
  impact: Object.freeze({ rings: 2, ringLife: 0.45, ringSize: 60, ringGrow: 3.5, glowLife: 0.3, glowSize: 110 }),
  muzzle: Object.freeze({ life: 0.08, size: 22, grow: 0.6 }),
});

/** How many ring emits are due after dt seconds at `rate` per second; carry keeps the remainder. */
export function ringsDue(carry, dt, rate) {
  const total = carry + dt * rate;
  const count = Math.floor(total);
  return { count, carry: total - count };
}

/** Scale multiplier and opacity of a ring/glow sprite at `age` seconds. */
export function ringState(age, life, grow) {
  const t = Math.min(1, Math.max(0, age / life));
  return { scale: 1 + grow * t, opacity: (1 - t) ** 1.5, done: age >= life };
}
