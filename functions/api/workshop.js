const APP_ID = 311210;
const PER_PAGE = 18;
const MAX_PAGE = 500;
const BROWSE = 'https://steamcommunity.com/workshop/browse/';
const DETAILS = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};
const TTL = 10 * 60 * 1000;
const FAIL_TTL = 60 * 1000;
const MAX_ENTRIES = 300;
const JSON_TYPE = 'application/json; charset=utf-8';

export class WorkshopError extends Error {
  constructor(message, status = 502, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function point(code) {
  try { return String.fromCodePoint(code); } catch { return ''; }
}

const decode = text => String(text ?? '')
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => point(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, code) => point(Number(code)))
  .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);

const plain = html => decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

const first = (text, pattern) => pattern.exec(text)?.[1];

export function normalizeParams(input) {
  const query = String(input?.query ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(input?.page)) || 1));
  return { query, page };
}

export function browseUrl({ query = '', page = 1 } = {}) {
  const params = new URLSearchParams({
    appid: String(APP_ID),
    childpublishedfileid: '0',
    section: 'readytouseitems',
    numperpage: String(PER_PAGE),
    p: String(page),
    l: 'english',
  });
  const text = query.trim();
  if (text) {
    params.set('searchtext', text);
    params.set('browsesort', 'textsearch');
    params.set('actualsort', 'textsearch');
  } else {
    params.set('browsesort', 'trend');
    params.set('actualsort', 'trend');
    params.set('days', '-1');
  }
  return `${BROWSE}?${params}`;
}

export function parseBrowse(html) {
  const text = String(html ?? '');
  const marks = [];
  const seen = new Set();
  for (const match of text.matchAll(/(?:data-publishedfileid=["']|sharedfiles\/filedetails\/\?id=)(\d{3,})/g)) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    marks.push({ id: match[1], at: match.index });
  }
  const items = marks.slice(0, PER_PAGE).map((mark, index) => {
    const block = text.slice(mark.at, Math.min(marks[index + 1]?.at ?? text.length, mark.at + 6000));
    const imageTag = /<img\b[^>]*class=["'][^"']*workshopItemPreviewImage[^"']*["'][^>]*>/.exec(block)?.[0] ?? '';
    return {
      id: mark.id,
      name: plain(first(block, /class=["'][^"']*workshopItemTitle[^"']*["'][^>]*>([\s\S]*?)<\/div>/)),
      author: plain(first(block, /class=["'][^"']*workshopItemAuthorName[^"']*["'][^>]*>([\s\S]*?)<\/div>/)).replace(/^by\s+/i, ''),
      thumb: decode(first(imageTag, /\ssrc=["']([^"']+)["']/) ?? ''),
      rating: Number(first(block, /\/(\d)-star/)) || 0,
    };
  });
  const info = plain(first(text, /class=["'][^"']*workshopBrowsePagingInfo[^"']*["'][^>]*>([\s\S]*?)<\/div>/));
  const total = Number((first(info, /of\s+([\d.,\s]+?)\s*entries/i) ?? '').replace(/\D/g, '')) || 0;
  const linked = [...text.matchAll(/class=["']pagelink["'][^>]*>\s*([\d,.]+)\s*</g)].map(match => Number(match[1].replace(/\D/g, '')) || 0);
  return { items, total, linkedPages: Math.max(0, ...linked) };
}

async function fetchDetails(ids, fetchImpl) {
  if (!ids.length) return new Map();
  const body = new URLSearchParams({ itemcount: String(ids.length) });
  ids.forEach((id, index) => body.set(`publishedfileids[${index}]`, id));
  try {
    const response = await fetchImpl(DETAILS, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) return new Map();
    const data = await response.json();
    return new Map((data.response?.publishedfiledetails ?? [])
      .filter(entry => entry.result === 1)
      .map(entry => [String(entry.publishedfileid), entry]));
  } catch {
    return new Map();
  }
}

function merge(entry, details) {
  const more = details.get(entry.id);
  return {
    id: entry.id,
    name: entry.name || String(more?.title ?? '').trim(),
    author: entry.author,
    thumb: entry.thumb || more?.preview_url || '',
    rating: entry.rating,
    subscribers: Number(more?.subscriptions) || 0,
    size: Number(more?.file_size) || 0,
    updated: Number(more?.time_updated) || 0,
    tags: (more?.tags ?? []).map(tag => tag.tag).filter(Boolean).slice(0, 4),
  };
}

async function load({ query, page }, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(browseUrl({ query, page }), {
      headers: HEADERS,
      redirect: 'follow',
      cf: { cacheTtl: 600, cacheEverything: true },
    });
  } catch {
    throw new WorkshopError('Could not reach the Steam Workshop.', 502);
  }
  if (response.status === 429) {
    throw new WorkshopError('Steam is rate limiting Workshop searches. Wait a minute and try again.', 503, Number(response.headers?.get?.('retry-after')) || 60);
  }
  if (!response.ok) throw new WorkshopError(`The Steam Workshop answered with ${response.status}.`, 502);
  const html = await response.text();
  const parsed = parseBrowse(html);
  if (!parsed.items.length && (/agecheck/i.test(response.url ?? '') || /agegate|agecheck/i.test(html))) {
    throw new WorkshopError('Steam asked for an age check, so the Workshop list could not be loaded.', 502);
  }
  const details = await fetchDetails(parsed.items.map(item => item.id), fetchImpl);
  const items = parsed.items.map(entry => merge(entry, details)).filter(item => item.name);
  const pages = Math.min(MAX_PAGE, Math.max(page, parsed.total ? Math.ceil(parsed.total / PER_PAGE) : 0, parsed.linkedPages));
  return { items, page, pages, total: parsed.total };
}

const memory = new Map();
const pending = new Map();

const keyOf = ({ query, page }) => `${query.toLowerCase()}\u0000${page}`;

function remember(key, entry) {
  memory.delete(key);
  memory.set(key, entry);
  while (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value);
}

export function clearWorkshopCache() {
  memory.clear();
  pending.clear();
}

export function searchWorkshop(input, { fetchImpl = globalThis.fetch.bind(globalThis), now = Date.now } = {}) {
  const params = normalizeParams(input);
  const key = keyOf(params);
  const hit = memory.get(key);
  if (hit && hit.until > now()) return hit.error ? Promise.reject(hit.error) : Promise.resolve(hit.value);
  if (pending.has(key)) return pending.get(key);
  const run = load(params, fetchImpl)
    .then(
      value => {
        remember(key, { value, until: now() + TTL });
        return value;
      },
      error => {
        if (error instanceof WorkshopError && error.status === 503) remember(key, { error, until: now() + FAIL_TTL });
        throw error;
      },
    )
    .finally(() => pending.delete(key));
  pending.set(key, run);
  return run;
}

export async function workshopResponse(url, options) {
  const params = normalizeParams({ query: url.searchParams.get('q'), page: url.searchParams.get('page') });
  try {
    const body = await searchWorkshop(params, options);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': JSON_TYPE, 'Cache-Control': 'public, max-age=600' } });
  } catch (error) {
    const known = error instanceof WorkshopError;
    const headers = { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store' };
    if (known && error.retryAfter) headers['Retry-After'] = String(error.retryAfter);
    return new Response(JSON.stringify({ error: known ? error.message : 'Workshop search failed.' }), { status: known ? error.status : 502, headers });
  }
}

export async function onRequestGet({ request, waitUntil }) {
  const url = new URL(request.url);
  const params = normalizeParams({ query: url.searchParams.get('q'), page: url.searchParams.get('page') });
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`${url.origin}/api/workshop?q=${encodeURIComponent(params.query.toLowerCase())}&page=${params.page}`);
  const hit = await cache?.match(cacheKey);
  if (hit) return hit;
  const response = await workshopResponse(url);
  if (response.ok && cache) waitUntil?.(cache.put(cacheKey, response.clone()));
  return response;
}
