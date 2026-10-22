const MAX_POOL = 80;

const id = value => String(value ?? '').replace(/[^a-z0-9_.:-]/gi, '').slice(0, 48);
const weaponId = value => String(value ?? '').replace(/[^a-z0-9_]/gi, '').slice(0, 48);

export function packBoxStart({ box, roll, uses }) {
  return {
    a: 'start',
    b: box,
    w: roll.weapon,
    p: roll.pool,
    t: roll.teddy ? 1 : 0,
    s: roll.sale ? 1 : 0,
    d: roll.dest ?? null,
    u: uses,
  };
}

export function cleanBoxMessage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const box = id(raw.b);
  if (!box) return null;
  if (raw.a === 'take') return { type: 'take', box };
  if (raw.a !== 'start') return null;
  const weapon = weaponId(raw.w);
  const pool = Array.isArray(raw.p) ? raw.p.slice(0, MAX_POOL).map(weaponId).filter(Boolean) : [];
  if (!weapon || !pool.length) return null;
  const uses = Number(raw.u);
  return {
    type: 'start',
    box,
    weapon,
    pool,
    teddy: !!raw.t,
    sale: !!raw.s,
    dest: raw.d === null || raw.d === undefined ? undefined : id(raw.d),
    uses: Number.isFinite(uses) ? Math.max(0, Math.min(99, uses | 0)) : undefined,
  };
}
