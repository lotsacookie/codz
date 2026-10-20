import { ZOMBIE_HZ, packHit } from './zombie-sync.js';

export class ZombieNet {
  constructor({ channel, role, selfId, hostId = () => null, now = () => performance.now(), hz = ZOMBIE_HZ }) {
    this.channel = channel; this.role = role; this.selfId = selfId; this.hostIdOf = hostId; this.now = now;
    this.interval = 1000 / hz; this.last = -Infinity; this.seq = 0; this.stops = [];
  }

  get isHost() { return this.role === 'host'; }
  get isClient() { return this.role === 'client'; }
  get hostId() { return this.isHost ? this.selfId : this.hostIdOf(); }

  on(type, fn) {
    const stop = this.channel.on(type, fn);
    this.stops.push(stop);
    return stop;
  }

  snapshotDue(t = this.now()) {
    if (t - this.last < this.interval) return false;
    this.last = t;
    return true;
  }

  nextSeq() { return ++this.seq; }

  broadcast(snapshot) { return this.channel.send('zsnap', snapshot); }
  dead(z, cause) { return this.channel.send('zdead', { i: z.id | 0, c: String(cause ?? 'bullet').slice(0, 16), g: z.gasDeath ? 1 : 0 }); }
  award(peer, { killed = false, head = false, melee = false } = {}) { return this.channel.send('award', { k: killed ? 1 : 0, h: head ? 1 : 0, m: melee ? 1 : 0 }, peer); }
  hurtPeer(peer, amount) { return this.channel.send('hurt', { a: Math.round(amount) }, peer); }

  sendHit(id, hit) {
    const host = this.hostId;
    if (!host) return Promise.resolve();
    return this.channel.send('zhit', packHit(id, hit), host);
  }

  sendNuke() {
    const host = this.hostId;
    if (!host) return Promise.resolve();
    return this.channel.send('zhit', { nuke: 1 }, host);
  }

  sendBoards(index, count) {
    const host = this.hostId;
    if (!host) return Promise.resolve();
    return this.channel.send('boards', { i: index, n: count }, host);
  }

  dispose() {
    for (const stop of this.stops) { try { stop?.(); } catch {} }
    this.stops.length = 0;
  }
}
