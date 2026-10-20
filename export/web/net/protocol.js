// Multiplayer wire format and the server-browser directory. Pure logic (no DOM, no network) so it is unit tested.

export const NET_VERSION = 2;
export const APP_ID = 'codz-zombies-v1';          // namespaces every room so we never collide with other Trystero apps
export const DIRECTORY_ROOM = 'directory';        // everyone who opens the browser joins this room
export const MAX_PLAYERS = 4;
export const LISTING_TTL_MS = 12000;              // a host that has not re-announced in this long disappears from the list
export const ANNOUNCE_MS = 4000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I

export function makeCode(random = Math.random, length = 5) {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return out;
}

export const normalizeCode = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
export const gameRoomId = code => `game-${normalizeCode(code)}`;

export const cleanText = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
export const cleanName = value => cleanText(value, 20) || 'Player';

export const CUSTOM_MAP_ID = 'custom-map';

/** Which loader a shared map link needs. Local files and Sketchfab tokens cannot be shared, so only links qualify. */
export function inferMapSource(url) {
  const text = String(url ?? '').trim();
  if (/^https?:\/\/\S+\.bsp(?:\?\S*)?$/i.test(text)) return 'bsp';
  if (/^https?:\/\/\S+\.map(?:\?\S*)?$/i.test(text) || /^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\/tree\/[^/\s]+)?\/?$/i.test(text)) return 'iwmap';
  if (/^https?:\/\/\S+\.(?:glb|gltf)(?:\?\S*)?$/i.test(text)) return 'url';
  return null;
}

/**
 * A custom map the host shares with the lobby. Players download it themselves from the link, so this is only ever
 * a source kind, an http(s) URL and a label; anything else a remote peer sends is dropped.
 */
export function cleanCustomMap(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // A map that ships with the game is shared by id; each player resolves it to their own copy.
  if (raw.builtin != null) {
    const id = String(raw.builtin);
    return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? { source: 'bsp', builtin: id, label: cleanText(raw.label, 40) || id } : null;
  }
  const url = String(raw.url ?? '').trim();
  if (url.length > 500 || /[\u0000-\u0020\u007f<>"']/.test(url)) return null;
  const source = inferMapSource(url);
  if (!source) return null;
  return { source, url, label: cleanText(raw.label, 40) || 'Custom map' };
}

/** What a host announces. Anything a remote peer sends is clamped here before it reaches the UI. */
export function makeListing({ code, name, map, mapLabel, players = 1, max = MAX_PLAYERS, locked = false, round = 0, host = 'Host', started = false, custom = false }) {
  return {
    v: NET_VERSION,
    code: normalizeCode(code),
    name: cleanText(name, 32) || `${cleanName(host)}'s game`,
    map: cleanText(map, 40),
    mapLabel: cleanText(mapLabel || map, 40),
    players: clampInt(players, 1, MAX_PLAYERS),
    max: clampInt(max, 1, MAX_PLAYERS),
    locked: !!locked,
    round: clampInt(round, 0, 999),
    host: cleanName(host),
    started: !!started,
    custom: !!custom,
  };
}

export function validListing(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== NET_VERSION) return null;
  const listing = makeListing(raw);
  return listing.code.length >= 4 && listing.map ? listing : null;
}

function clampInt(value, lo, hi) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

/** The set of games currently visible in the server browser. Listings expire unless re-announced. */
export class Directory {
  constructor({ now = () => Date.now(), ttl = LISTING_TTL_MS } = {}) {
    this.now = now; this.ttl = ttl; this.entries = new Map(); this.listeners = new Set();
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** Record an announcement from `peerId`. A peer can only own one listing, so a re-announce replaces it. */
  announce(peerId, raw) {
    const listing = validListing(raw);
    if (!listing) return false;
    const before = JSON.stringify(this.entries.get(peerId)?.listing);
    this.entries.set(peerId, { peerId, listing, seen: this.now() });
    if (before !== JSON.stringify(listing)) this.emit();
    return true;
  }
  remove(peerId) { if (this.entries.delete(peerId)) this.emit(); }
  prune() {
    const cutoff = this.now() - this.ttl;
    let changed = false;
    for (const [id, entry] of this.entries) if (entry.seen < cutoff) { this.entries.delete(id); changed = true; }
    if (changed) this.emit();
  }
  /** Joinable games first (not full), then by player count so busy lobbies are easy to spot. */
  list() {
    this.prune();
    return [...this.entries.values()].map(e => ({ peerId: e.peerId, ...e.listing }))
      .sort((a, b) => (Number(a.players >= a.max) - Number(b.players >= b.max)) || b.players - a.players || a.name.localeCompare(b.name));
  }
  find(code) { const wanted = normalizeCode(code); return this.list().find(g => g.code === wanted) ?? null; }
  emit() { for (const fn of this.listeners) fn(); }
}

/** Messages inside a game room are `{ t: type, d: data }`. Unknown or malformed ones are dropped. */
export const MESSAGE_TYPES = new Set(['listing', 'hello', 'welcome', 'reject', 'roster', 'ready', 'start', 'pose', 'event', 'chat', 'state', 'zsnap', 'zhit', 'zdead', 'award', 'hurt', 'boards', 'shot', 'box', 'pdrop', 'ptake', 'pgrab', 'unlock']);
export function packMessage(type, data) { return { t: type, d: data ?? null }; }
export function unpackMessage(raw) {
  if (!raw || typeof raw !== 'object' || !MESSAGE_TYPES.has(raw.t)) return null;
  return { type: raw.t, data: raw.d ?? null };
}
