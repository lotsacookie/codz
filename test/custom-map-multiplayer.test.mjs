import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCustomMap, inferMapSource, makeListing, CUSTOM_MAP_ID } from '../export/web/net/protocol.js';
import { listBuiltinBsp, builtinBspUrl, builtinBspMap } from '../export/web/custom-maps/providers.js';
import { HostLobby, ClientLobby } from '../export/web/net/lobby.js';

// Same in-memory Trystero stand-in as net.test.mjs, trimmed to what a host and one client need.
function fakeNetwork() {
  const rooms = new Map();
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const makeNet = selfId => ({
    selfId,
    joinRoom: (config, roomId) => {
      const key = `${config.appId}|${config.password ?? ''}|${roomId}`;
      if (!rooms.has(key)) rooms.set(key, new Map());
      const members = rooms.get(key), room = { actions: {} };
      room.makeAction = name => {
        const action = { onMessage: null, send: async (data, options) => {
          const targets = options?.target ? [].concat(options.target) : [...members.keys()].filter(id => id !== selfId);
          await tick();
          for (const id of targets) members.get(id)?.actions[name]?.onMessage?.(JSON.parse(JSON.stringify(data)), { peerId: selfId });
        } };
        room.actions[name] = action;
        return action;
      };
      room.leave = async () => { members.delete(selfId); };
      for (const [id, other] of members) { setImmediate(() => other.onPeerJoin?.(selfId)); setImmediate(() => room.onPeerJoin?.(id)); }
      members.set(selfId, room);
      return room;
    },
  });
  return { makeNet, settle: async () => { for (let i = 0; i < 6; i++) await tick(); } };
}
const noTimers = { setInterval: () => 0, clearInterval: () => {} };

test('map links are matched to the right loader', () => {
  assert.equal(inferMapSource('https://example.com/maps/zombie.bsp'), 'bsp');
  assert.equal(inferMapSource('https://example.com/a/level.map?raw=1'), 'iwmap');
  assert.equal(inferMapSource('https://github.com/someone/their-map'), 'iwmap');
  assert.equal(inferMapSource('https://example.com/scene.glb'), 'url');
  assert.equal(inferMapSource('https://example.com/readme.txt'), null);
  assert.equal(inferMapSource('ftp://example.com/a.bsp'), null);
});

test('shared custom maps only accept plain http(s) links and clamp the label', () => {
  assert.deepEqual(cleanCustomMap({ url: ' https://example.com/a.glb ', label: '<b>Big</b> arena'.repeat(10) }).source, 'url');
  assert.ok(cleanCustomMap({ url: 'https://example.com/a.glb', label: 'x'.repeat(200) }).label.length <= 40);
  assert.ok(!/[<>]/.test(cleanCustomMap({ url: 'https://example.com/a.glb', label: '<b>Big</b>' }).label));
  assert.equal(cleanCustomMap({ url: 'javascript:alert(1)//.glb' }), null);
  assert.equal(cleanCustomMap({ url: 'https://example.com/a b.glb' }), null);
  assert.equal(cleanCustomMap({ url: 'https://example.com/a.glb"onload=x' }), null);
  assert.equal(cleanCustomMap({ url: `https://example.com/${'a'.repeat(600)}.glb` }), null);
  assert.equal(cleanCustomMap(null), null);
  assert.equal(cleanCustomMap('https://example.com/a.glb'), null);
});

test('a listing marks custom maps', () => {
  assert.equal(makeListing({ code: 'ABCDE', map: CUSTOM_MAP_ID, custom: true }).custom, true);
  assert.equal(makeListing({ code: 'ABCDE', map: 'kino' }).custom, false);
});

test('the host shares its custom map with joiners in the welcome and the start message', async () => {
  const network = fakeNetwork();
  const host = new HostLobby(network.makeNet('host'), { name: 'Arena', playerName: 'Ann', map: 'kino', mapLabel: 'Kino', customMap: { url: 'https://example.com/arena.bsp', label: 'Arena' }, code: 'ABCDE', ...noTimers }).open();
  assert.equal(host.info.map, CUSTOM_MAP_ID);
  assert.equal(host.listing().custom, true);
  assert.equal(host.listing().mapLabel, 'Arena');

  const client = new ClientLobby(network.makeNet('guest'), { code: 'ABCDE', playerName: 'Bo' });
  const started = new Promise(resolve => { client.onStart = resolve; });
  const joining = client.connect();
  await network.settle();
  const welcome = await joining;
  assert.deepEqual(welcome.customMap, { source: 'bsp', url: 'https://example.com/arena.bsp', label: 'Arena' });

  host.start();
  await network.settle();
  const payload = await started;
  assert.equal(payload.map, CUSTOM_MAP_ID);
  assert.deepEqual(payload.customMap, { source: 'bsp', url: 'https://example.com/arena.bsp', label: 'Arena' });
  await host.close(); await client.close();
});

test('a host that sends an unsafe map link gets it dropped by joiners', async () => {
  const network = fakeNetwork();
  const host = new HostLobby(network.makeNet('host'), { name: 'Bad', playerName: 'Ann', map: 'kino', mapLabel: 'Kino', code: 'ABCDE', ...noTimers }).open();
  host.customMap = { source: 'url', url: 'javascript:alert(1)', label: 'x' };   // bypass the host-side clean on purpose
  const client = new ClientLobby(network.makeNet('guest'), { code: 'ABCDE', playerName: 'Bo' });
  const joining = client.connect();
  await network.settle();
  assert.equal((await joining).customMap, null);
  await host.close(); await client.close();
});

test('normal maps still start without a custom map', async () => {
  const network = fakeNetwork();
  const host = new HostLobby(network.makeNet('host'), { name: 'Kino', playerName: 'Ann', map: 'kino', mapLabel: 'Kino', code: 'ABCDE', ...noTimers }).open();
  const client = new ClientLobby(network.makeNet('guest'), { code: 'ABCDE', playerName: 'Bo' });
  const started = new Promise(resolve => { client.onStart = resolve; });
  const joining = client.connect();
  await network.settle(); await joining;
  host.start(); await network.settle();
  const payload = await started;
  assert.equal(payload.map, 'kino');
  assert.equal(payload.customMap, null);
  await host.close(); await client.close();
});

test('built-in maps are shared by id and unsafe ids are dropped', () => {
  assert.deepEqual(cleanCustomMap({ builtin: '4all', label: 'F4ll' }), { source: 'bsp', builtin: '4all', label: 'F4ll' });
  assert.equal(cleanCustomMap({ builtin: '../etc/passwd' }), null);
  assert.equal(cleanCustomMap({ builtin: '<b>' }), null);
  assert.equal(cleanCustomMap({ builtin: 'a'.repeat(60) }), null);
});

test('the built-in list is read across pages and ids resolve to this client\'s own copy', async () => {
  const maps = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, title: `Map ${i}`, file: `m${i}.bsp`, size: 1000 }));
  const fetchImpl = async () => ({ ok: true, json: async () => ({ maps }) });
  const list = await listBuiltinBsp({ fetchImpl });
  assert.equal(list.length, 30);
  assert.match(await builtinBspUrl('m29', { fetchImpl }), /maps\/bsp\/m29\.bsp$/);
  assert.equal(await builtinBspUrl('nope', { fetchImpl }), null);
});

test('a built-in map reaches joiners as an id, not a host URL', async () => {
  const network = fakeNetwork();
  const host = new HostLobby(network.makeNet('host'), { name: 'F4ll', playerName: 'Ann', map: 'kino', mapLabel: 'Kino', customMap: { builtin: '4all', label: 'F4ll' }, code: 'ABCDE', ...noTimers }).open();
  const client = new ClientLobby(network.makeNet('guest'), { code: 'ABCDE', playerName: 'Bo' });
  const started = new Promise(resolve => { client.onStart = resolve; });
  const joining = client.connect();
  await network.settle(); await joining;
  host.start(); await network.settle();
  assert.deepEqual((await started).customMap, { source: 'bsp', builtin: '4all', label: 'F4ll' });
  await host.close(); await client.close();
});

test('a built-in map resolves with its own art for the loading screen, and without it when it has none', async () => {
  const maps = [{ id: 'a', title: 'A', file: 'a.bsp', art: 'art/bsp/a.png' }, { id: 'b', title: 'B', file: 'b.bsp' }];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ maps }) });
  const a = await builtinBspMap('a', { fetchImpl }), b = await builtinBspMap('b', { fetchImpl });
  assert.match(a.art, /art\/bsp\/a\.png$/);
  assert.match(a.url, /maps\/bsp\/a\.bsp$/);
  assert.equal(b.art, '', 'the shell falls back to the default loading art');
  assert.equal(await builtinBspMap('zzz', { fetchImpl }), null);
});
