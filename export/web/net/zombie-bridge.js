import * as THREE from 'three';
import { PuppetTracker, STATES, cleanAward, cleanBoardRequest, cleanDead, cleanHit, cleanHurt, cleanSnapshot, followPosition, packSnapshot } from './zombie-sync.js';

const BLEND = .18;
const MAX_NEW_PER_FRAME = 4;

export function attachZombieNet(enemies, { net, session, world = enemies.world, damage = () => {}, isMember = () => true, onAward = null }) {
  const barrierList = () => {
    for (const list of [world?.barriers, enemies.barriers]) if (Array.isArray(list) && list.length) return list;
    return [];
  };
  const maxBoards = b => b?.boards?.length || 6;
  enemies.net = net;
  return net.isHost ? attachHost() : attachClient();

  function attachHost() {
    const original = enemies.update.bind(enemies);
    enemies.update = (dt, player) => {
      original(dt, player);
      if (!net.snapshotDue()) return;
      const barriers = barrierList();
      net.broadcast(packSnapshot({
        seq: net.nextSeq(),
        time: net.now(),
        session,
        zombies: enemies.list.filter(z => z.state !== 'dead'),
        boards: barriers.length ? barriers.map(b => b.count ?? 0) : null,
      }));
    };

    net.on('zhit', (raw, from) => {
      if (!isMember(from)) return;
      const hit = cleanHit(raw);
      if (!hit) return;
      enemies.currentShooter = from;
      try {
        if (hit.nuke) { enemies.nuke(() => {}); return; }
        const z = enemies.list.find(e => e.id === hit.id);
        if (z) enemies.hurt(z, hit.damage, hit.head, hit.melee, hit.cause, hit.score);
      } finally { enemies.currentShooter = null; }
    });

    net.on('boards', (raw, from) => {
      if (!isMember(from)) return;
      const request = cleanBoardRequest(raw);
      const b = request && barrierList()[request.index];
      if (b) world.setBoards(b, Math.min(maxBoards(b), request.count), true);
    });

    return {
      role: 'host',
      dispose() {
        enemies.update = original;
        enemies.net = null;
        net.dispose();
      },
    };
  }

  function attachClient() {
    const tracker = new PuppetTracker({ now: () => net.now() });
    const puppets = new Map();
    const original = { update: enemies.update, hurt: enemies.hurt, nuke: enemies.nuke, reset: enemies.reset };
    const fromHost = from => from === net.hostId;
    let pendingBoards = null, applying = false, hooked = null, rawSetBoards = null;

    function dropPuppet(id) {
      const z = puppets.get(id);
      if (!z) return;
      puppets.delete(id);
      if (enemies.list.includes(z)) enemies.remove(z);
    }

    function clearAll() {
      for (const id of [...puppets.keys()]) dropPuppet(id);
      tracker.clear();
    }

    function makePuppet(entry) {
      const at = tracker.sample(entry.id, net.now());
      if (!at) return null;
      const before = session.spawned;
      let z = null;
      try { z = enemies.spawn(new THREE.Vector3(at.x, at.y, at.z), null, entry.kind); } catch { z = null; }
      session.spawned = before;
      if (!z) return null;
      z.remoteId = entry.id;
      z.state = STATES[entry.state] ?? 'chase';
      z.growl = 2 + Math.random() * 6;
      puppets.set(entry.id, z);
      return z;
    }

    function killPuppet({ id, cause, gas }) {
      const z = puppets.get(id);
      tracker.forget(id);
      if (!z) return;
      puppets.delete(id);
      const i = enemies.list.indexOf(z);
      if (i >= 0) enemies.list.splice(i, 1);
      enemies.silence(z);
      z.state = 'dead'; z.life = 4; z.deathCause = cause; z.gasDeath = !!gas;
      z.rig.play('death', false);
      enemies.dead.push(z);
      enemies.onPuppetKill?.(z);
      if (enemies.dead.length > 12) enemies.discardDead(enemies.dead.shift());
    }

    function applyWorld(snap) {
      session.round = snap.round;
      session.total = snap.total;
      session.spawned = snap.spawned;
      session.killed = snap.killed;
      session.dogRound = snap.dogRound;
      const corePhase = session.corePhase ?? session.phase;
      if (corePhase === 'preparing' || corePhase === 'fighting') {
        session.phase = snap.phase;
        if (snap.phase === 'preparing') session.countdown = snap.countdown;
      }
      if (snap.boards) pendingBoards = snap.boards;
    }

    function hookWorld() {
      if (!world || typeof world.setBoards !== 'function' || world.setBoards === hooked) return;
      const raw = world.setBoards;
      rawSetBoards = raw;
      hooked = function (b, n, animate) {
        if (applying) return raw.call(world, b, n, animate);
        const index = barrierList().indexOf(b);
        if (index < 0) return raw.call(world, b, n, animate);
        net.sendBoards(index, n);
      };
      world.setBoards = hooked;
    }

    function syncBoards() {
      hookWorld();
      if (!pendingBoards || !rawSetBoards) return;
      const counts = pendingBoards, list = barrierList();
      pendingBoards = null;
      counts.forEach((n, i) => {
        const b = list[i];
        if (!b || b.count === n) return;
        applying = true;
        try { rawSetBoards.call(world, b, n, true); } finally { applying = false; }
      });
    }

    function updatePuppets(dt) {
      syncBoards();
      const t = net.now();
      for (const id of tracker.stale(t)) { tracker.forget(id); dropPuppet(id); }
      let created = 0;
      for (const id of tracker.ids()) {
        const entry = tracker.get(id);
        let z = puppets.get(id);
        if (!z) {
          if (created >= MAX_NEW_PER_FRAME) continue;
          z = makePuppet(entry);
          if (!z) continue;
          created++;
        }
        const at = tracker.sample(id, t);
        if (!at) continue;
        followPosition(z.root.position, at, dt);
        z.root.rotation.y = at.yaw;
        const state = STATES[entry.state] ?? 'chase';
        if (state !== z.state) {
          z.state = state;
          if (state === 'attack') z.rig.play('attack', false, 1, BLEND);
          else if (state === 'barricade') z.rig.play('attack', true, 1, BLEND);
          else z.rig.play('walk', true, 1, BLEND);
        }
        z.health = entry.hp * (z.maxHealth || 1);
        z.rig.update(dt);
        z.growl -= dt;
        if (z.growl < 0) { enemies.onSound?.('growl', z.root.position); z.growl = 6 + Math.random() * 7; }
        if (z.kind === 'zombie' && (state === 'chase' || state === 'approach')) enemies.speak(z, dt);
      }
      enemies.updateDead(dt);
    }

    enemies.update = (dt) => updatePuppets(dt);
    enemies.hurt = (z, damageDealt, head = false, melee = false, cause = 'bullet', score = true) => {
      if (!enemies.list.includes(z) || z.remoteId === undefined) return;
      enemies.onHit?.(z, head);
      net.sendHit(z.remoteId, { damage: damageDealt, head, melee, cause, score });
    };
    enemies.nuke = () => { net.sendNuke(); };
    enemies.reset = (...args) => {
      original.reset.apply(enemies, args);
      puppets.clear();
      tracker.clear();
    };

    net.on('zsnap', (raw, from) => {
      if (!fromHost(from)) return;
      const snap = cleanSnapshot(raw);
      if (!snap) return;
      if ((session.area ?? '') !== snap.area) { clearAll(); return; }
      const { gone } = tracker.receive(snap);
      for (const id of gone) dropPuppet(id);
      applyWorld(snap);
    });

    net.on('zdead', (raw, from) => {
      if (!fromHost(from)) return;
      const dead = cleanDead(raw);
      if (dead) killPuppet(dead);
    });

    net.on('award', (raw, from) => {
      if (!fromHost(from)) return;
      const award = cleanAward(raw);
      if (!award) return;
      session.scoreHit(award.killed, award.head, award.melee);
      onAward?.(award);
    });

    net.on('hurt', (raw, from) => {
      if (!fromHost(from)) return;
      const hurt = cleanHurt(raw);
      if (hurt) damage(hurt.amount);
    });

    return {
      role: 'client',
      puppets,
      tracker,
      dispose() {
        enemies.update = original.update;
        enemies.hurt = original.hurt;
        enemies.nuke = original.nuke;
        enemies.reset = original.reset;
        if (hooked && world.setBoards === hooked && rawSetBoards) world.setBoards = rawSetBoards;
        enemies.net = null;
        clearAll();
        net.dispose();
      },
    };
  }
}
