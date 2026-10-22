const MAX_KEYS = 256;

const cleanKey = value => String(value ?? '').replace(/[^a-z0-9_.:-]/gi, '').slice(0, 64);

export function packUnlock(kind, value) {
  const n = cleanKey(value);
  return n ? { k: kind === 'wall' ? 'w' : 'd', n } : null;
}

export function cleanUnlock(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.k === 'r') return { kind: 'request' };
  const key = cleanKey(raw.n);
  if (!key) return null;
  if (raw.k === 'd') return { kind: 'door', key };
  if (raw.k === 'w') return { kind: 'wall', key };
  return null;
}

export class WorldSync {
  constructor({ send = () => {}, applyDoor = () => {}, applyWall = () => {} } = {}) {
    this.send = send;
    this.applyDoor = applyDoor;
    this.applyWall = applyWall;
    this.doors = new Set();
    this.walls = new Set();
  }

  setFor(kind) { return kind === 'wall' ? this.walls : this.doors; }

  // Everything bought so far, so a teammate who joins or loads late can catch up (the host answers their request).
  replay(target) {
    let count = 0;
    for (const n of this.doors) { this.send({ k: 'd', n }, target); count++; }
    for (const n of this.walls) { this.send({ k: 'w', n }, target); count++; }
    return count;
  }

  request() { this.send({ k: 'r' }); }

  local(kind, value) {
    const message = packUnlock(kind, value);
    if (!message) return false;
    const known = this.setFor(kind);
    if (known.has(message.n) || known.size >= MAX_KEYS) return false;
    known.add(message.n);
    this.send(message);
    return true;
  }

  door(value) { return this.local('door', value); }
  wall(value) { return this.local('wall', value); }

  receive(raw, from) {
    const message = cleanUnlock(raw);
    if (!message) return false;
    if (message.kind === 'request') { if (from !== undefined) this.replay(from); return false; }
    const known = this.setFor(message.kind);
    if (known.has(message.key) || known.size >= MAX_KEYS) return false;
    known.add(message.key);
    try {
      (message.kind === 'wall' ? this.applyWall : this.applyDoor)(message.key, from);
    } catch {}
    return true;
  }

  reset() {
    this.doors.clear();
    this.walls.clear();
  }
}
