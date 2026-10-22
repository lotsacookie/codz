import * as THREE from 'three';
import { MysteryBox } from './mystery-box.js';
import { boardLanded } from './board-chips.js';
import { MOON_PERKS } from './moon-session.js';
import { barrierGroups, boxLocations, powerSwitches } from './shangri-la-rules.js';

const V = a => new THREE.Vector3(...a);
const RANDOM_PERKS = ['specialty_armorvest', 'specialty_fastreload', 'specialty_rof', 'specialty_flakjacket', 'specialty_longersprint', 'specialty_deadshot'];
const BOX_EXCLUDED = new Set(['microwavegun_zm', 'knife_ballistic_zm']);

export class ShangriFeatures {
  constructor({ data, combat, scene, camera, objects, notice, raycast, doors, openDoor }) {
    Object.assign(this, { data, combat, scene, camera, objects, notice, raycast, doors, openDoor });
    this.s = combat.session;
    this.state = { suit: false };
    this.targets = [];
    this.sides = new Set();
    this.hack = null;
    this.byName = new Map(data.entities.filter(e => e.targetname).map(e => [e.targetname, e]));
    combat.features = this;
  }

  async load() {
    const d = this.data, cd = this.combat.data, locations = boxLocations(d.entities);
    const pool = cd.boxPool.filter(id => cd.weapons[id] && !BOX_EXCLUDED.has(id));
    const world = { entities: this.objects, boxLocations: locations, activeBox: null, fireSale: false, openBoxes: new Set() };
    world.activeBox = locations.find(e => e.script_noteworthy === 'blender_chest') ?? locations[0];
    world.updateBox = () => {
      for (const e of locations) {
        const visible = e.id === world.activeBox.id || world.fireSale || !!world.openBoxes?.has(e.id);
        for (const suffix of ['_box', '_lid']) {
          const object = this.objects.get(this.byName.get(e.script_noteworthy + suffix)?.id);
          if (object) object.visible = visible;
        }
      }
    };
    const weapons = Object.fromEntries(pool.map(id => [id, cd.weapons[id]]));
    this.box = new MysteryBox(this.scene, world, { ...cd, weapons, equipment: {}, boxPool: pool, entities: d.entities }, this.s, this.combat.audio, this.notice);
    this.box.onOffer = id => this.combat.prefetchWeapon(id);
    await this.box.load();
    this.combat.coop?.attachBox(this.box);
    world.updateBox();
    this.barriers = barrierGroups(d.entities).map(b => {
      const outside = V(b.outside), inside = V(b.inside);
      return { id: b.id, outside, inside, position: outside.clone().lerp(inside, .5), boards: b.boards, count: b.boards.length, repairTime: 0, reward: 0, rewardRound: 0 };
    });
    for (const b of this.barriers) this.targets.push({ kind: 'barrier', barrier: b, point: b.position });
    const perks = RANDOM_PERKS.filter(id => cd.perkDrinks[id]);
    const randoms = d.entities.filter(e => e.targetname === 'zombie_vending_random').sort((a, b) => a.id - b.id);
    randoms.forEach((e, i) => { if (perks[i]) this.targets.push({ kind: 'perk', e, perk: perks[i] }); });
    for (const e of d.entities.filter(e => e.targetname === 'zombie_vending' && e.script_noteworthy === 'specialty_quickrevive')) this.targets.push({ kind: 'perk', e, perk: e.script_noteworthy });
    for (const e of d.entities.filter(e => e.targetname === 'zombie_vending_perk' && MOON_PERKS[e.script_noteworthy] && cd.perkDrinks[e.script_noteworthy])) this.targets.push({ kind: 'perk', e, perk: e.script_noteworthy });
    for (const e of d.entities.filter(e => e.targetname === 'weapon_upgrade' && cd.weapons[e.zombie_weapon_upgrade])) this.targets.push({ kind: 'wall', e, weapon: cd.weapons[e.zombie_weapon_upgrade] });
    for (const e of locations) this.targets.push({ kind: 'box', e });
    for (const e of d.entities.filter(e => e.targetname === 'zombie_vending_upgrade')) this.targets.push({ kind: 'pack', e });
    for (const e of d.entities.filter(e => e.targetname === 'bowie_upgrade')) this.targets.push({ kind: 'bowie', e });
    for (const e of powerSwitches(d.entities)) this.targets.push({ kind: 'power', e, side: e.targetname });
    for (const group of this.doors) for (const id of group.triggers) this.targets.push({ kind: 'door', e: d.entities[id], group, range: 150 });
    this.setAllBoards();
  }

  setAllBoards() { for (const b of this.barriers) this.setBoards(b, b.boards.length); }

  // Boards fly off when a zombie tears one away and snap back in when they are rebuilt, like Kino's.
  setBoards(b, n, animate = false) {
    const before = b.count;
    b.count = Math.max(0, Math.min(b.boards.length, n));
    let changed = 0;
    b.boards.forEach((id, i) => {
      const o = this.objects.get(id);
      if (!o) return;
      const shown = i < b.count, was = i < before;
      if (animate && shown !== was) this.animateBoard(b, o, shown, changed++ * .07);
      else { this.cancelBoardFx(o); this.restoreBoard(o); o.visible = shown; }
    });
  }

  boardHome(o) { return o.userData.boardHome ??= { p: o.position.clone(), q: o.quaternion.clone() }; }
  restoreBoard(o) { const home = o.userData.boardHome; if (home) { o.position.copy(home.p); o.quaternion.copy(home.q); } }
  cancelBoardFx(o) { const i = this.boardFx?.findIndex(f => f.o === o) ?? -1; if (i >= 0) this.boardFx.splice(i, 1); }

  animateBoard(barrier, o, entering, delay = 0) {
    this.cancelBoardFx(o);
    this.restoreBoard(o);
    const home = this.boardHome(o);
    const out = barrier.outside.clone().sub(barrier.inside);
    out.y = 0;
    if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
    out.normalize();
    const side = new THREE.Vector3(-out.z, 0, out.x), sign = Math.random() < .5 ? -1 : 1;
    const offset = out.clone().multiplyScalar(entering ? 46 + Math.random() * 18 : 58 + Math.random() * 26).addScaledVector(side, sign * (8 + Math.random() * 16));
    offset.y = entering ? -16 - Math.random() * 10 : -8;
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - .5) * 1.1, (Math.random() - .5) * .7, (Math.random() - .5) * 1.6));
    (this.boardFx ??= []).push({ o, barrier, entering, t: -delay, dur: entering ? .34 : .42, home, offset, away: home.q.clone().multiply(tilt), started: false });
    if (entering) o.visible = false;
  }

  updateBoards(dt) {
    if (!this.boardFx?.length) return;
    for (const fx of [...this.boardFx]) {
      fx.t += dt;
      if (fx.t < 0) continue;
      const k = Math.min(1, fx.t / fx.dur), o = fx.o;
      if (!fx.started) { fx.started = true; o.visible = true; }
      if (fx.entering) {
        const c1 = 1.4, c3 = c1 + 1, e = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2), r = 1 - Math.pow(1 - k, 3);
        o.position.copy(fx.home.p).addScaledVector(fx.offset, 1 - e);
        o.quaternion.copy(fx.away).slerp(fx.home.q, r);
      } else {
        const e = k * k;
        o.position.copy(fx.home.p).addScaledVector(fx.offset, e);
        o.position.y -= 70 * k * k;
        o.quaternion.copy(fx.home.q).slerp(fx.away, Math.min(1, e * 1.4));
      }
      if (k >= 1) {
        this.boardFx.splice(this.boardFx.indexOf(fx), 1);
        this.restoreBoard(o);
        o.visible = fx.entering;
        if (fx.entering) boardLanded(o, fx.barrier, this.scene, this.combat.particles, this.camera, this.shakeState ??= {}, performance.now() / 1000, () => this.combat.view?.cameraFx?.build());
      }
    }
  }

  repairAll() { this.setAllBoards(); }

  get brokenWindows() { return this.barriers.filter(b => b.count < b.boards.length).length; }

  reset() {
    this.box.reset();
    this.box.world.activeBox = this.box.world.boxLocations.find(e => e.script_noteworthy === 'blender_chest') ?? this.box.world.boxLocations[0];
    this.box.world.updateBox();
    this.sides.clear();
    this.hack = null;
    for (const b of this.barriers) { b.reward = 0; b.rewardRound = 0; b.repairTime = 0; }
    this.setAllBoards();
  }

  shot() {}
  blast() {}
  equipment() {}
  onKill() {}

  describe(t) {
    const s = this.s;
    if (t.kind === 'perk') {
      const p = MOON_PERKS[t.perk];
      if (s.perks.has(t.perk)) return p.name + ' equipped';
      if (t.perk === 'specialty_quickrevive' && s.revives >= 3) return 'Quick Revive exhausted';
      if (!s.power && t.perk !== 'specialty_quickrevive') return p.name + ' · Requires power';
      return p.name + ' · ' + p.price + (s.perks.size >= s.perkLimit ? ' · Four-perk limit' : '');
    }
    if (t.kind === 'wall') {
      const owned = s.inventory.find(w => w.id === t.weapon.id);
      const ammo = t.weapon.ammoPrice ?? Math.ceil(t.weapon.price / 2);
      return t.weapon.name + (owned ? ' ammo · ' + (owned.upgraded ? 4500 : ammo) : ' · ' + t.weapon.price);
    }
    if (t.kind === 'box') {
      if (!this.box.available(t.e)) return '';
      const roll = this.box.at(t.e);
      return roll ? roll.ready && !roll.teddy ? this.box.takeLabel(roll, this.box.data.weapons[roll.weapon].name) : roll.teddy ? 'The box is moving…' : 'Mystery Box rolling…' : 'Mystery Box · ' + (s.effects.fire_sale > s.time ? 10 : 950);
    }
    if (t.kind === 'pack') {
      if (!s.power) return 'Pack-a-Punch · Requires power';
      return s.pack ? s.time >= s.pack.readyAt ? 'Retrieve ' + s.def.name + ' · Pack-a-Punch' : 'Upgrading weapon…' : s.weapon.upgraded ? 'Weapon already upgraded' : 'Pack-a-Punch · 5000';
    }
    if (t.kind === 'bowie') return s.bowie ? 'Bowie Knife equipped' : 'Bowie Knife · 3000';
    if (t.kind === 'power') return s.power || this.sides.has(t.side) ? '' : 'Activate power switch' + (this.sides.size ? ' · one more remains' : ' · both switches are needed');
    if (t.kind === 'door') return s.openDoors.has(t.group.name) ? '' : (t.group.kind === 'debris' ? 'Clear debris · ' : 'Open door · ') + t.group.cost;
    if (t.kind === 'barrier') return t.barrier.count < t.barrier.boards.length ? 'Hold F · Repair barricade' : '';
    return '';
  }

  findTarget() {
    let best = null, max = 110;
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    for (const t of this.targets) {
      const point = t.point ?? V(t.e.position), delta = point.clone().sub(this.camera.position), length = delta.length();
      if (length >= (t.range ?? max) || best && length >= best.distance) continue;
      const label = this.describe(t);
      if (!label) continue;
      if (length > 25 && delta.clone().normalize().dot(forward) < .25) continue;
      if (t.kind !== 'door') {
        const wall = this.raycast(new THREE.Ray(this.camera.position.clone(), delta.clone().normalize()), 1, length);
        if (wall && wall.distance < length - 32) continue;
      }
      best = { ...t, label, distance: length };
    }
    this.target = best;
    return best;
  }

  interact(t = this.target) {
    if (!t || !this.s.canAct && !(t.kind === 'pack' && this.s.pack)) return false;
    const s = this.s, a = this.combat.audio;
    let ok = false;
    if (t.kind === 'perk') {
      ok = s.buyPerk(t.perk);
      if (ok) {
        this.combat.clearInput();
        this.combat.perkDrink.start(t.perk, this.combat.view);
        this.notice(MOON_PERKS[t.perk].name);
        a.play(t.perk, 1, t.e.position);
      } else this.notice(s.perks.size >= s.perkLimit ? 'You can carry four perks.' : 'Cannot purchase: check points, power, and owned perks.');
    }
    if (t.kind === 'wall') ok = this.combat.buyWeapon(t.weapon.id);
    if (t.kind === 'box') {
      const roll = this.box.at(t.e);
      if (roll?.ready && !roll.teddy) {
        const id = this.box.take(t.e);
        ok = !!id;
        if (id) { s.giveWeapon(id); this.combat.equip().catch(console.error); this.notice(this.box.data.weapons[id].name); }
      } else if (!roll && this.box.available(t.e)) {
        const cost = s.effects.fire_sale > s.time ? 10 : 950;
        if (s.points >= cost && this.box.start(t.e)) { s.spend(cost); ok = true; } else this.notice('Not enough points.');
      }
    }
    if (t.kind === 'pack') {
      ok = s.power && (s.pack ? s.takePack() : s.beginPack());
      if (ok) { a.play('packapunch', 1, t.e.position); this.combat.equip().catch(console.error); this.notice(s.pack ? 'Weapon inserted. Retrieve it after five seconds.' : 'Weapon upgraded.'); }
      else this.notice(!s.power ? 'The machine needs power.' : s.pack ? 'The machine is still working.' : 'Pack-a-Punch requires 5000 points and an unupgraded weapon.');
    }
    if (t.kind === 'bowie' && !s.bowie && s.spend(3000)) { s.bowie = true; ok = true; this.notice('Bowie Knife equipped.'); }
    if (t.kind === 'power' && !s.power && !this.sides.has(t.side)) {
      this.sides.add(t.side);
      ok = true;
      if (this.sides.size >= 2) { s.power = true; this.notice('Power restored.', 5); } else this.notice('Switch thrown. Find the other one.', 4);
    }
    if (t.kind === 'door' && !s.openDoors.has(t.group.name)) {
      if (s.buyDoor(t.group)) { this.openDoor(t.group); this.notice(t.group.kind === 'debris' ? 'Debris cleared' : 'Passage opened', 2); ok = true; }
      else this.notice('Not enough points.');
    }
    if (ok && t.kind !== 'wall' && t.kind !== 'power') a.play('buy');
    return ok;
  }

  update(dt, held) {
    this.box.update(dt);
    this.updateBoards(dt);
    const t = held ? this.findTarget() : null;
    if (!held || t?.kind !== 'barrier' || !this.s.canAct) return;
    const b = t.barrier, s = this.s;
    if (b.rewardRound !== s.round) { b.rewardRound = s.round; b.reward = 0; }
    b.repairTime += dt;
    if (b.repairTime >= .7 && b.count < b.boards.length) {
      b.repairTime = 0;
      this.setBoards(b, b.count + 1, true);
      if (b.reward < Math.min(500, 40 + (s.round - 1) * 50)) { s.addPoints(10); b.reward += 10; }
      this.combat.audio.play('board');
    }
  }
}
