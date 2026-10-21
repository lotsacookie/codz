// Weapon sound resolution. Every cue under (resident|ref)/wpn/ is sorted into a role
// (shot, lfe, sweet, ring, flux, shell, dry, npc, dist, foley, ...) so firing can layer
// them the way the T5 sound aliases do instead of playing one shot cue.
export const WEAPON_FOLDERS = {
  m1911: 'pistol/m1911', m14: 'assault/m14', rottweil72: 'shotgun/rottweil72', ithaca: 'shotgun/ithaca',
  mp40: 'smg/mp40', mp5k: 'smg/mp5', mpl: 'smg/mpl', pm63: 'smg/pm63', ak74u: 'smg/ak74', m16: 'assault/m16',
  galil: 'assault/galil', commando: 'assault/commando', hk21: 'lmg/hk21', rpk: 'lmg/rpk', python: 'pistol/357', spas: 'shotgun/spas',
  cz75: 'pistol/cz75', cz75dw: 'pistol/cz75', g11_lps: 'smg/g11', famas: 'assault/famas', spectre: 'smg/spectre', hs10: 'shotgun/hs10',
  aug_acog: 'assault/aug', fnfal: 'assault/fnfal', dragunov: 'sniper/dragunov', l96a1: 'sniper/l96a1', china_lake: 'gren_launcher/china_lake',
  crossbow_explosive: 'crossbow', knife_ballistic: 'melee/ballistic_knife',
  ray_gun: 'energy/raygun', thundergun: 'energy/thundergun', freezegun: 'energy/freezegun', m72_law: 'rocket/rpg', m202: 'rocket/m202',
  ak47: 'assault/ak47', enfield: 'assault/enfield', mac11: 'smg/mac11', kiparis: 'smg/kiparis', skorpion: 'smg/skorpion',
  wa2000: 'sniper/wa2000', makarov: 'pistol/makarov', m60: 'lmg/m60', minigun: 'lmg/minigun', remington870: 'shotgun/remington870',
};
export const GRENADE_LAUNCHER_FOLDER = 'gren_launcher/attachment';
const WPN = /^(resident|ref)\/wpn\//;

export function weaponFolder(id, keys = []) {
  const base = String(id ?? '').replace(/_zm$/, '').replace(/_upgraded$/, '');
  if (WEAPON_FOLDERS[base]) return WEAPON_FOLDERS[base];
  for (const key of keys) {
    const parts = key.split('/');
    if (WPN.test(key) && parts[3] === base) return parts[2] + '/' + parts[3];
  }
  return null;
}

// Role of a cue from its path below the weapon folder.
export function cueRole(rel) {
  const parts = rel.split('/'), last = parts[parts.length - 1];
  const has = word => parts.includes(word);
  if (has('npc')) {
    if (has('dist')) return 'dist';
    if (has('act') || /dry/.test(last)) return 'npcDry';
    return /shot|fire/.test(rel) ? 'npcShot' : 'other';
  }
  if (has('reload') || has('foley')) return 'foley';
  if (has('projectile') || has('effects') || has('zombie') || has('explode') || has('impact')) return 'impact';
  if (has('flame')) return 'flame';
  if (has('silenced')) return 'silenced';
  if (has('lfe') || /lfe/.test(last)) return 'lfe';
  if (has('sweet')) return 'sweet';
  if (has('ringoff') || has('ring') || /ring/.test(last)) return 'ring';
  if (has('flux')) return 'flux';
  if (has('dist')) return 'dist';
  if (has('act') || /dry/.test(last)) return 'dry';
  if (has('loop') || has('dmachine') || /^wpn_minigun/.test(last)) return 'loop';
  if (has('shot') || /(shot|fire)/.test(last)) return 'shot';
  return 'other';
}

const ROLES = ['shot', 'npcShot', 'lfe', 'sweet', 'ring', 'flux', 'dry', 'npcDry', 'dist', 'foley', 'impact', 'silenced', 'flame', 'loop', 'other'];

function poolFor(keys, folder) {
  const found = new Map();
  const pools = Object.fromEntries(ROLES.map(role => [role, []]));
  const marker = '/wpn/' + folder + '/';
  for (const key of keys) {
    const at = key.indexOf(marker);
    if (at < 0 || !WPN.test(key) || key.slice(0, at) !== key.split('/')[0]) continue;
    const rel = key.slice(at + marker.length);
    // The same clip can exist under resident/ and ref/; keep the resident one.
    if (found.has(rel) && key.startsWith('ref/')) continue;
    found.set(rel, key);
  }
  for (const [rel, key] of found) pools[cueRole(rel)].push(key);
  return pools;
}

function classPool(keys, cls, sub) {
  const prefix = '/wpn/' + cls + '/' + sub + '/';
  const seen = new Map();
  for (const key of keys) {
    const at = key.indexOf(prefix);
    if (at < 0 || !WPN.test(key)) continue;
    const rel = key.slice(at);
    if (seen.has(rel) && key.startsWith('ref/')) continue;
    seen.set(rel, key);
  }
  return [...seen.values()];
}

export function hasScope(def) {
  const folder = weaponFolder(def?.id);
  return folder?.startsWith('sniper/') || /acog|scope/.test(def?.id ?? '');
}

// Layered sound profile of one weapon: arrays of manifest keys by role.
export function weaponProfile(def, keys, folderOverride = null) {
  const folder = folderOverride ?? weaponFolder(def?.id, keys);
  const empty = Object.fromEntries(ROLES.map(role => [role, []]));
  if (!folder) return { folder: null, ...empty, shell: [], classLfe: [], classFlux: [], classRing: [], classDry: [], classDist: [], pap: [] };
  const cls = folder.split('/')[0];
  const own = poolFor(keys, folder);
  const profile = { folder, ...own };
  profile.shell = classPool(keys, cls, 'shell');
  profile.classLfe = classPool(keys, cls, 'lfe');
  profile.classFlux = classPool(keys, cls, 'flux');
  profile.classRing = classPool(keys, cls, 'ringoff');
  profile.classDry = classPool(keys, cls, 'dry_fire').filter(key => /\/plr\//.test(key));
  profile.classDist = classPool(keys, cls, 'dist');
  if (!profile.shot.length && !profile.npcShot.length) {
    // The dump has no standard shot alias for this weapon: use its silenced shot, else the best-covered weapon of the same class.
    profile.shot = profile.silenced.filter(key => !/(lfe|sweet)/.test(key));
    if (!profile.shot.length) profile.shot = classFallback(keys, cls, folder);
  }
  profile.pap = keys.filter(key => /^(resident|ref)\/wpn\/pap\/pap_shot_m$/.test(key));
  return profile;
}

function classFallback(keys, cls, skip) {
  const counts = new Map();
  for (const key of keys) {
    const parts = key.split('/');
    if (parts[2] !== cls || parts[2] + '/' + parts[3] === skip || !/\/plr\/shot\/shot_\d+$/.test(key)) continue;
    const folder = parts[2] + '/' + parts[3];
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  return best ? keys.filter(key => key.startsWith('resident/wpn/' + best + '/plr/shot/shot_')) : [];
}

// Match a notetrack sound name against the weapon's own reload/foley cues first.
export function foleyKey(profile, name) {
  const base = name.replace(/_plr$/, '');
  const names = new Set();
  for (const n of [name, base]) for (const prefix of ['', 'wpn_', 'fly_']) { names.add((prefix + n).toLowerCase()); names.add((prefix + n + '_00').toLowerCase()); }
  return profile.foley.find(key => names.has(key.split('/').pop().toLowerCase()));
}

// Explosion cue layers by projectile kind.
export function blastCues(kind, keys) {
  const starts = prefix => keys.filter(key => key.startsWith(prefix));
  const layers = [];
  if (kind === 'rocket') layers.push(starts('ref/wpn/rocket/exp_rocket/exp/'), starts('ref/wpn/rocket/exp_rocket/lfe/'));
  else if (kind === 'raygun') layers.push(starts('ref/wpn/energy/raygun/projectile/impact/'));
  else layers.push(starts('ref/wpn/grenade/explosion/explode/'));
  if (kind !== 'raygun') layers.push(starts('ref/wpn/grenade/explosion/debris/dirt/'));
  return layers.filter(layer => layer.length);
}
