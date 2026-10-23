import test from 'node:test';
import assert from 'node:assert/strict';
import { browseUrl, parseBrowse, crawl, merge, describePage, sourceLink, searchLive, LISTS } from '../.tools/lib/workshop-crawl.mjs';
import { workshopResponse, normalizeParams } from '../functions/api/workshop.js';
import { workshop, PROVIDERS } from '../export/web/assets/js/custom-maps/providers.js';

const card = (id, title, author, rating = 5) => `<div class="workshopItem"><a data-panel="{&quot;focusable&quot;:false}" href="https://steamcommunity.com/sharedfiles/filedetails/?id=${id}&amp;searchtext=zombies" class="ugc" data-publishedfileid="${id}"><div class="workshopItemPreviewHolder  "><img class="workshopItemPreviewImage " src="https://images.steamusercontent.com/ugc/${id}/?imw=268&amp;imh=268&amp;ima=fit"></div><div class="workshopItemTitle ellipsis">${title}</div></a><div class="workshopItemAuthorName ellipsis">by&nbsp;<a class="workshop_author_link" href="https://steamcommunity.com/id/x/myworkshopfiles/">${author}</a></div><img class="fileRating" src="https://community.fastly.steamstatic.com/public/images/sharedfiles/${rating}-star_large.png"></div>`;

const listing = items => `<html><body><div class="workshopBrowsePagingInfo">1-30 of 3,572 entries</div><div class="workshopBrowseItems">${items.join('')}</div><div class="workshopBrowsePagingControls"><a class='pagelink' href="x&amp;p=2">2</a><a class='pagelink' href="x&amp;p=120">120</a></div></body></html>`;

const HTML = listing([card('1111111', 'Zombies &amp; Co', 'Ann'), card('2222222', 'Bunker Run', 'Bob', 3)]);

const SRC = id => `Source: https://github.com/Ann/zm_${id}`;
const DETAILS = [
  { publishedfileid: '1111111', result: 1, title: 'Fallback', subscriptions: 1500, file_size: '2097152', time_updated: 1700000000, tags: [{ tag: 'Map' }, { tag: 'Zombies' }], description: SRC('a') },
  ...['2222222', '3333333', '4444444'].map(id => ({ publishedfileid: id, result: 1, description: SRC(id) })),
];

function fakeSteam(pages) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).includes('GetPublishedFileDetails')) {
      const ids = [...new URLSearchParams(options.body).entries()].filter(([key]) => key.startsWith('publishedfileids')).map(([, id]) => id);
      return { ok: true, json: async () => ({ response: { publishedfiledetails: DETAILS.filter(entry => ids.includes(entry.publishedfileid)) } }) };
    }
    const query = new URL(url).searchParams;
    const reply = pages(query.get('browsesort'), Number(query.get('p')), calls.length);
    if (typeof reply === 'number') return { ok: false, status: reply, headers: new Headers({ 'retry-after': '7' }), text: async () => '' };
    return { ok: true, status: 200, text: async () => reply };
  };
  return { fetchImpl, calls };
}

test('browse URLs target Black Ops 3 and need no key', () => {
  const searched = new URL(browseUrl({ query: 'kino der', page: 3 }));
  assert.equal(searched.searchParams.get('appid'), '311210');
  assert.equal(searched.searchParams.get('searchtext'), 'kino der');
  assert.equal(searched.searchParams.get('browsesort'), 'textsearch');
  assert.equal(searched.searchParams.get('p'), '3');
  assert.ok(!searched.searchParams.has('key'));
  const popular = new URL(browseUrl({ page: 1 }));
  assert.deepEqual([popular.searchParams.get('browsesort'), popular.searchParams.get('days'), popular.searchParams.has('searchtext')], ['trend', '-1', false]);
  assert.equal(new URL(browseUrl({ sort: 'mostrecent' })).searchParams.get('browsesort'), 'mostrecent');
});

test('the browse page parser reads ids, titles, authors, art, rating and paging', () => {
  const parsed = parseBrowse(HTML);
  assert.deepEqual(parsed.items.map(item => [item.id, item.name, item.author, item.rating]), [['1111111', 'Zombies & Co', 'Ann', 5], ['2222222', 'Bunker Run', 'Bob', 3]]);
  assert.equal(parsed.items[0].thumb, 'https://images.steamusercontent.com/ugc/1111111/?imw=268&imh=268&ima=fit');
  assert.equal(parsed.total, 3572);
  assert.equal(parsed.linkedPages, 120);
  assert.deepEqual(parseBrowse('<html></html>').items, []);
});

test('the crawler merges lists, dedupes, adds public details and stops at an empty page', async () => {
  const { fetchImpl, calls } = fakeSteam((sort, page) => {
    if (sort === 'trend') return page === 1 ? HTML : page === 2 ? listing([card('3333333', 'Third', 'Cy')]) : listing([]);
    return listing([card('3333333', 'Third', 'Cy'), card('4444444', 'Fourth', 'Di')]);
  });
  const sleeps = [];
  const items = await crawl({ lists: [{ sort: 'trend', pages: 5 }, { sort: 'mostrecent', pages: 1 }], fetchImpl, sleep: async ms => sleeps.push(ms), delay: 5 });
  assert.deepEqual(items.map(item => item.id), ['1111111', '2222222', '3333333', '4444444']);
  assert.deepEqual([items[0].subscribers, items[0].size, items[0].tags], [1500, 2097152, ['Map', 'Zombies']]);
  assert.equal(items[1].subscribers, 0);
  assert.equal(calls.filter(url => url.includes('steamcommunity.com')).length, 4);
  assert.ok(calls.filter(url => url.includes('GetPublishedFileDetails')).length >= 1);
  assert.ok(sleeps.every(ms => ms === 5));
});

test('a rate limit waits for the Retry-After time, then carries on', async () => {
  const { fetchImpl } = fakeSteam((sort, page, call) => (call === 1 ? 429 : HTML));
  const sleeps = [];
  const items = await crawl({ lists: [{ sort: 'trend', pages: 1 }], fetchImpl, sleep: async ms => sleeps.push(ms) });
  assert.equal(items.length, 2);
  assert.equal(sleeps[0], 7000);
});

test('a Steam outage backs off, gives up on that list and keeps what it has', async () => {
  const { fetchImpl } = fakeSteam((sort, page) => (page === 1 ? HTML : 500));
  const sleeps = [];
  const log = [];
  const items = await crawl({ lists: [{ sort: 'trend', pages: 3 }], fetchImpl, sleep: async ms => sleeps.push(ms), delay: 1, log: message => log.push(message) });
  assert.equal(items.length, 2);
  assert.deepEqual(sleeps.filter(ms => ms > 1000), [7000, 7000, 7000, 7000]);
  assert.ok(log.some(message => /kept answering 500/.test(message)));
});

test('an age check page is reported and yields nothing', async () => {
  const { fetchImpl } = fakeSteam(() => '<html><body><div id="agegate">Please enter your birth date</div></body></html>');
  const log = [];
  const items = await crawl({ lists: [{ sort: 'trend', pages: 2 }], fetchImpl, sleep: async () => {}, log: message => log.push(message) });
  assert.deepEqual(items, []);
  assert.ok(log.some(message => /no items found/.test(message) && /agegate=1/.test(message)));
});

test('the parser still finds items when Steam changes its class names', () => {
  const html = `<html><body><div id="results">
    <div class="item"><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=5555555"><img src="https://images.steamusercontent.com/ugc/5555555/?x=1&amp;y=2" alt="Alt Title"></a><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=5555555">Anchor Title</a><span>By <a href="https://steamcommunity.com/id/zed/myworkshopfiles/?appid=311210">Zed</a></span></div>
    <div class="item"><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=6666666"><img data-src="https://images.steamusercontent.com/ugc/6666666/" src="blank.gif" alt="Only Alt"></a><span>By <a class="author_link" href="https://steamcommunity.com/profiles/76561198000000000/">Yan</a></span></div>
    </div><div>3,572 entries matching filters</div><a href="?appid=311210&amp;p=2">2</a></body></html>`;
  const parsed = parseBrowse(html);
  assert.deepEqual(parsed.items.map(item => [item.id, item.name, item.author, item.thumb]), [
    ['5555555', 'Anchor Title', 'Zed', 'https://images.steamusercontent.com/ugc/5555555/?x=1&y=2'],
    ['6666666', 'Only Alt', 'Yan', 'https://images.steamusercontent.com/ugc/6666666/'],
  ]);
  assert.deepEqual([parsed.total, parsed.linkedPages], [3572, 2]);
});

test('items from other games are dropped and missing details fall back to the page', () => {
  const entry = { id: '1', name: 'Scraped', author: 'A', thumb: 't', rating: 0 };
  assert.equal(merge(entry, new Map([['1', { consumer_app_id: 123 }]])), null);
  assert.equal(merge(entry, new Map([['1', { consumer_app_id: 311210, subscriptions: 5 }]])).subscribers, 5);
  assert.deepEqual([merge(entry, new Map()).name, merge({ ...entry, name: '' }, new Map([['1', { title: 'From details' }]])).name], ['Scraped', 'From details']);
});

test('the page report shows status, markers and the markup around the first item link', () => {
  const report = describePage('<html><head><title>Steam Workshop</title></head><body><div class="x"><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=1234567">hi</a></div></body></html>', 200, 'https://steamcommunity.com/workshop/browse/');
  assert.match(report, /status 200/);
  assert.match(report, /title: Steam Workshop/);
  assert.match(report, /filedetails=1/);
  assert.match(report, /sample: .*filedetails\/\?id=1234567/);
});

const INDEX = {
  appId: 311210,
  generated: '2026-10-18T06:17:00.000Z',
  items: [{ id: '999', name: 'No Source Map', author: 'Zed', tags: ['Map'] }, ...Array.from({ length: 130 }, (_, i) => ({ source: `https://github.com/Bob/zm_${i}`, updated: 1000 - i, id: String(1000000 + i), name: i === 0 ? 'Kino Remix' : `Map ${i}`, author: i === 0 ? 'Ann' : 'Bob', thumb: `img${i}`, subscribers: i === 0 ? 1500 : 0, size: i === 0 ? 2097152 : 0, tags: i === 0 ? ['Map', 'Zombies', 'Extra'] : ['Mod'] }))],
};

test('source links are read from Workshop descriptions', () => {
  assert.equal(sourceLink('Source: [url=https://github.com/MattFiler/zm_alien_isolation]repo[/url]'), 'https://github.com/MattFiler/zm_alien_isolation');
  assert.equal(sourceLink('https://github.com/Ann/zm_cheese/tree/dev. Enjoy!'), 'https://github.com/Ann/zm_cheese/tree/dev');
  assert.equal(sourceLink('map https://github.com/Ann/zm_cheese/blob/main/maps/zm_cheese.map and https://github.com/Ann/zm_cheese'), 'https://github.com/Ann/zm_cheese/blob/main/maps/zm_cheese.map');
  assert.equal(sourceLink('Follow me https://github.com/sponsors/Ann or https://steamcommunity.com/id/ann'), '');
  assert.equal(sourceLink(undefined), '');
  const entry = { id: '1', name: 'Cheese Tower', author: 'A', thumb: 't', rating: 0 };
  assert.equal(merge(entry, new Map([['1', { consumer_app_id: 311210, description: 'src https://github.com/Ann/zm_cheese' }]])).source, 'https://github.com/Ann/zm_cheese');
  assert.ok(!('source' in merge(entry, new Map([['1', { consumer_app_id: 311210, description: 'no link' }]]))));
});

test('the index crawl searches for cheese tower and a live search reads one page', async () => {
  assert.ok(LISTS.some(list => list.query === 'cheese tower'));
  const seen = [];
  const { fetchImpl } = fakeSteam((sort, page) => HTML);
  const wrapped = async (url, options) => { seen.push(String(url)); return fetchImpl(url, options); };
  await crawl({ lists: [{ query: 'cheese tower', pages: 1 }], fetchImpl: wrapped, sleep: async () => {} });
  assert.equal(new URL(seen[0]).searchParams.get('searchtext'), 'cheese tower');
  const live = await searchLive({ query: 'cheese tower', page: 1, fetchImpl, sleep: async () => {} });
  assert.deepEqual(live.items.map(item => item.id), ['1111111', '2222222']);
  assert.equal(live.pages, 20);
});

test('the live endpoint normalises input, caches, and backs off after a failure', async () => {
  assert.deepEqual(normalizeParams({ query: '  cheese   tower ', page: '3' }), { query: 'cheese tower', page: 3 });
  assert.deepEqual(normalizeParams({ query: 'x'.repeat(200), page: -4 }), { query: 'x'.repeat(80), page: 1 });
  let calls = 0;
  const search = async () => { calls++; return { items: [{ id: '9', name: 'Cheese Tower' }], pages: 1 }; };
  const url = new URL('http://localhost/api/workshop?q=cheese+tower&page=1');
  const first = await workshopResponse(url, { search, now: 1_000 });
  await workshopResponse(url, { search, now: 2_000 });
  assert.equal(first.status, 200);
  assert.equal(calls, 1);
  assert.equal((await first.json()).items[0].name, 'Cheese Tower');
  const failing = async () => { throw new Error('Steam kept answering 429.'); };
  const bad = await workshopResponse(new URL('http://localhost/api/workshop?q=other'), { search: failing, now: 10_000_000 });
  assert.equal(bad.status, 502);
  const blocked = await workshopResponse(new URL('http://localhost/api/workshop?q=another'), { search, now: 10_000_500 });
  assert.equal(blocked.status, 503);
});

test('the Workshop provider uses live Steam search, lists only maps with a source repo and loads them', async () => {
  const seen = [];
  const fetchImpl = async url => {
    seen.push(String(url));
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ pages: 2, items: [
      { id: '77', name: 'Cheese Tower', author: 'Ann', tags: ['Map'], subscribers: 2500, source: 'https://github.com/Ann/zm_cheese' },
      { id: '78', name: 'Cheese Tower Remix', author: 'Bob' },
    ] }) };
  };
  const result = await workshop.search({ query: 'cheese tower', fetchImpl });
  assert.match(seen[0], /\/api\/workshop\?q=cheese\+tower&page=1$/);
  assert.deepEqual(result.items.map(item => item.name), ['Cheese Tower']);
  assert.equal(result.next, 'live:2');
  assert.match(result.items[0].detail, /source on GitHub/);
  assert.deepEqual(workshop.play(result.items[0]), { source: 'iwmap', url: 'https://github.com/Ann/zm_cheese' });
  const second = await workshop.search({ query: 'cheese tower', cursor: 'live:2', fetchImpl });
  assert.match(seen[1], /page=2$/);
  assert.equal(second.items.some(item => item.id === 'steam-search'), false);
});

test('the Workshop provider reports a missing or empty list, then searches and pages the index', async () => {
  assert.ok(PROVIDERS.includes(workshop) && !workshop.needsToken);
  await assert.rejects(workshop.search({ fetchImpl: async () => ({ ok: false, status: 404 }) }), /failed \(404\)/);
  await assert.rejects(workshop.search({ fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }) }), /has not been generated/);
  const seen = [];
  const fetchImpl = async url => {
    seen.push(String(url));
    return { ok: true, json: async () => INDEX };
  };
  const first = await workshop.search({ fetchImpl });
  assert.match(seen[0], /\/maps\/workshop\/index\.json$/);
  assert.equal(first.items.length, 60);
  assert.equal(first.next, '60');
  assert.ok(first.items.every(item => item.repo), 'items without a source repo are never listed');
  assert.deepEqual([first.items[0].name, first.items[0].author, first.items[0].thumb, first.items[0].source], ['Kino Remix', 'Ann', 'img0', 'workshop']);
  assert.equal(first.items[0].detail, 'source on GitHub \u00b7 Map, Zombies \u00b7 1.5k subscribers \u00b7 2.0 MB');
  const third = await workshop.search({ cursor: '120', fetchImpl });
  assert.deepEqual([third.items.length, third.next], [10, null]);
  assert.equal(seen.length, 1);
  const found = await workshop.search({ query: ' zombies  KINO ', fetchImpl });
  assert.deepEqual(found.items.map(item => item.name), ['Kino Remix']);
  assert.deepEqual((await workshop.search({ query: 'no source map', fetchImpl })).items, []);
  assert.deepEqual(workshop.play({ id: '1000000' }), { external: 'https://steamcommunity.com/sharedfiles/filedetails/?id=1000000' });
});

test('crawl and live search keep only items that link a source, and direct .map links count', async () => {
  assert.equal(sourceLink('get it at https://cdn.example.com/maps/zm_tower.map now'), 'https://cdn.example.com/maps/zm_tower.map');
  const { fetchImpl } = fakeSteam(() => listing([card('1111111', 'Has Source', 'Ann'), card('5555555', 'No Source', 'Bob')]));
  const items = await crawl({ lists: [{ sort: 'trend', pages: 1 }], fetchImpl, sleep: async () => {} });
  assert.deepEqual(items.map(item => item.id), ['1111111']);
  const live = await searchLive({ query: 'zm', page: 1, scan: 2, fetchImpl, sleep: async () => {} });
  assert.deepEqual(live.items.map(item => item.id), ['1111111']);
  assert.ok(LISTS.reduce((sum, list) => sum + list.pages, 0) > 500, 'the index crawl reads far more than 30 items');
});

test('the crawl stops as soon as the item limit is reached', async () => {
  const { fetchImpl, calls } = fakeSteam(() => listing([card('1111111', 'A', 'Ann'), card('2222222', 'B', 'Bob'), card('3333333', 'C', 'Cy')]));
  const items = await crawl({ lists: [{ sort: 'trend', pages: 50 }, { query: 'zm', pages: 50 }], limit: 2, fetchImpl, sleep: async () => {} });
  assert.equal(items.length, 2);
  assert.equal(calls.filter(url => url.includes('steamcommunity.com')).length, 1);
});

test('a list is dropped after pages in a row without new source items, and skip hides duplicates', async () => {
  const { fetchImpl, calls } = fakeSteam((sort, page) => listing([card(String(7000000 + page), `P${page}`, 'Ann')]));
  const items = await crawl({ lists: [{ sort: 'trend', pages: 50 }], idlePages: 3, fetchImpl, sleep: async () => {} });
  assert.deepEqual(items, []);
  assert.equal(calls.filter(url => url.includes('steamcommunity.com')).length, 3);
  const { fetchImpl: again } = fakeSteam(() => HTML);
  const skipped = await crawl({ lists: [{ sort: 'trend', pages: 1 }], skip: item => item.id === '1111111', fetchImpl: again, sleep: async () => {} });
  assert.deepEqual(skipped.map(item => item.id), ['2222222']);
});
