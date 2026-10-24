// Perk machine light tuning (pure, no three.js). The reference effects are fx_zombie_cola_jugg_on,
// _dtap_on, _revive_on, _arsenal_on (Pack-a-Punch), _cola_on (generic) and fx_zmb_cola_revive_flicker.
// Their FxEffectDef records only carry names, so the colours below are the machines' signature
// colours rather than values read from the reference.
export const PERK_LIGHT_COLORS = Object.freeze({
  specialty_armorvest: 0xff2a1a,
  specialty_rof: 0xffa11a,
  specialty_quickrevive: 0x3aa0ff,
  specialty_fastreload: 0x35ff58,
  specialty_additionalprimaryweapon: 0x62d12e,
  specialty_longersprint: 0xffc233,
  specialty_flakjacket: 0xff7a2a,
  specialty_deadshot: 0xff4a8a,
  zombie_vending_upgrade: 0x58b8ff,
});
export const DEFAULT_PERK_LIGHT = 0xfff1c2;

export function perkLightColor(perk) {
  return PERK_LIGHT_COLORS[perk] ?? DEFAULT_PERK_LIGHT;
}

/** Quick Revive is lit before the power is on (it works without power); other maps without a power flag are always lit. */
export function isPerkLit(perk, power) {
  if (perk === 'specialty_quickrevive') return true;
  return power === undefined ? true : !!power;
}

/** 0..1 brightness at `time`; Quick Revive flickers with sharp dips, the rest breathe gently. */
export function lightLevel(time, perk, seed = 0) {
  if (perk === 'specialty_quickrevive') {
    const dip = Math.sin(time * 37 + seed * 11) > 0.96 ? 0.25 : 1;
    return dip * (0.9 + 0.1 * Math.sin(time * 5 + seed));
  }
  return 0.9 + 0.1 * Math.sin(time * 3 + seed);
}

/** Machines (perk id, trigger id, model id, fallback position) found in a map's entity list. */
export function machineTargets(entities = []) {
  const models = new Map();
  for (const e of entities) if (e.classname === 'script_model' && e.targetname) models.set(e.targetname, e);
  const out = [];
  for (const e of entities) {
    if (e.classname !== 'trigger_use') continue;
    const upgrade = e.targetname === 'zombie_vending_upgrade';
    if (e.targetname !== 'zombie_vending' && !upgrade) continue;
    const model = models.get(e.target);
    out.push({ perk: upgrade ? 'zombie_vending_upgrade' : e.script_noteworthy, id: e.id, modelId: model?.id ?? null, position: model?.position ?? e.position });
  }
  return out;
}
