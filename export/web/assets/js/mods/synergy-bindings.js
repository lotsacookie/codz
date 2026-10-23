// What each Synergy command does in this browser game. The menu itself (names, order, descriptions, ranges)
// always comes from the parsed GSC; this only says how a command acts on a Session. A command with no entry
// here is shown greyed out as unavailable rather than faked.
const need = (session, id) => session.data.weapons[id];

export const synergyBindings = {
  id: 'synergy',
  toggles: {
    god_mode: { tick: s => { s.effects.invulnerable = s.time + 1; } },
    infinite_ammo: { tick: s => s.mods.add('infinite_ammo'), off: s => s.mods.delete('infinite_ammo') },
    one_shot_zombies: { tick: s => { s.effects.insta_kill = s.time + 1; } },
  },
  actions: {
    add_points: (s, _p, v) => s.addPoints(Number(v) || 0),
    take_points: (s, _p, v) => { s.points = Math.max(0, s.points - (Number(v) || 0)); },
    set_points: (s, _p, v) => { s.points = Math.max(0, Number(v) || 0); },
    set_round: (s, _p, v) => {
      s.round = Math.max(1, Math.floor(Number(v) || 1));
      s.total = s.quota; s.spawned = 0; s.killed = 0; s.phase = 'preparing'; s.countdown = 3;
    },
    set_perk_limit: (s, _p, v) => { if (Number(v) > 4) s.mods.add('no_perk_limit'); else s.mods.delete('no_perk_limit'); },
    give_perk: (s, [perk]) => { if (!s.data.perkDrinks?.[perk]) return false; s.perks.add(perk); s.health = s.maxHealth; },
    take_perk: (s, [perk]) => { s.perks.delete(perk); s.health = Math.min(s.health, s.maxHealth); },
    give_perkaholic: s => { for (const perk of Object.keys(s.data.perkDrinks ?? {})) s.perks.add(perk); s.health = s.maxHealth; },
    take_perkaholic: s => { s.perks.clear(); s.health = Math.min(s.health, s.maxHealth); },
    give_weapon: (s, [id]) => { if (!need(s, id)) return false; s.giveWeapon(id); },
    pack_weapon: s => { s.weapon.upgraded = true; s.weapon.mag = s.def.clipSize; s.weapon.reserve = s.def.maxAmmo; },
    unpack_weapon: s => { s.weapon.upgraded = false; s.weapon.mag = Math.min(s.weapon.mag, s.def.clipSize); },
    refill_ammo: s => { for (const w of s.inventory) { const d = s.data.weapons[w.id]; w.mag = d.clipSize; w.reserve = w.upgraded ? d.upgrade?.maxAmmo ?? d.maxAmmo : d.maxAmmo; } s.grenades = 4; },
    take_weapon: s => { if (s.inventory.length < 2) return false; s.inventory.splice(s.slot, 1); s.slot = 0; },
    spawn_powerup: (s, [type]) => { if (!s.data.powerups?.[type]) return false; s.powerup(type); },
    power_on: s => { s.power = true; },
  },
  // Commands whose increment step is another increment option's current value.
  stepFrom: { set_points: 'set_points_increment', add_points: 'set_points_increment', take_points: 'set_points_increment', set_round: 'set_round_increment' },
  // Increments that only store a value for another command.
  stores: new Set(['set_points_increment', 'set_round_increment']),
  // Menus whose repo items are generated at runtime from tables inside the GSC: filled from this game's own data.
  expand: {
    give_perk: s => Object.keys(s.data.perkDrinks ?? {}).map(id => ({ text: id.replace(/^specialty_/, '').replace(/_/g, ' '), params: [id] })),
    take_perk: s => Object.keys(s.data.perkDrinks ?? {}).map(id => ({ text: id.replace(/^specialty_/, '').replace(/_/g, ' '), params: [id] })),
    spawn_powerup: s => Object.keys(s.data.powerups ?? {}).map(id => ({ text: `Spawn ${id.replace(/_/g, ' ')}`, params: [id] })),
    give_weapon: s => Object.entries(s.data.weapons).map(([id, d]) => ({ text: d.name ?? id, params: [id] })),
  },
  // 'Give Weapons' only lists dynamic categories of BO3 guns in the repo; here it lists this game's weapons.
  menuCommand: { 'Give Weapons': 'give_weapon' },
};
