import test from 'node:test';
import assert from 'node:assert/strict';
import { browseUrl, parseBrowse, crawl } from '../.tools/lib/workshop-crawl.mjs';
import { workshop, PROVIDERS } from '../export/web/custom-maps/providers.js';

const card = (id, title, author, rating = 5) => `<div class="workshopItem"><a data-panel="{&quot;focusable&quot;:false}" href="https://steamcommunity.com/sharedfiles/filedetails/?id=${id}&amp;searchtext=zombies" class="ugc" data-publishedfileid="${id}"><div class="workshopItemPreviewHolder  "><img class="workshopItemPreviewImage " src="https://images.steamusercontent.com/ugc/${id}/?imw=268&amp;imh=268&amp;ima=fit"></div><div class="workshopItemTitle ellipsis">${title}</div></a><div class="workshopItemAuthorName ellipsis">by&nbsp;<a class="workshop_author_link" href="https://steamcommunity.com/id/x/myworkshopfiles/">${author}</a></div><img class="fileRating" src="https://community.fastly.steamstatic.com/public/images/sharedfiles/${rating}-star_large.png"></div>`;

const listing = items => `<html><body><div class="workshopBrowsePagingInfo">1-30 of 3,572 entries</div><div class="workshopBrowseItems">${items.join('')}</div><div class="workshopBrowsePagingControls"><a class='pagelink' href="x&amp;p=2">2</a><a class='pagelink' href="x&amp;p=120">120</a></div></body></html>`;

const HTML = listing([card('1111111', 'Zombies &amp; Co', 'Ann'), card('2222222', 'Bunker Run', 'Bob', 3)]);

const DETAILS = [{ publishedfileid: '1111111', result: 1, title: 'Fallback', subscriptions: 1500, file_size: '2097152', time_updated: 1700000000, tags: [{ tag: 'Map' }, { tag: 'Zombies' }] }];

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
  assert.equal(calls.filter(url => url.includes('GetPublishedFileDetails')).length, 1);
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
  assert.ok(log.some(message => /age check/.test(message)));
});

const INDEX = {
  appId: 311210,
  generated: '2026-10-18T06:17:00.000Z',
  items: Array.from({ length: 15 }, (_, i) => ({ id: String(1000000 + i), name: i === 0 ? 'Kino Remix' : `Map ${i}`, author: i === 0 ? 'Ann' : 'Bob', thumb: `img${i}`, subscribers: i === 0 ? 1500 : 0, size: i === 0 ? 2097152 : 0, tags: i === 0 ? ['Map', 'Zombies', 'Extra'] : ['Mod'] })),
};

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
  assert.equal(first.items.length, 12);
  assert.equal(first.next, '12');
  assert.deepEqual([first.items[0].name, first.items[0].author, first.items[0].thumb, first.items[0].source], ['Kino Remix', 'Ann', 'img0', 'workshop']);
  assert.equal(first.items[0].detail, 'Map, Zombies · 1.5k subscribers · 2.0 MB');
  const second = await workshop.search({ cursor: '12', fetchImpl });
  assert.deepEqual([second.items.length, second.next], [3, null]);
  assert.equal(seen.length, 1);
  const found = await workshop.search({ query: ' zombies  KINO ', fetchImpl });
  assert.deepEqual(found.items.map(item => item.name), ['Kino Remix']);
  assert.deepEqual((await workshop.search({ query: 'nothing here', fetchImpl })).items, []);
  assert.deepEqual(workshop.play({ id: '1000000' }), { external: 'https://steamcommunity.com/sharedfiles/filedetails/?id=1000000' });
});
