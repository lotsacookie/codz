// Connects a running map to the multiplayer room it was started from: sends our pose and points, draws the other
// players as diamonds, keeps the live scoreboard in the HUD and tells zombies where the teammates are.
import * as THREE from 'three';
import { PoseSender, RemotePlayers } from './players.js';
import { Scoreboard } from './coop.js';
import { RemoteAvatars } from './avatars.js';
import { spawnScorePopup } from '../hud.js';

const SCORE_KEEPALIVE_MS = 2000;

/**
 * Returns null in single player. `feet()` is the local player's feet position, `points()` their score and
 * `health()` a 0..1 value (0 while downed, so zombies stop chasing a teammate who cannot be hurt any more).
 */
export function createCoop({ scene, camera, feet, points, health = () => 1, config = globalThis.zombies?.multiplayer, now = () => performance.now(), doc = globalThis.document }) {
  const lobby = config?.lobby, channel = lobby?.game ?? lobby?.channel;
  if (!config || !channel) return null;

  const selfId = config.selfId;
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
      const name = doc.createElement('span'); name.className = 'coop-name'; name.textContent = entry.name; name.style.color = entry.color;
      const pts = doc.createElement('strong'); pts.className = 'coop-pts'; pts.style.color = entry.color; pts.textContent = String(entry.points);
      row.append(popups, name, pts);
      panel.append(row);
      rows.set(entry.id, { row, popups, pts });
    }
    hudRoot.append(panel);
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

  // ---- per frame -------------------------------------------------------------------------------------------------
  function update() {
    const f = feet();
    sender.update({ x: f.x, y: f.y, z: f.z, yaw: camera.rotation.y, pitch: camera.rotation.x, w: '', a: 0, hp: health() });

    const samples = remote.sample();
    avatars.sync(samples, board.roster, camera);
    targetList.length = 0;
    for (const s of samples) {
      if (s.hp <= 0) continue;                                  // downed teammates are not chased
      let v = vectors.get(s.id);
      if (!v) vectors.set(s.id, v = new THREE.Vector3());
      v.set(s.x, s.y, s.z); targetList.push(v);
    }

    const total = points(), message = board.setLocal(total), t = now();
    if (message) { channel.send('state', { score: message }); lastScoreSent = t; }
    else if (t - lastScoreSent > SCORE_KEEPALIVE_MS) { channel.send('state', { score: { points: total, delta: 0 } }); lastScoreSent = t; }

    if (total !== lastPoints) { lastPoints = total; paintSelfColor(); }
    for (const entry of board.list()) {
      const ui = rows.get(entry.id);
      if (ui && ui.pts.textContent !== String(entry.points)) ui.pts.textContent = String(entry.points);
    }
  }

  return {
    update,
    /** Positions (THREE.Vector3, feet level) of living teammates, for zombie targeting. */
    targets: () => targetList,
    scores: () => board.list(),
    avatars,
    dispose() {
      for (const stop of stops) { try { stop?.(); } catch {} }
      stopPopups();
      avatars.dispose();
      panel?.remove();
    },
  };
}
