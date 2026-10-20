export const TURN_HOST = 'staticauth.openrelay.metered.ca';
export const TURN_SECRET = 'openrelayprojectsecret';
export const TURN_TTL_SECONDS = 24 * 60 * 60;
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

export async function buildTurnConfig({ override = globalThis.CODZ_ICE_SERVERS, now = Date.now(), subtle } = {}) {
  const config = [{ urls: [...EXTRA_STUN_URLS] }];
  const custom = validIceServers(override);
  if (custom.length) return [...config, ...custom];
  try {
    const credentials = await sharedSecretCredentials(TURN_SECRET, { now, subtle });
    config.push({ urls: turnUrls(), ...credentials });
  } catch {}
  return config;
}
