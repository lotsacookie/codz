import { ANNOUNCE_MS, DIRECTORY_ROOM, Directory, MAX_PLAYERS, NET_VERSION, cleanName, gameRoomId, makeCode, makeListing, normalizeCode } from './protocol.js';
import { openChannel } from './transport.js';


/**
 * Hosts a lobby: announces itself in the shared directory room (that is what the server browser shows), accepts
 * players into its own game room and keeps the roster. The host is authoritative for who is in the game.
 */
export class HostLobby {
  constructor(net, { name, playerName, map, mapLabel, max = MAX_PLAYERS, password = '', code = makeCode(), setInterval: si = globalThis.setInterval, clearInterval: ci = globalThis.clearInterval } = {}) {
    this.net = net; this.code = normalizeCode(code); this.password = password || '';
    this.info = { name, map, mapLabel, max, host: cleanName(playerName), locked: !!password };
    this.started = false; this.round = 0; this.listeners = new Set(); this.timers = { si, ci };
    this.roster = new Map([[net.selfId, { id: net.selfId, name: cleanName(playerName), host: true, ready: true }]]);
    this.game = null; this.directory = null; this.timer = null;
  }
  onChange(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(this.players()); }
  players() { return [...this.roster.values()]; }
  listing() { return makeListing({ ...this.info, code: this.code, players: this.roster.size, round: this.round, started: this.started }); }

  open() {
    this.game = openChannel(this.net, gameRoomId(this.code), { password: this.password });
    this.directory = openChannel(this.net, DIRECTORY_ROOM);
    this.game.on('hello', (hello, from) => this.handleHello(hello, from));
    this.game.on('ready', (ready, from) => { const p = this.roster.get(from); if (p) { p.ready = !!ready; this.pushRoster(); } });
    this.game.onLeave(id => { if (this.roster.delete(id)) this.pushRoster(); });
    this.directory.onJoin(id => this.directory.send('listing', this.listing(), id));   // a new browser sees us immediately
    this.timer = this.timers.si(() => this.announce(), ANNOUNCE_MS);
    this.announce();
    return this;
  }
  announce() { this.directory?.send('listing', this.listing()); }

  handleHello(hello, from) {
    if (this.roster.has(from)) return;
    const reject = reason => this.game.send('reject', { reason }, from);
    if (!hello || hello.v !== NET_VERSION) return reject('Different game version');
    if (this.started) return reject('Game already started');
    if (this.roster.size >= this.info.max) return reject('Game is full');
    this.roster.set(from, { id: from, name: cleanName(hello.name), host: false, ready: false });
    this.game.send('welcome', { you: from, host: this.net.selfId, code: this.code, map: this.info.map, mapLabel: this.info.mapLabel, name: this.info.name, roster: this.players() }, from);
    this.pushRoster();
  }
  pushRoster() { this.game.send('roster', this.players()); this.announce(); this.emit(); }

  /** Everyone gets the same seed so their worlds agree. Players who joined stay; the room stops accepting more. */
  start() {
    if (this.started) return null;
    this.started = true;
    const payload = { map: this.info.map, seed: (Math.random() * 2 ** 32) >>> 0, roster: this.players() };
    this.game.send('start', payload);
    this.announce();
    this.emit();
    return payload;
  }
  setRound(round) { if (round !== this.round) { this.round = round; this.announce(); } }

  async close() {
    this.timers.ci(this.timer);
    await this.directory?.leave();
    await this.game?.leave();
    this.roster.clear();
  }
}

/** Joins a lobby by code (or from a browser entry) and follows the host's roster and start message. */
export class ClientLobby {
  constructor(net, { code, playerName, password = '', timeoutMs = 15000, setTimeout: st = globalThis.setTimeout, clearTimeout: ct = globalThis.clearTimeout } = {}) {
    this.net = net; this.code = normalizeCode(code); this.password = password || ''; this.playerName = cleanName(playerName);
    this.timeoutMs = timeoutMs; this.timers = { st, ct };
    this.roster = []; this.hostId = null; this.welcome = null; this.channel = null; this.listeners = new Set();
  }
  onChange(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(this.roster); }

  /** Resolves with the host's welcome message, or rejects with a readable reason. */
  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, value) => { if (settled) return; settled = true; this.timers.ct(timer); fn(value); };
      const timer = this.timers.st(() => { this.channel?.leave(); done(reject, new Error('Could not reach that game. Check the code and password, or the host may have left.')); }, this.timeoutMs);
      this.channel = openChannel(this.net, gameRoomId(this.code), {
        password: this.password,
        onJoinError: ({ error }) => done(reject, new Error(/password/i.test(error) ? 'Wrong password' : error)),
      });
      const hello = () => this.channel.send('hello', { v: NET_VERSION, name: this.playerName });
      this.channel.on('welcome', (data, from) => {
        if (this.hostId) return;                       // only the first host answer counts
        this.hostId = from; this.welcome = data; this.roster = data.roster ?? []; this.emit(); done(resolve, data);
      });
      this.channel.on('reject', reason => done(reject, new Error(reason?.reason ?? 'Could not join')));
      this.channel.on('roster', (roster, from) => { if (from === this.hostId) { this.roster = roster; this.emit(); } });
      this.channel.on('start', (payload, from) => { if (from === this.hostId) this.onStart?.(payload); });
      this.channel.onJoin(hello);                      // say hello to every peer that appears; only the host answers
      this.channel.onLeave(id => { if (id === this.hostId) this.onHostLeft?.(); });
    });
  }
  setReady(ready) { this.channel?.send('ready', !!ready, this.hostId); }
  async close() { this.timers.ct(undefined); await this.channel?.leave(); }
}

/** Server browser: watches the directory room and keeps a live list of games. */
export class ServerBrowser {
  constructor(net, directory = new Directory()) {
    this.net = net; this.directory = directory; this.channel = null; this.pruneTimer = null;
  }
  open({ setInterval: si = globalThis.setInterval } = {}) {
    this.channel = openChannel(this.net, DIRECTORY_ROOM);
    this.channel.on('listing', (raw, from) => this.directory.announce(from, raw));
    this.channel.onLeave(id => this.directory.remove(id));
    this.pruneTimer = si(() => this.directory.prune(), 2000);
    return this;
  }
  list() { return this.directory.list(); }
  onChange(fn) { return this.directory.onChange(fn); }
  async close() { clearInterval(this.pruneTimer); await this.channel?.leave(); }
}

export const newLobbyName = playerName => `${cleanName(playerName)}'s game`;
