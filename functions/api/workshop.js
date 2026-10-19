import { searchLive } from '../../.tools/lib/workshop-crawl.mjs';

// Optional live Steam Workshop search for hosts that can run functions (Cloudflare Pages, `npm start`).
// Static hosts (GitHub Pages) answer 404 here and the menu falls back to maps/workshop/index.json.
const TTL = 10 * 60 * 1000;
const FAIL_TTL = 60 * 1000;
const MAX_ENTRIES = 300;
const JSON_TYPE = 'application/json; charset=utf-8';
const cache = new Map();
const pending = new Map();
let blockedUntil = 0;

export function normalizeParams(input) {
  const query = String(input?.query ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const page = Math.min(500, Math.max(1, Math.floor(Number(input?.page)) || 1));
  return { query, page };
}

const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': JSON_TYPE, 'cache-control': status === 200 ? 'public, max-age=300' : 'no-store', ...extra },
});

export async function workshopResponse(url, { search = searchLive, now = Date.now() } = {}) {
  const { query, page } = normalizeParams({ query: url.searchParams.get('q'), page: url.searchParams.get('page') });
  const key = `${query.toLowerCase()}|${page}`;
  const hit = cache.get(key);
  if (hit && hit.until > now) return reply(hit.body);
  if (blockedUntil > now) return reply({ error: 'Steam is busy. Showing the saved list instead.' }, 503, { 'retry-after': String(Math.ceil((blockedUntil - now) / 1000)) });
  if (!pending.has(key)) {
    pending.set(key, search({ query, page }).then(body => {
      cache.set(key, { body, until: now + TTL });
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
      return body;
    }).finally(() => pending.delete(key)));
  }
  try {
    return reply(await pending.get(key));
  } catch (error) {
    blockedUntil = now + FAIL_TTL;
    return reply({ error: error?.message ?? 'Steam search failed.' }, 502);
  }
}

export const onRequestGet = ({ request }) => workshopResponse(new URL(request.url));
