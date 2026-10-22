const STORAGE_KEY = 'codz.hands';
const VARIANTS = [
  { id: 'arms', label: 'ARMS', character: 'viewmodel_usa_pow_arms' },
  { id: 'gloves', label: 'GLOVES', character: 'viewhands_usmc' },
];

const valid = value => VARIANTS.some(v => v.id === value);

function initial() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (valid(stored)) return stored;
  } catch {}
  try {
    const queried = new URLSearchParams(location.search).get('hands');
    if (valid(queried)) return queried;
  } catch {}
  return VARIANTS[0].id;
}

let current = initial();

export function getHands() {
  return current;
}

export function setHands(id) {
  if (!valid(id)) return current;
  current = id;
  try { localStorage.setItem(STORAGE_KEY, id); } catch {}
  return current;
}

export function cycleHands() {
  const index = VARIANTS.findIndex(v => v.id === current);
  return setHands(VARIANTS[(index + 1) % VARIANTS.length].id);
}

export function handsLabel() {
  return VARIANTS.find(v => v.id === current)?.label ?? VARIANTS[0].label;
}

export function handsModelFor(characters) {
  const variant = VARIANTS.find(v => v.id === current);
  if (!variant || variant.id === VARIANTS[0].id) return undefined;
  return characters?.[variant.character] ?? undefined;
}
