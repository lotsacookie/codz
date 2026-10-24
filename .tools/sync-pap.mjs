// Makes Pack-a-Punch identical on every map: Kino's game-data.json holds the full T5 upgrade blocks
// (dual-wield M1911, models, animations, ammo), so each Combat map's data takes them wholesale.
// Fields only the other map's data has (e.g. attachment info) are kept.
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = 'export/web/assets/';
// Asset paths differ per map (moon/models/... vs models/...), so a map keeps the paths it already has and only
// receives the ones it lacks; every gameplay value (clip size, dual wield, damage, fire rate) comes from Kino.
export const ASSET_KEYS = ['model', 'worldModel', 'animations', 'leftModel', 'leftAnimations', 'projectileModel', 'notetrackSounds', 'sounds'];
export const TARGETS = ['moon/combat-data.json'];

export function syncPap(kinoWeapons, weapons) {
  const changed = [];
  for (const [id, source] of Object.entries(kinoWeapons)) {
    const target = weapons[id];
    if (!source.upgrade || !target) continue;
    const merged = { ...(target.upgrade ?? {}) };
    for (const [key, value] of Object.entries(source.upgrade)) if (!(ASSET_KEYS.includes(key) && key in merged)) merged[key] = value;
    if (JSON.stringify(merged) !== JSON.stringify(target.upgrade)) { target.upgrade = merged; changed.push(id); }
  }
  return changed;
}

if (process.argv[1]?.endsWith('sync-pap.mjs')) {
  const kino = JSON.parse(readFileSync(ROOT + 'game-data.json', 'utf8')).weapons;
  for (const file of TARGETS) {
    const data = JSON.parse(readFileSync(ROOT + file, 'utf8'));
    const changed = syncPap(kino, data.weapons);
    writeFileSync(ROOT + file, JSON.stringify(data));
    console.log(file, 'updated', changed.length, changed.join(','));
  }
}
