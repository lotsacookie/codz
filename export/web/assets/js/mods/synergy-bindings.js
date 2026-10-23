// What each Synergy command does in this browser game. The menu itself (names, order, descriptions, ranges)
// always comes from the parsed GSC; this only says how a command acts on a Session. A command with no entry
// here is shown greyed out as unavailable rather than faked.
const need = (session, id) => session.data.weapons[id];
const redraw = rt => { try { rt.reequip?.(); } catch {} };
let counter = null;

export const synergyBindings = {
  id: 'synergy',
  toggles: {
    god_mode: { tick: s => { s.effects.invulnerable = s.time + 1; } },
    infinite_ammo: { tick: s => s.mods.add('infinite_ammo'), off: s => s.mods.delete('infinite_ammo') },
    one_shot_zombies: { tick: s => { s.effects.insta_kill = s.time + 1; } },
    freeze_zombies: { tick: () => {} },
    slow_zombies: { tick: () => {} },
    disable_spawns: { tick: s => { s.spawned = Math.max(s.spawned, s.total); } },
    zombie_counter: {
      tick: s => {
        if (typeof document === 'undefined') return;
        if (!counter) { counter = document.createElement('div'); counter.style.cssText = 'position:fixed;left:12px;top:12px;z-index:55;color:#fff;font:700 16px system-ui;text-shadow:0 0 4px #000;pointer-events:none'; document.body.append(counter); }
        counter.hidden = false;
        counter.textContent = `Zombies left: ${Math.max(0, s.total - s.killed)}`;
      },
      off: () => { if (counter) counter.hidden = true; },
    },
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
    give_weapon: (s, [id], _v, rt) => { if (!need(s, id) || s.giveWeapon(id) === false) return false; redraw(rt); },
    pack_weapon: (s, _p, _v, rt) => { s.weapon.upgraded = true; s.weapon.mag = s.def.clipSize; s.weapon.reserve = s.def.maxAmmo; redraw(rt); },
    unpack_weapon: (s, _p, _v, rt) => { s.weapon.upgraded = false; s.weapon.mag = Math.min(s.weapon.mag, s.def.clipSize); redraw(rt); },
    refill_ammo: s => { for (const w of s.inventory) { const d = s.data.weapons[w.id]; w.mag = d.clipSize; w.reserve = w.upgraded ? d.upgrade?.maxAmmo ?? d.maxAmmo : d.maxAmmo; } s.grenades = 4; },
    take_weapon: (s, _p, _v, rt) => { if (s.inventory.length < 2) return false; s.inventory.splice(s.slot, 1); s.slot = 0; s.cancelReload(); redraw(rt); },
    kill_all_zombies: (_s, _p, _v, rt) => { const e = rt.enemies; if (!e) return false; for (const z of [...e.list]) e.hurt(z, 1e9, false, false, 'mod', false); },
    spawn_normal_zombie: (_s, _p, _v, rt) => { if (!rt.enemies) return false; rt.enemies.spawn(); },
    open_doors: (s, _p, _v, rt) => { const doors = rt.enemies?.world?.doors; if (!doors) return false; for (const name of doors.keys()) s.openDoors.add(name); },
    set_speed: (_s, _p, v, rt) => {
      const p = rt.player; if (!p) return false;
      p.modBase ??= { move: p.moveSpeed, sprint: p.sprintSpeed, crouch: p.crouchSpeed };
      p.moveSpeed = p.modBase.move * v; p.sprintSpeed = p.modBase.sprint * v; p.crouchSpeed = p.modBase.crouch * v;
    },
    set_gravity: (_s, _p, v, rt) => { const p = rt.player; if (!p) return false; p.modGravity ??= p.gravity; p.gravity = p.modGravity * (v / 900); },
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
