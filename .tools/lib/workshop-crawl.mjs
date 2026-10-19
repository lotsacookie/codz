export const APP_ID = 311210;
export const PER_PAGE = 30;
export const LISTS = [
  { sort: 'trend', pages: 30 },
  { sort: 'mostrecent', pages: 20 },
];

const BROWSE = 'https://steamcommunity.com/workshop/browse/';
const DETAILS = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};
const DETAIL_BATCH = 50;

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

const stripCode = html => String(html ?? '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');

export function browseUrl({ query = '', page = 1, sort = 'trend' } = {}) {
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
  } else if (sort === 'mostrecent') {
    params.set('browsesort', 'mostrecent');
    params.set('actualsort', 'mostrecent');
  } else {
    params.set('browsesort', 'trend');
    params.set('actualsort', 'trend');
    params.set('days', '-1');
  }
  return `${BROWSE}?${params}`;
}

function titleOf(block, imageTag) {
  const byClass = plain(first(block, /class=["'][^"']*workshopItemTitle[^"']*["'][^>]*>([\s\S]*?)<\/div>/));
  if (byClass) return byClass;
  for (const anchor of block.matchAll(/<a\b[^>]*filedetails\/\?id=\d+[^>]*>([\s\S]*?)<\/a>/g)) {
    const text = plain(anchor[1].replace(/<img\b[^>]*>/g, ' '));
    if (text) return text;
  }
  const alt = decode(first(imageTag, /\salt=["']([^"']+)["']/) ?? '').trim();
  if (alt) return alt;
  return decode(first(block, /<a\b[^>]*\stitle=["']([^"']+)["'][^>]*filedetails/) ?? first(block, /<a\b[^>]*filedetails[^>]*\stitle=["']([^"']+)["']/) ?? '').trim();
}

function authorOf(block) {
  const byClass = plain(first(block, /class=["'][^"']*workshopItemAuthorName[^"']*["'][^>]*>([\s\S]*?)<\/div>/));
  if (byClass) return byClass.replace(/^by\s+/i, '');
  const link = /<a\b[^>]*(?:class=["'][^"']*author[^"']*["']|href=["'][^"']*\/myworkshopfiles)[^>]*>([\s\S]*?)<\/a>/i.exec(block);
  return plain(link?.[1]).replace(/^by\s+/i, '');
}

function imageOf(block) {
  const tags = [...block.matchAll(/<img\b[^>]*>/gi)].map(match => match[0]);
  return tags.find(tag => /workshopItemPreviewImage/.test(tag)) ?? tags.find(tag => /steamusercontent|\/ugc\//.test(tag)) ?? '';
}

export function parseBrowse(html) {
  const text = String(html ?? '');
  const marks = [];
  const seen = new Set();
  for (const match of text.matchAll(/(?:data-publishedfileid=["']|sharedfiles\/filedetails\/\?id=)(\d{3,})/g)) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    marks.push({ id: match[1], at: Math.max(0, text.lastIndexOf('<', match.index)) });
  }
  const items = marks.slice(0, PER_PAGE).map((mark, index) => {
    const block = text.slice(mark.at, Math.min(marks[index + 1]?.at ?? text.length, mark.at + 6000));
    const imageTag = imageOf(block);
    return {
      id: mark.id,
      name: titleOf(block, imageTag),
      author: authorOf(block),
      thumb: decode(first(imageTag, /\sdata-src=["']([^"']+)["']/) ?? first(imageTag, /\ssrc=["']([^"']+)["']/) ?? ''),
      rating: Number(first(block, /\/(\d)-star/)) || 0,
    };
  });
  const total = Number((first(plain(stripCode(text)), /(\d[\d.,]*)\s+entries/i) ?? '').replace(/\D/g, '')) || 0;
  const linked = [...text.matchAll(/(?:\?|&amp;|&)p=(\d{1,5})(?!\d)/g)].map(match => Number(match[1]));
  return { items, total, linkedPages: Math.max(0, ...linked) };
}

export function describePage(html, status, url) {
  const source = String(html ?? '');
  const count = pattern => (source.match(pattern) ?? []).length;
  const at = source.search(/filedetails/i);
  const sample = at >= 0
    ? source.slice(Math.max(0, source.lastIndexOf('<', at) - 200), at + 1800)
    : plain(stripCode(source)).slice(0, 600);
  return [
    `status ${status}, ${source.length} characters, final URL ${url ?? '(unknown)'}`,
    `title: ${plain(first(source, /<title[^>]*>([\s\S]*?)<\/title>/)) || '(none)'}`,
    `markers: filedetails=${count(/filedetails/gi)} publishedfileid=${count(/publishedfileid/gi)} workshopItem=${count(/workshopItem/g)} agegate=${count(/agegate|agecheck/gi)}`,
    `sample: ${sample.replace(/\s+/g, ' ')}`,
  ].join('\n');
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getPage(url, { fetchImpl, sleep, retries = 4 }) {
  for (let attempt = 0; ; attempt++) {
    let response = null;
    try {
      response = await fetchImpl(url, { headers: HEADERS, redirect: 'follow' });
    } catch (error) {
      if (attempt >= retries) throw new Error(`Could not reach Steam (${error?.message ?? error}).`);
    }
    if (response?.ok) return { html: await response.text(), status: response.status, url: response.url };
    if (response && response.status !== 429 && response.status < 500) throw new Error(`Steam answered ${response.status}.`);
    if (attempt >= retries) throw new Error(`Steam kept answering ${response?.status ?? 'with errors'}.`);
    await sleep((Number(response?.headers?.get?.('retry-after')) || 15 * 2 ** attempt) * 1000);
  }
}

async function fetchDetails(ids, { fetchImpl, sleep }) {
  const map = new Map();
  for (let at = 0; at < ids.length; at += DETAIL_BATCH) {
    const batch = ids.slice(at, at + DETAIL_BATCH);
    const body = new URLSearchParams({ itemcount: String(batch.length) });
    batch.forEach((id, index) => body.set(`publishedfileids[${index}]`, id));
    try {
      const response = await fetchImpl(DETAILS, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (response.ok) {
        const data = await response.json();
        for (const entry of data.response?.publishedfiledetails ?? []) if (entry.result === 1) map.set(String(entry.publishedfileid), entry);
      }
    } catch {}
    if (at + DETAIL_BATCH < ids.length) await sleep(1000);
  }
  return map;
}

export function merge(entry, details) {
  const more = details.get(entry.id);
  const app = Number(more?.consumer_app_id);
  if (app && app !== APP_ID) return null;
  return {
    id: entry.id,
    name: entry.name || String(more?.title ?? '').trim(),
    author: entry.author,
    thumb: entry.thumb || more?.preview_url || '',
    rating: entry.rating,
    subscribers: Number(more?.subscriptions) || 0,
    size: Number(more?.file_size) || 0,
    updated: Number(more?.time_updated) || 0,
    tags: (more?.tags ?? []).map(tag => tag.tag).filter(Boolean).slice(0, 6),
  };
}

export async function crawl({
  lists = LISTS,
  fetchImpl = globalThis.fetch.bind(globalThis),
  sleep = defaultSleep,
  delay = 2000,
  log = () => {},
  dump = () => {},
} = {}) {
  const found = new Map();
  const tools = { fetchImpl, sleep };
  for (const list of lists) {
    for (let page = 1; page <= list.pages; page++) {
      let result;
      try {
        result = await getPage(browseUrl({ sort: list.sort, page }), tools);
      } catch (error) {
        log(`${list.sort} page ${page}: ${error.message}`);
        break;
      }
      const parsed = parseBrowse(result.html);
      if (!parsed.items.length) {
        log(`${list.sort} page ${page}: no items found.\n${describePage(result.html, result.status, result.url)}`);
        dump({ sort: list.sort, page, html: result.html });
        break;
      }
      const fresh = parsed.items.filter(item => !found.has(item.id));
      for (const item of fresh) found.set(item.id, item);
      log(`${list.sort} page ${page}: ${parsed.items.length} items, ${fresh.length} new, ${found.size} unique`);
      if (!fresh.length || (parsed.linkedPages && page >= parsed.linkedPages)) break;
      await sleep(delay);
    }
  }
  const details = await fetchDetails([...found.keys()], tools);
  return [...found.values()].map(entry => merge(entry, details)).filter(item => item?.name);
}
