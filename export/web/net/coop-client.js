// Connects a running map to the multiplayer room it was started from: sends our pose and points, draws the other
// players as diamonds, keeps the live scoreboard in the HUD and tells zombies where the teammates are.
import * as THREE from 'three';
import { PoseSender, RemotePlayers } from './players.js';
import { Scoreboard } from './coop.js';
import { RemoteAvatars } from './avatars.js';
import { spawnScorePopup } from '../hud.js';
import { ZombieNet } from './zombie-net.js';
import { attachZombieNet } from './zombie-bridge.js';
import { createTickTimers } from './ticker.js';
import { ShotLimiter, cleanShot, packShot, shotGain } from './gunfire.js';

const SCORE_KEEPALIVE_MS = 2000;
const BACKGROUND_MS = 100;
const BACKGROUND_STEP = .05;
const BACKGROUND_MAX_CATCHUP = 2;

/**
 * Returns null in single player. `feet()` is the local player's feet position, `points()` their score and
 * `health()` a 0..1 value (0 while downed, so zombies stop chasing a teammate who cannot be hurt any more).
 */
export function createCoop({ scene, camera, feet, points, health = () => 1, config = globalThis.zombies?.multiplayer, now = () => performance.now(), doc = globalThis.document, timers = createTickTimers() }) {
  const lobby = config?.lobby, channel = lobby?.game ?? lobby?.channel;
  if (!config || !channel) return null;

  const selfId = config.selfId;
  const role = config.role === 'host' ? 'host' : config.role === 'client' ? 'client' : (lobby.hostId ? 'client' : 'host');
  const currentRoster = () => lobby.players?.() ?? lobby.roster ?? config.roster ?? [];
  const board = new Scoreboard(currentRoster(), selfId);
  board.prime(points());
  const remote = new RemotePlayers();
  remote.setRoster(currentRoster(), selfId);
  const avatars = new RemoteAvatars(scene);
  const sender = new PoseSender(channel);
  const vectors = new Map(), targetList = [];
  let lastScoreSent = -Infinity, rows = new Map(), panel = null, lastPoints = null;

  const stops = [
    channel.on('pose', (data, from) => remote.receive(from, data)),
    channel.on('state', (data, from) => { if (data?.score) board.receive(from, data.score); }),
  ];

  // ---- HUD -------------------------------------------------------------------------------------------------------
  const hudRoot = doc?.getElementById?.('hud') ?? doc?.body;
  const self = () => board.list().find(p => p.self);
  function paintSelfColor() {
    const entry = self(), box = doc?.getElementById?.('player-panel');
    if (!entry || !box) return;
    box.style.setProperty('--points-color', entry.color);
    box.style.setProperty('--popup-color', entry.color);
  }
  function buildRows() {
    if (!doc || !hudRoot) return;
    panel?.remove();
    panel = doc.createElement('div');
    panel.id = 'coop-scores';
    rows = new Map();
    for (const entry of board.list()) {
      if (entry.self) continue;
      const row = doc.createElement('div'); row.className = 'points coop-row'; row.style.setProperty('--c', entry.color);
      const popups = doc.createElement('span'); popups.className = 'coop-popups';
      const pts = doc.createElement('strong'); pts.className = 'coop-pts'; pts.style.color = entry.color; pts.textContent = String(entry.points);
      row.append(popups, pts);
      panel.append(row);
      rows.set(entry.id, { row, popups, pts });
    }
    // Teammates stack in a column right above our own points bubble (bottom right), ours staying the bottom one.
    const own = doc.getElementById?.('points')?.closest?.('.points'), home = own?.parentElement;
    if (own && home) { home.classList.add('has-coop'); home.insertBefore(panel, own); }
    else hudRoot.append(panel);
    paintSelfColor();
  }
  const stopPopups = board.onPopup((entry, delta) => { const ui = rows.get(entry.id); if (ui) spawnScorePopup(ui.popups, delta); });
  function refreshRoster() {
    const roster = currentRoster();
    board.setRoster(roster, selfId); remote.setRoster(roster, selfId);
    buildRows();
  }
  lobby.onChange?.(refreshRoster);
  buildRows();

  function sendPose() {
    const f = feet();
    sender.update({ x: f.x, y: f.y, z: f.z, yaw: camera.rotation.y, pitch: camera.rotation.x, w: '', a: 0, hp: health() });
  }
  function sendScore() {
    const total = points(), message = board.setLocal(total), t = now();
    if (message) { channel.send('state', { score: message }); lastScoreSent = t; }
    else if (t - lastScoreSent > SCORE_KEEPALIVE_MS) { channel.send('state', { score: { points: total, delta: 0 } }); lastScoreSent = t; }
    return total;
  }

  // ---- per frame -------------------------------------------------------------------------------------------------
  function update() {
    sendPose();

    const samples = remote.sample();
    avatars.sync(samples, board.roster, camera);
    targetList.length = 0;
    for (const s of samples) {
      if (s.hp <= 0) continue;                                  // downed teammates are not chased
      let v = vectors.get(s.id);
      if (!v) { vectors.set(s.id, v = new THREE.Vector3()); v.peerId = s.id; }
      v.set(s.x, s.y, s.z); targetList.push(v);
    }

    const total = sendScore();

    if (total !== lastPoints) { lastPoints = total; paintSelfColor(); }
    for (const entry of board.list()) {
      const ui = rows.get(entry.id);
      if (ui && ui.pts.textContent !== String(entry.points)) ui.pts.textContent = String(entry.points);
    }
  }

  let zombieHandle = null, simulation = null, backgroundTimer = null, lastBackground = now();

  function idle(dt) {
    if (!simulation) return;
    if (role === 'host') simulation.session.update(dt);
    simulation.enemies.update(dt, feet());
  }

  // A hidden tab gets no animation frames, so this timer (a Worker, see ticker.js) stands in for them: it keeps
  // our pose and points flowing so we do not vanish for the others, and the host keeps running the zombies and
  // broadcasting them so the game goes on until the host comes back.
  function startBackground() {
    if (backgroundTimer !== null) return;
    lastBackground = now();
    backgroundTimer = timers.setInterval(() => {
      const t = now(), elapsed = Math.min(BACKGROUND_MAX_CATCHUP, (t - lastBackground) / 1000);
      lastBackground = t;
      if (!doc?.hidden) return;
      try { sendPose(); sendScore(); } catch {}
      if (role !== 'host' || !simulation) return;
      for (let left = elapsed; left > 0; left -= BACKGROUND_STEP) idle(Math.min(BACKGROUND_STEP, left));
    }, BACKGROUND_MS);
  }

  let audioHandle = null, boxHandle = null;

  function attachBox(box) {
    if (boxHandle) return boxHandle;
    box.attachNet({
      selfId,
      send: data => channel.send('box', data),
      nameOf: id => currentRoster().find(p => p.id === id)?.name ?? 'Another player',
    });
    const stop = channel.on('box', (raw, from) => {
      if (from === selfId || !currentRoster().some(p => p.id === from)) return;
      box.receiveNet(from, raw);
    });
    boxHandle = { dispose() { stop?.(); box.attachNet(null); boxHandle = null; } };
    return boxHandle;
  }

  function attachAudio(audio, { weapons = {} } = {}) {
    if (audioHandle) return audioHandle;
    const original = audio.weapon;
    const limiter = new ShotLimiter();
    audio.weapon = function (kind, def, position, gain) {
      original.call(audio, kind, def, position, gain);
      if (kind !== 'shot' || position || !def?.id || !limiter.allow(now())) return;
      channel.send('shot', packShot(def, camera.position));
    };
    const stop = channel.on('shot', (raw, from) => {
      const shot = cleanShot(raw);
      if (!shot || from === selfId || !currentRoster().some(p => p.id === from)) return;
      const gain = shotGain(camera.position.distanceTo(new THREE.Vector3(shot.x, shot.y, shot.z)));
      if (gain <= 0) return;
      audio.weaponAt?.(weapons[shot.weapon] ?? { id: shot.weapon }, [shot.x, shot.y, shot.z], gain);
    });
    audioHandle = { dispose() { stop?.(); audio.weapon = original; audioHandle = null; } };
    return audioHandle;
  }

  function attachEnemies(enemies, { session, damage = () => {}, onAward = null }) {
    if (zombieHandle) return zombieHandle;
    const net = new ZombieNet({ channel, role, selfId, hostId: () => lobby.hostId ?? null, now });
    simulation = { enemies, session };
    zombieHandle = attachZombieNet(enemies, { net, session, damage, onAward, isMember: id => currentRoster().some(p => p.id === id) });
    startBackground();
    return zombieHandle;
  }

  startBackground();

  return {
    role,
    idle,
    attachEnemies,
    attachAudio,
    attachBox,
    update,
    /** Positions (THREE.Vector3, feet level) of living teammates, for zombie targeting. */
    targets: () => targetList,
    scores: () => board.list(),
    avatars,
    dispose() {
      for (const stop of stops) { try { stop?.(); } catch {} }
      stopPopups();
      if (backgroundTimer !== null) { timers.clearInterval(backgroundTimer); backgroundTimer = null; }
      try { zombieHandle?.dispose(); } catch {}
      zombieHandle = null; simulation = null;
      try { audioHandle?.dispose(); } catch {}
      try { boxHandle?.dispose(); } catch {}
      avatars.dispose();
      panel?.remove();
    },
  };
}
