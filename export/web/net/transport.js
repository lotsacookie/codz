import { APP_ID, packMessage, unpackMessage } from './protocol.js';
import { RELAY_REDUNDANCY, buildTurnConfig } from './ice.js';

/**
 * A thin, testable wrapper over one Trystero room. `joinRoom` is injected so tests can use a fake network and the
 * real build lazily imports the vendored bundle (WebRTC peers matched through public BitTorrent trackers: no
 * account, API key or server of our own). `turnConfig` adds relay servers so peers on different networks (strict
 * NATs, mobile data, school or office networks) can still connect and see each other's games.
 */
export async function loadJoinRoom() {
  const mod = await import('../vendor/trystero.js');
  const turnConfig = await buildTurnConfig();
  return { joinRoom: mod.joinRoom, selfId: mod.selfId, turnConfig };
}

export class Channel {
  constructor(room, selfId) {
    this.room = room; this.selfId = selfId; this.peers = new Set(); this.handlers = new Map();
    this.joinHandlers = new Set(); this.leaveHandlers = new Set(); this.closed = false;
    this.action = room.makeAction('m');
    this.action.onMessage = (raw, context) => {
      const message = unpackMessage(raw);
      if (!message || this.closed) return;
      for (const fn of this.handlers.get(message.type) ?? []) fn(message.data, context.peerId);
    };
    room.onPeerJoin = id => { this.peers.add(id); for (const fn of this.joinHandlers) fn(id); };
    room.onPeerLeave = id => { this.peers.delete(id); for (const fn of this.leaveHandlers) fn(id); };
  }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }
  onJoin(fn) { this.joinHandlers.add(fn); }
  onLeave(fn) { this.leaveHandlers.add(fn); }
  /** `target` is a peer id, a list of ids, or omitted to broadcast to everyone in the room. */
  send(type, data, target) {
    if (this.closed) return Promise.resolve();
    return this.action.send(packMessage(type, data), target ? { target } : undefined).catch(() => {});
  }
  async leave() {
    if (this.closed) return;
    this.closed = true; this.handlers.clear(); this.joinHandlers.clear(); this.leaveHandlers.clear();
    try { await this.room.leave(); } catch {}
  }
}

export function openChannel({ joinRoom, selfId, turnConfig }, roomId, { password, onJoinError } = {}) {
  const config = { appId: APP_ID, relayConfig: { redundancy: RELAY_REDUNDANCY } };
  if (turnConfig?.length) config.turnConfig = turnConfig;
  if (password) config.password = password;
  const room = joinRoom(config, roomId, onJoinError ? { onJoinError } : undefined);
  return new Channel(room, selfId);
}
