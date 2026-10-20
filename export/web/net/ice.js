export const TURN_HOST = 'staticauth.openrelay.metered.ca';
export const TURN_SECRET = 'openrelayprojectsecret';
export const TURN_TTL_SECONDS = 24 * 60 * 60;
export const TURN_ENDPOINT = '/api/turn';
export const RELAY_REDUNDANCY = 5;

export const EXTRA_STUN_URLS = [
  'stun:stun3.l.google.com:19302',
  'stun:stun4.l.google.com:19302',
  'stun:global.stun.twilio.com:3478',
];

export const turnUrls = (host = TURN_HOST) => [
  `turn:${host}:80`,
  `turn:${host}:80?transport=tcp`,
  `turn:${host}:443`,
  `turns:${host}:443?transport=tcp`,
];

const ICE_URL = /^(stun|stuns|turn|turns):/i;
const TURN_URL = /^turns?:/i;

export const hasTurn = servers => (servers ?? []).some(server => [].concat(server?.urls ?? []).some(url => TURN_URL.test(url)));

export function validIceServers(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const urls = [].concat(item?.urls ?? []).filter(url => typeof url === 'string' && ICE_URL.test(url));
    if (!urls.length) continue;
    const server = { urls };
    if (typeof item.username === 'string') server.username = item.username;
    if (typeof item.credential === 'string') server.credential = item.credential;
    out.push(server);
  }
  return out;
}

export async function sharedSecretCredentials(secret, { now = Date.now(), ttl = TURN_TTL_SECONDS, label = 'codz', subtle = globalThis.crypto?.subtle } = {}) {
  if (!subtle) throw new Error('WebCrypto is not available');
  const encoder = new TextEncoder();
  const username = `${Math.floor(now / 1000) + ttl}:${label}`;
  const key = await subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await subtle.sign('HMAC', key, encoder.encode(username)));
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  return { username, credential: btoa(binary) };
}

export async function fetchServerIce({ fetcher = globalThis.fetch, url = TURN_ENDPOINT, timeoutMs = 4000 } = {}) {
  if (typeof fetcher !== 'function') return [];
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetcher(url, { cache: 'no-store', signal: controller?.signal });
    if (!response?.ok) return [];
    const body = await response.json();
    return validIceServers(body?.iceServers);
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function buildIce({ override = globalThis.CODZ_ICE_SERVERS, fetcher, now = Date.now(), subtle } = {}) {
  const servers = [{ urls: [...EXTRA_STUN_URLS] }];
  const custom = validIceServers(override);
  if (custom.length) return { servers: [...servers, ...custom], source: 'custom' };
  const hosted = await fetchServerIce({ fetcher });
  if (hasTurn(hosted)) return { servers: [...servers, ...hosted], source: 'server' };
  try {
    const credentials = await sharedSecretCredentials(TURN_SECRET, { now, subtle });
    return { servers: [...servers, { urls: turnUrls(), ...credentials }], source: 'openrelay' };
  } catch {
    return { servers, source: 'stun' };
  }
}

export async function buildTurnConfig(options) {
  return (await buildIce(options)).servers;
}

export function classifyCandidates(lines) {
  const found = { host: false, srflx: false, relay: false };
  for (const line of lines ?? []) {
    const match = /\btyp (host|srflx|prflx|relay)\b/.exec(String(line));
    if (!match) continue;
    found[match[1] === 'prflx' ? 'srflx' : match[1]] = true;
  }
  return found;
}

export function probeIce({ servers = [], RTCPeerConnection = globalThis.RTCPeerConnection, timeoutMs = 6000 } = {}) {
  if (typeof RTCPeerConnection !== 'function') return Promise.resolve({ host: false, srflx: false, relay: false, supported: false });
  return new Promise(resolve => {
    const lines = [];
    let pc = null, done = false, timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try { pc?.close(); } catch {}
      resolve({ ...classifyCandidates(lines), supported: true });
    };
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }, ...servers] });
      pc.onicecandidate = event => { if (event.candidate) lines.push(event.candidate.candidate); else finish(); };
      pc.createDataChannel('probe');
      pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(finish);
    } catch {
      finish();
      return;
    }
    timer = setTimeout(finish, timeoutMs);
  });
}

const SOURCE_LABEL = { custom: 'your custom relay', server: 'the game server relay', openrelay: 'the free Open Relay server', stun: 'no relay' };

export function describeProbe(result, source) {
  if (!result?.supported) return { ok: false, text: 'This browser cannot do multiplayer because WebRTC is unavailable.' };
  if (result.relay) return { ok: true, text: `Network check passed. The relay is reachable (${SOURCE_LABEL[source] ?? source}), so games on other networks should connect.` };
  if (result.srflx && source === 'stun') return { ok: false, text: 'Your network is reachable, but no relay server is set up. Players behind strict networks cannot connect across networks.' };
  if (result.srflx) return { ok: false, text: `Your network is reachable, but the relay did not answer (${SOURCE_LABEL[source] ?? source}). Players behind strict networks cannot connect across networks.` };
  if (result.host) return { ok: false, text: 'This browser reached no internet STUN server. A VPN, firewall or privacy setting is blocking WebRTC.' };
  return { ok: false, text: 'No network candidates were found. WebRTC may be disabled by the browser or an extension.' };
}
