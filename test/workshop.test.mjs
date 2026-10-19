import test from 'node:test';
import assert from 'node:assert/strict';
import { browseUrl, parseBrowse, searchWorkshop, clearWorkshopCache, normalizeParams, workshopResponse, WorkshopError } from '../functions/api/workshop.js';
import { workshop, PROVIDERS } from '../export/web/custom-maps/providers.js';

const card = (id, title, author, rating = 5) => `<div class="workshopItem"><a data-panel="{&quot;focusable&quot;:false}" href="https://steamcommunity.com/sharedfiles/filedetails/?id=${id}&amp;searchtext=zombies" class="ugc" data-publishedfileid="${id}"><div class="workshopItemPreviewHolder  "><img class="workshopItemPreviewImage " src="https://images.steamusercontent.com/ugc/${id}/?imw=268&amp;imh=268&amp;ima=fit"></div><div class="workshopItemTitle ellipsis">${title}</div></a><div class="workshopItemAuthorName ellipsis">by&nbsp;<a class="workshop_author_link" href="https://steamcommunity.com/id/x/myworkshopfiles/">${author}</a></div><img class="fileRating" src="https://community.fastly.steamstatic.com/public/images/sharedfiles/${rating}-star_large.png"></div>`;

const listing = items => `<html><body><div class="workshopBrowsePagingInfo">1-18 of 3,572 entries</div><div class="workshopBrowseItems">${items.join('')}</div><div class="workshopBrowsePagingControls"><a class='pagelink' href="x&amp;p=2">2</a><a class='pagelink' href="x&amp;p=199">199</a></div></body></html>`;

const HTML = listing([card('1111111', 'Zombies &amp; Co', 'Ann'), card('2222222', 'Bunker Run', 'Bob', 3)]);

function fakeSteam({ html = HTML, details = [], browseStatus = 200, detailsFail = false } = {}) {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes('GetPublishedFileDetails')) {
      if (detailsFail) throw new Error('offline');
      return { ok: true, json: async () => ({ response: { publishedfiledetails: details } }) };
    }
    if (browseStatus !== 200) return { ok: false, status: browseStatus, headers: new Headers({ 'retry-after': '30' }), text: async () => '' };
    return { ok: true, status: 200, url: String(url), text: async () => html };
  };
  return { fetchImpl, calls };
}

const DETAILS = [{ publishedfileid: '1111111', result: 1, title: 'Fallback', subscriptions: 1500, file_size: '2097152', time_updated: 1700000000, tags: [{ tag: 'Map' }, { tag: 'Zombies' }] }];

test('browse URLs target Black Ops 3 and need no key', () => {
  const searched = new URL(browseUrl({ query: 'kino der', page: 3 }));
  assert.equal(searched.searchParams.get('appid'), '311210');
  assert.equal(searched.searchParams.get('searchtext'), 'kino der');
  assert.equal(searched.searchParams.get('browsesort'), 'textsearch');
  assert.equal(searched.searchParams.get('p'), '3');
  assert.ok(!searched.searchParams.has('key'));
  const popular = new URL(browseUrl({ page: 1 }));
  assert.deepEqual([popular.searchParams.get('browsesort'), popular.searchParams.get('days'), popular.searchParams.has('searchtext')], ['trend', '-1', false]);
  assert.deepEqual(normalizeParams({ query: '  a   b ', page: '9999' }), { query: 'a b', page: 500 });
  assert.deepEqual(normalizeParams({ query: null, page: 'x' }), { query: '', page: 1 });
});

test('the browse page parser reads ids, titles, authors, art, rating and paging', () => {
  const parsed = parseBrowse(HTML);
  assert.deepEqual(parsed.items.map(item => [item.id, item.name, item.author, item.rating]), [['1111111', 'Zombies & Co', 'Ann', 5], ['2222222', 'Bunker Run', 'Bob', 3]]);
  assert.equal(parsed.items[0].thumb, 'https://images.steamusercontent.com/ugc/1111111/?imw=268&imh=268&ima=fit');
  assert.equal(parsed.total, 3572);
  assert.equal(parsed.linkedPages, 199);
  assert.deepEqual(parseBrowse('<html></html>').items, []);
});

test('searches merge public file details, page, and are served from cache the second time', async () => {
  clearWorkshopCache();
  const { fetchImpl, calls } = fakeSteam({ details: DETAILS });
  const result = await searchWorkshop({ query: 'zombies', page: 1 }, { fetchImpl });
  assert.equal(result.pages, 199);
  assert.equal(result.total, 3572);
  assert.deepEqual([result.items[0].subscribers, result.items[0].size, result.items[0].tags], [1500, 2097152, ['Map', 'Zombies']]);
  assert.equal(result.items[1].subscribers, 0);
  assert.equal(calls.length, 2);
  await searchWorkshop({ query: 'ZOMBIES', page: 1 }, { fetchImpl });
  assert.equal(calls.length, 2);
  await Promise.all([searchWorkshop({ query: 'other' }, { fetchImpl }), searchWorkshop({ query: 'other' }, { fetchImpl })]);
  assert.equal(calls.length, 4);
});

test('a failed details lookup still returns the scraped results', async () => {
  clearWorkshopCache();
  const { fetchImpl } = fakeSteam({ detailsFail: true });
  const result = await searchWorkshop({ query: 'zombies' }, { fetchImpl });
  assert.deepEqual(result.items.map(item => item.name), ['Zombies & Co', 'Bunker Run']);
});

test('a rate limit is reported once and not hammered again for a minute', async () => {
  clearWorkshopCache();
  let clock = 0;
  const limited = fakeSteam({ browseStatus: 429 });
  await assert.rejects(searchWorkshop({ query: 'zombies' }, { fetchImpl: limited.fetchImpl, now: () => clock }), error => error instanceof WorkshopError && error.status === 503 && error.retryAfter === 30);
  await assert.rejects(searchWorkshop({ query: 'zombies' }, { fetchImpl: limited.fetchImpl, now: () => clock }), WorkshopError);
  assert.equal(limited.calls.length, 1);
  clock = 61000;
  const healthy = fakeSteam();
  assert.equal((await searchWorkshop({ query: 'zombies' }, { fetchImpl: healthy.fetchImpl, now: () => clock })).items.length, 2);
});

test('an age check page becomes a readable error', async () => {
  clearWorkshopCache();
  const { fetchImpl } = fakeSteam({ html: '<html><body><div id="agegate">Please enter your birth date</div></body></html>' });
  await assert.rejects(searchWorkshop({ query: 'zombies' }, { fetchImpl }), /age check/);
});

test('the endpoint answers JSON with cache headers, and errors without caching', async () => {
  clearWorkshopCache();
  const ok = await workshopResponse(new URL('http://x.test/api/workshop?q=zombies&page=1'), { fetchImpl: fakeSteam().fetchImpl });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('cache-control'), /max-age=600/);
  assert.equal((await ok.json()).items.length, 2);
  clearWorkshopCache();
  const limited = await workshopResponse(new URL('http://x.test/api/workshop?q=zombies'), { fetchImpl: fakeSteam({ browseStatus: 429 }).fetchImpl });
  assert.deepEqual([limited.status, limited.headers.get('cache-control'), limited.headers.get('retry-after')], [503, 'no-store', '30']);
  assert.match((await limited.json()).error, /rate limiting/);
});

test('the Workshop provider lists maps, pages through results and opens the Steam page', async () => {
  assert.ok(PROVIDERS.includes(workshop) && !workshop.needsToken);
  const seen = [];
  const body = { items: [{ id: '1111111', name: 'Zombies & Co', author: 'Ann', thumb: 'img', subscribers: 1500, size: 2097152, tags: ['Map', 'Zombies', 'Extra'] }], page: 1, pages: 2 };
  const fetchImpl = async url => {
    seen.push(String(url));
    return { ok: true, json: async () => body };
  };
  const first = await workshop.search({ query: ' kino ', fetchImpl });
  assert.match(seen[0], /\/api\/workshop\?q=kino&page=1$/);
  assert.deepEqual([first.items[0].name, first.items[0].author, first.items[0].thumb, first.next], ['Zombies & Co', 'Ann', 'img', '2']);
  assert.equal(first.items[0].detail, 'Map, Zombies · 1.5k subscribers · 2.0 MB');
  const last = await workshop.search({ query: 'kino', cursor: '2', fetchImpl });
  assert.equal(last.next, null);
  assert.deepEqual(workshop.play({ id: '1111111' }), { external: 'https://steamcommunity.com/sharedfiles/filedetails/?id=1111111' });
  await assert.rejects(workshop.search({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: 'Slow down.' }) }) }), /Slow down\./);
  await assert.rejects(workshop.search({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => { throw new Error('bad'); } }) }), /failed \(500\)/);
});
