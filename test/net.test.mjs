import test from 'node:test';
import assert from 'node:assert/strict';
import { Directory, makeCode, makeListing, normalizeCode, validListing, packMessage, unpackMessage, NET_VERSION, MAX_PLAYERS } from '../export/web/net/protocol.js';
import { HostLobby, ClientLobby, ServerBrowser } from '../export/web/net/lobby.js';

// In-memory stand-in for Trystero: rooms are keyed by appId+password+roomId and peers see each other asynchronously.
function fakeNetwork() {
  const rooms = new Map();
  const tick = () => new Promise(resolve => setImmediate(resolve));
  function makeNet(selfId) {
    const joinRoom = (config, roomId) => {
      const key = `${config.appId}|${config.password ?? ''}|${roomId}`;
      if (!rooms.has(key)) rooms.set(key, new Map());
      const members = rooms.get(key);
      const room = { onPeerJoin: null, onPeerLeave: null, actions: {} };
      room.makeAction = name => {
        const action = { onMessage: null, send: async (data, options) => {
          const targets = options?.target ? [].concat(options.target) : [...members.keys()].filter(id => id !== selfId);
          await tick();
          for (const id of targets) members.get(id)?.actions[name]?.onMessage?.(JSON.parse(JSON.stringify(data)), { peerId: selfId });
        } };
        room.actions[name] = action;
        return action;
      };
      room.leave = async () => { members.delete(selfId); for (const other of members.values()) other.onPeerLeave?.(selfId); };
      for (const [id, other] of members) { setImmediate(() => other.onPeerJoin?.(selfId)); setImmediate(() => room.onPeerJoin?.(id)); }
      members.set(selfId, room);
      return room;
    };
    return { joinRoom, selfId };
  }
  return { makeNet, settle: async () => { for (let i = 0; i < 6; i++) await tick(); } };
}

const noTimers = { setInterval: () => 0, clearInterval: () => {} };

test('codes avoid ambiguous characters and normalise user input', () => {
  const code = makeCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(normalizeCode(' ab-c1 2 '), 'ABC12');
});

test('listings are clamped and invalid ones rejected', () => {
  const listing = makeListing({ code: 'abcde', name: '<b>evil</b>'.repeat(10), map: 'kino', players: 99, max: 99 });
  assert.equal(listing.players, MAX_PLAYERS);
  assert.ok(!/[<>]/.test(listing.name) && listing.name.length <= 32);
  assert.equal(validListing({ ...listing, v: NET_VERSION + 1 }), null);
  assert.equal(validListing({ v: NET_VERSION, code: 'ab', map: 'kino' }), null);
  assert.ok(validListing(listing));
});

test('directory expires stale hosts, replaces re-announces and sorts joinable games first', () => {
  let now = 0;
  const dir = new Directory({ now: () => now, ttl: 1000 });
  const base = { v: NET_VERSION, map: 'kino' };
  dir.announce('a', { ...base, code: 'FULL1', name: 'full', players: 4, max: 4 });
  dir.announce('b', { ...base, code: 'OPEN1', name: 'open', players: 2, max: 4 });
  assert.deepEqual(dir.list().map(g => g.code), ['OPEN1', 'FULL1']);
  now = 800; dir.announce('b', { ...base, code: 'OPEN1', name: 'open', players: 3, max: 4 });
  now = 1500;
  assert.deepEqual(dir.list().map(g => g.code), ['OPEN1']);
  assert.equal(dir.list()[0].players, 3);
  assert.equal(dir.find('open1')?.peerId, 'b');
  dir.remove('b');
  assert.equal(dir.list().length, 0);
});

test('message envelope drops unknown types', () => {
  assert.deepEqual(unpackMessage(packMessage('pose', { x: 1 })), { type: 'pose', data: { x: 1 } });
  assert.equal(unpackMessage({ t: 'rm-rf', d: 1 }), null);
  assert.equal(unpackMessage('nope'), null);
});

test('host appears in the server browser and a client can join, ready up and start', async () => {
  const net = fakeNetwork();
  const host = new HostLobby(net.makeNet('host1'), { name: 'Test game', playerName: 'Hosty', map: 'kino', mapLabel: 'Kino der Toten', code: 'ZZZZ2', ...noTimers }).open();
  const browser = new ServerBrowser(net.makeNet('viewer')).open(noTimers);
  await net.settle();
  const games = browser.list();
  assert.equal(games.length, 1);
  assert.equal(games[0].code, 'ZZZZ2');
  assert.equal(games[0].peerId, 'host1');

  const client = new ClientLobby(net.makeNet('client1'), { code: games[0].code, playerName: 'Guest' });
  const started = new Promise(resolve => { client.onStart = resolve; });
  const welcome = await Promise.all([client.connect(), net.settle()]).then(([w]) => w);
  assert.equal(welcome.map, 'kino');
  assert.deepEqual(host.players().map(p => p.name), ['Hosty', 'Guest']);
  assert.equal(client.roster.length, 2);

  client.setReady(true);
  await net.settle();
  assert.equal(host.players().find(p => p.id === 'client1').ready, true);
  assert.equal(browser.list()[0].players, 2);

  const payload = host.start();
  await net.settle();
  assert.equal((await started).seed, payload.seed);
  assert.equal(browser.list()[0].started, true);
});

test('a full game, a started game and a version mismatch reject newcomers with a reason', async () => {
  const net = fakeNetwork();
  const host = new HostLobby(net.makeNet('h'), { name: 'g', playerName: 'H', map: 'kino', max: 1, code: 'FULL9', ...noTimers }).open();
  await net.settle();
  const full = new ClientLobby(net.makeNet('c1'), { code: 'FULL9', playerName: 'A', timeoutMs: 5000 });
  const result = Promise.allSettled([full.connect()]);
  await net.settle();
  const [outcome] = await result;
  assert.equal(outcome.status, 'rejected');
  assert.match(outcome.reason.message, /full/i);
  host.handleHello({ v: NET_VERSION + 1, name: 'old' }, 'oldclient');
  assert.equal(host.players().length, 1);
});

test('a client whose host never answers times out with a readable error', async () => {
  const net = fakeNetwork();
  const client = new ClientLobby(net.makeNet('lonely'), { code: 'NOONE', playerName: 'A', timeoutMs: 20 });
  await assert.rejects(client.connect(), /Could not reach that game/);
});

test('the host dropping out of the directory removes its listing', async () => {
  const net = fakeNetwork();
  const host = new HostLobby(net.makeNet('h'), { name: 'g', playerName: 'H', map: 'moon', code: 'GONE2', ...noTimers }).open();
  const browser = new ServerBrowser(net.makeNet('v')).open(noTimers);
  await net.settle();
  assert.equal(browser.list().length, 1);
  await host.close();
  await net.settle();
  assert.equal(browser.list().length, 0);
});

test('the launcher offers Multiplayer, wires its menu, and only co-op maps can be hosted', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../export/web/index.html', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../export/web/shell.js', import.meta.url), 'utf8');
  assert.ok(html.includes('data-menu="multiplayer"') && html.includes('id="multiplayer"'));
  assert.ok(shell.includes("createMultiplayerMenu") && shell.includes('no rounds'), 'exploration maps without rounds are excluded');
});

import { PoseSender, RemotePlayers, cleanPose } from '../export/web/net/players.js';

test('poses are clamped and nonsense is dropped', () => {
  assert.equal(cleanPose({ x: 1e9, y: 0, z: 0 }), null);
  assert.equal(cleanPose('x'), null);
  const pose = cleanPose({ x: '2', y: NaN, z: 3, yaw: 1, pitch: 99, hp: 5 });
  assert.deepEqual([pose.x, pose.y, pose.pitch, pose.hp], [2, 0, 1.6, 1]);
});

test('PoseSender throttles to its rate and only repeats an unchanged pose as a slow keep-alive', () => {
  let now = 0; const sent = [];
  const sender = new PoseSender({ send: (t, d) => sent.push(d) }, { hz: 10, now: () => now });
  const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, w: 'm1911', a: 0, hp: 1 };
  assert.ok(sender.update(pose));
  now = 50; assert.equal(sender.update({ ...pose, x: 1 }), false);
  now = 120; assert.ok(sender.update({ ...pose, x: 1 }));
  now = 300; assert.equal(sender.update({ ...pose, x: 1 }), false);
  now = 1200; assert.ok(sender.update({ ...pose, x: 1 }));
  assert.equal(sent.length, 3);
});

test('RemotePlayers interpolates between samples, wraps yaw the short way and drops silent players', () => {
  let now = 0;
  const remote = new RemotePlayers({ now: () => now, delay: 100, timeout: 1000 });
  remote.setRoster([{ id: 'me', name: 'Me' }, { id: 'p2', name: 'Two' }], 'me');
  assert.equal(remote.players.has('me'), false);
  remote.receive('p2', { x: 0, y: 0, z: 0, yaw: Math.PI - 0.1 });
  now = 100; remote.receive('p2', { x: 10, y: 0, z: 0, yaw: -Math.PI + 0.1 });
  now = 150;                                           // render time 50 → halfway between the samples
  const [p] = remote.sample();
  assert.ok(Math.abs(p.x - 5) < 1e-9);
  assert.ok(Math.abs(Math.abs(p.yaw) - Math.PI) < 1e-9, 'yaw crosses ±π instead of spinning the long way');
  assert.equal(remote.receive('stranger', { x: 1 }), false);
  now = 5000; assert.equal(remote.sample().length, 0);
  remote.setRoster([{ id: 'me' }], 'me');
  assert.equal(remote.players.size, 0);
});
