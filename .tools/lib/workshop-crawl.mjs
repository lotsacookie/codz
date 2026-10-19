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
  }).filter(item => item.name);
  const info = plain(first(text, /class=["'][^"']*workshopBrowsePagingInfo[^"']*["'][^>]*>([\s\S]*?)<\/div>/));
  const total = Number((first(info, /of\s+([\d.,\s]+?)\s*entries/i) ?? '').replace(/\D/g, '')) || 0;
  const linked = [...text.matchAll(/class=["']pagelink["'][^>]*>\s*([\d,.]+)\s*</g)].map(match => Number(match[1].replace(/\D/g, '')) || 0);
  return { items, total, linkedPages: Math.max(0, ...linked) };
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getText(url, { fetchImpl, sleep, retries = 4 }) {
  for (let attempt = 0; ; attempt++) {
    let response = null;
    try {
      response = await fetchImpl(url, { headers: HEADERS, redirect: 'follow' });
    } catch (error) {
      if (attempt >= retries) throw new Error(`Could not reach Steam (${error?.message ?? error}).`);
    }
    if (response?.ok) return response.text();
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
} = {}) {
  const found = new Map();
  const tools = { fetchImpl, sleep };
  for (const list of lists) {
    for (let page = 1; page <= list.pages; page++) {
      let html;
      try {
        html = await getText(browseUrl({ sort: list.sort, page }), tools);
      } catch (error) {
        log(`${list.sort} page ${page}: ${error.message}`);
        break;
      }
      const parsed = parseBrowse(html);
      if (!parsed.items.length) {
        log(/agegate|agecheck/i.test(html) ? `${list.sort} page ${page}: Steam asked for an age check.` : `${list.sort} page ${page}: no items found.`);
        break;
      }
      for (const item of parsed.items) if (!found.has(item.id)) found.set(item.id, item);
      log(`${list.sort} page ${page}: ${parsed.items.length} items, ${found.size} unique`);
      if (parsed.linkedPages && page >= parsed.linkedPages) break;
      await sleep(delay);
    }
  }
  const details = await fetchDetails([...found.keys()], tools);
  return [...found.values()].map(entry => merge(entry, details)).filter(item => item.name);
}
