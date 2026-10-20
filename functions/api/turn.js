const ENDPOINT = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const TTL_SECONDS = 24 * 60 * 60;
const JSON_TYPE = 'application/json; charset=utf-8';

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': JSON_TYPE, 'cache-control': status === 200 ? 'private, max-age=1800' : 'no-store' },
});

export function cleanIceServers(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const urls = [].concat(item?.urls ?? []).filter(url => typeof url === 'string' && /^(stun|turn|turns):/i.test(url) && !/:53(\?|$)/.test(url));
    if (!urls.length) continue;
    const server = { urls };
    if (typeof item.username === 'string') server.username = item.username;
    if (typeof item.credential === 'string') server.credential = item.credential;
    out.push(server);
  }
  return out;
}

export async function turnResponse(env, { fetcher = globalThis.fetch } = {}) {
  const keyId = env?.TURN_KEY_ID, token = env?.TURN_KEY_API_TOKEN;
  if (!keyId || !token) return reply({ error: 'TURN is not configured.' }, 404);
  try {
    const response = await fetcher(`${ENDPOINT}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    });
    if (!response.ok) return reply({ error: 'TURN service unavailable.' }, 502);
    const iceServers = cleanIceServers((await response.json())?.iceServers);
    if (!iceServers.some(server => server.urls.some(url => /^turns?:/i.test(url)))) return reply({ error: 'TURN service returned no relay.' }, 502);
    return reply({ iceServers });
  } catch {
    return reply({ error: 'TURN service unavailable.' }, 502);
  }
}

export const onRequestGet = ({ env }) => turnResponse(env);
