// Character voice lines from the reference theater set:
// ref/english/vox/scripted/zombie_theater/plr<N>/vox_plr_<N>_<category>_<NN>.
const ROOT = 'ref/english/vox/scripted/zombie_theater/';

// chance: odds a trigger speaks; wait: seconds before the same category may speak again.
export const CATEGORIES = {
  kill_headshot: { chance: .1, wait: 20 }, kill_explo: { chance: .4, wait: 12 }, kill_hellhound: { chance: .35, wait: 10 },
  kill_flame: { chance: .4, wait: 12 }, kill_insta: { chance: .35, wait: 14 }, kill_close: { chance: .12, wait: 20 },
  kill_quad: { chance: .35, wait: 10 }, kill_tesla: { chance: .4, wait: 12 }, kill_ray: { chance: .3, wait: 14 },
  kill_thunder: { chance: .4, wait: 12 }, kill_damaged: { chance: .08, wait: 25 }, kill_streak: { chance: 1, wait: 30 },
  spawn_dog: { chance: 1, wait: 20 }, spawn_quad: { chance: .5, wait: 30 }, spawn_crawl: { chance: .4, wait: 30 },
  powerup_nuke: { chance: 1, wait: 4 }, powerup_insta: { chance: 1, wait: 4 }, powerup_double: { chance: 1, wait: 4 },
  powerup_ammo: { chance: 1, wait: 4 }, powerup_carp: { chance: 1, wait: 4 }, powerup_firesale: { chance: 1, wait: 4 },
  perk_jugga: { chance: 1, wait: 4 }, perk_revive: { chance: 1, wait: 4 }, perk_speed: { chance: 1, wait: 4 }, perk_doubletap: { chance: 1, wait: 4 },
  ammo_low: { chance: .6, wait: 40 }, ammo_out: { chance: .8, wait: 25 }, nomoney: { chance: .6, wait: 10 }, box_move: { chance: 1, wait: 6 },
  revive_down: { chance: 1, wait: 8 }, revive_up: { chance: 1, wait: 8 }, ohshit: { chance: .7, wait: 40 }, level_start: { chance: 1, wait: 60 },
  wpck_raygun: { chance: .8, wait: 8 }, wpck_shotgun: { chance: .5, wait: 8 }, wpck_sniper: { chance: .5, wait: 8 }, wpck_smg: { chance: .5, wait: 8 },
  wpck_mg: { chance: .5, wait: 8 }, wpck_launcher: { chance: .6, wait: 8 }, wpck_flame: { chance: .6, wait: 8 }, wpck_tesla: { chance: .6, wait: 8 },
  wpck_thunder: { chance: .8, wait: 8 }, wpck_crappy: { chance: .5, wait: 8 }, wpck_dual: { chance: .5, wait: 8 }, wpck_upgrade: { chance: 1, wait: 8 }, wpck_bowie: { chance: 1, wait: 8 },
};

export const CHARACTERS = 4;

/** Numbered lines of one category for one character (a category's prefix never matches a longer category). */
export function voiceLines(keys, character, category) {
  const prefix = `${ROOT}plr${character}/vox_plr_${character}_${category}_`;
  return keys.filter(key => key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length)));
}

const WEAPON_PATTERNS = [
  ['wpck_raygun', /ray_?gun/], ['wpck_thunder', /thunder/], ['wpck_tesla', /tesla/], ['wpck_flame', /flame/], ['wpck_bowie', /bowie/],
  ['wpck_launcher', /china_?lake|rpg|m72|law|launcher|m202/], ['wpck_sniper', /l96|dragunov|psg1|wa2000|sniper/],
  ['wpck_shotgun', /rottweil|ithaca|spas|olympia|ks23|hs10|stakeout|shotgun/], ['wpck_mg', /rpk|hk21|m60|stoner|rpd|mg/],
  ['wpck_smg', /mp5|ak74u|mac11|pm63|skorpion|mpl|spectre|kiparis|uzi|smg/], ['wpck_crappy', /m1911|python|cz75|makarov|pistol/],
];

/** Pickup category for a weapon definition, or null when no line fits. */
export function weaponCategory(def) {
  if (!def) return null;
  if (def.upgraded) return 'wpck_upgrade';
  const id = String(def.id ?? '').toLowerCase();
  for (const [category, pattern] of WEAPON_PATTERNS) if (pattern.test(id)) return category;
  return def.dualWield ? 'wpck_dual' : null;
}

const POWERUPS = { nuke: 'powerup_nuke', insta_kill: 'powerup_insta', double_points: 'powerup_double', full_ammo: 'powerup_ammo', carpenter: 'powerup_carp', fire_sale: 'powerup_firesale' };
const PERKS = { specialty_armorvest: 'perk_jugga', specialty_quickrevive: 'perk_revive', specialty_fastreload: 'perk_speed', specialty_rof: 'perk_doubletap' };
const KILL_CAUSES = { explosion: 'kill_explo', grenade: 'kill_explo', melee: 'kill_close', flame: 'kill_flame', electric: 'kill_tesla', raygun: 'kill_ray', projectile: 'kill_ray', wave: 'kill_thunder' };

export class PlayerVox {
  constructor(audio, { character = 0, random = Math.random } = {}) {
    this.audio = audio; this.character = character; this.random = random;
    this.last = new Map(); this.busyUntil = 0; this.spoken = [];
    this.state = { weapons: null, ammoLow: false, ammoOut: false, ohshit: false, phase: null, round: 0, dogRound: -1 };
  }

  now() { return this.audio.ctx?.currentTime ?? 0; }

  /** Speak one line from the category if its odds, cooldown and the current speaker allow it. Returns the key. */
  say(category, { force = false } = {}) {
    const rule = CATEGORIES[category];
    if (!rule || !this.audio.enabled) return null;
    const now = this.now();
    if (!force && (now < this.busyUntil || now - (this.last.get(category) ?? -Infinity) < rule.wait || this.random() >= rule.chance)) return null;
    const lines = voiceLines(Object.keys(this.audio.manifest), this.character, category);
    if (!lines.length) return null;
    const key = lines[Math.floor(this.random() * lines.length)];
    this.last.set(category, now);
    this.busyUntil = now + (this.audio.manifest[key]?.duration ?? 2) + .4;
    this.spoken.push(category);
    // Voice lines follow the player, so they are not positional.
    this.audio.play(key, .9);
    return key;
  }

  powerup(type) { const category = POWERUPS[type]; if (category) this.audio.later?.(2600, () => this.say(category, { force: true })); }
  perk(id) { const category = PERKS[id]; if (category) this.audio.later?.(1800, () => this.say(category, { force: true })); }

  /** Enemy events from Enemies.onEvent: spawns and deaths. */
  enemyEvent(type, z, cause, session) {
    if (type === 'spawn') {
      if (z.kind === 'dog' && session?.round !== this.state.dogRound) { this.state.dogRound = session?.round; this.audio.later?.(3500, () => this.say('spawn_dog', { force: true })); }
      else if (z.kind === 'nova') this.say('spawn_quad');
      return;
    }
    if (type !== 'death') return;
    if (z.kind === 'dog') this.say('kill_hellhound');
    else if (z.kind === 'nova') this.say('kill_quad');
    else if (session && session.effects?.insta_kill > session.time) this.say('kill_insta');
    else if (KILL_CAUSES[cause]) this.say(KILL_CAUSES[cause]);
    else if (z.killedByHead) this.say('kill_headshot');
  }

  /** Per-frame state watch: new weapons, ammo, danger, downs, revives and the first round. */
  update(session) {
    if (!session) return;
    const ids = new Set(session.inventory.map(w => w.id + (w.upgraded ? ':up' : '')));
    if (this.state.weapons) for (const w of session.inventory) {
      const id = w.id + (w.upgraded ? ':up' : '');
      if (!this.state.weapons.has(id)) this.say(weaponCategory({ ...(session.data?.weapons?.[w.id] ?? { id: w.id }), upgraded: w.upgraded }));
    }
    this.state.weapons = ids;
    const w = session.weapon, size = session.def?.clipSize ?? 0, total = w ? w.mag + w.reserve : 0, max = (session.def?.maxAmmo ?? 0) + size;
    const out = !!w && total === 0, low = !!w && !out && max > 0 && total <= max * .15;
    if (out && !this.state.ammoOut) this.say('ammo_out'); else if (low && !this.state.ammoLow) this.say('ammo_low');
    this.state.ammoOut = out; this.state.ammoLow = low;
    const danger = session.health > 0 && session.health / session.maxHealth < .4 && session.phase === 'fighting';
    if (danger && !this.state.ohshit) this.say('ohshit');
    this.state.ohshit = danger;
    // Five kills inside ten seconds is a streak.
    if (session.kills > (this.state.kills ?? session.kills)) {
      this.state.streak = [...(this.state.streak ?? []).filter(t => session.time - t < 10), ...Array(session.kills - this.state.kills).fill(session.time)];
      if (this.state.streak.length >= 5) { this.state.streak = []; this.say('kill_streak'); }
    }
    this.state.kills = session.kills;
    if (session.phase !== this.state.phase) {
      if (session.phase === 'reviving') this.say('revive_down', { force: true });
      else if (this.state.phase === 'reviving' && session.phase === 'fighting') this.say('revive_up', { force: true });
      this.state.phase = session.phase;
    }
    if (session.phase === 'fighting' && session.round !== this.state.round) {
      if (session.round === 1) this.say('level_start', { force: true });
      this.state.round = session.round;
    }
  }

  reset() { this.last.clear(); this.busyUntil = 0; this.spoken.length = 0; this.state = { weapons: null, ammoLow: false, ammoOut: false, ohshit: false, phase: null, round: 0, dogRound: -1 }; }
}
