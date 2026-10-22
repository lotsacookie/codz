// Source rules: zombie_moon_gravity.gsc and zombie_moon_teleporter.gsc.
export function contains(bounds, position) {
  return !!bounds && position.every((v, i) => v >= bounds[0][i] && v <= bounds[1][i]);
}

export function environmentAt(data, position, power, onMoon) {
  const zones = data.entities.filter(e => e.script_noteworthy === 'player_volume' && contains(e.bounds, position));
  // Small airlock/room volumes take priority over larger overlapping regions.
  const volume = e => e.bounds[0].reduce((n, v, i) => n * (e.bounds[1][i] - v), 1);
  const zone = zones.sort((a, b) => volume(a) - volume(b))[0];
  const lunar = zone?.targetname === 'nml_zone' ? false : onMoon;
  const lowGravity = lunar && (!power || !zone || zone.script_string === 'lowgravity');
  return {zone: zone?.targetname, lunar, lowGravity, breathable: !lowGravity, gravity: lowGravity ? data.rules.lowGravity : data.rules.normalGravity};
}

export class MoonState {
  constructor(rules) { this.rules = rules; this.power = false; this.hasSuit = false; this.suit = false; this.exposure = 0; this.teleport = null; this.cooldown = 0; }
  equipSuit() { this.hasSuit = true; this.suit = true; this.exposure = 0; }
  toggleSuit() { if (this.hasSuit) this.suit = !this.suit; }
  update(dt, environment, pad) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.exposure = environment.breathable || this.suit ? 0 : this.exposure + dt;
    if (this.exposure >= this.rules.suffocationSeconds) { this.teleport = null; return {suffocated: true}; }
    if (!pad || this.cooldown > 0) this.teleport = null;
    else if (this.teleport?.pad !== pad) this.teleport = {pad, elapsed: 0};
    else this.teleport.elapsed += dt;
    if (this.teleport?.elapsed >= this.rules.teleportSeconds) {
      const destination = this.teleport.pad;
      this.teleport = null; this.cooldown = 4; this.exposure = 0;
      return {teleport: destination};
    }
    return {};
  }
}
