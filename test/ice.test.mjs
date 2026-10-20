import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { EXTRA_STUN_URLS, RELAY_REDUNDANCY, TURN_HOST, TURN_SECRET, buildIce, buildTurnConfig, classifyCandidates, describeProbe, fetchServerIce, probeIce, sharedSecretCredentials, turnUrls, validIceServers } from '../export/web/net/ice.js';
import { APP_ID } from '../export/web/net/protocol.js';
import { openChannel } from '../export/web/net/transport.js';
import { ServerBrowser } from '../export/web/net/lobby.js';

const NOW = 1_700_000_000_000;
const offline = async () => ({ ok: false });
const hosted = servers => async () => ({ ok: true, json: async () => ({ iceServers: servers }) });

test('shared secret credentials match the coturn REST scheme', async () => {
  const { username, credential } = await sharedSecretCredentials(TURN_SECRET, { now: NOW, ttl: 3600 });
  assert.equal(username, `${NOW / 1000 + 3600}:codz`);
  assert.equal(credential, createHmac('sha1', TURN_SECRET).update(username).digest('base64'));
});

test('with no hosted relay the free Open Relay TURN is used over UDP, TCP and TLS', async () => {
  const { servers, source } = await buildIce({ override: undefined, fetcher: offline, now: NOW });
  assert.equal(source, 'openrelay');
  assert.deepEqual(servers[0].urls, EXTRA_STUN_URLS);
  const turn = servers.find(server => server.username);
  assert.ok(turn.credential);
  assert.deepEqual(turn.urls, turnUrls(TURN_HOST));
  assert.ok(turn.urls.some(url => url.startsWith('turns:')));
});

test('a relay hosted by the game server is preferred over Open Relay', async () => {
  const relay = [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp'], username: 'u', credential: 'p' }];
  const { servers, source } = await buildIce({ override: undefined, fetcher: hosted(relay), now: NOW });
  assert.equal(source, 'server');
  assert.deepEqual(servers.slice(1), relay);
});

test('a hosted answer without a relay falls back to Open Relay', async () => {
  const { source } = await buildIce({ override: undefined, fetcher: hosted([{ urls: 'stun:stun.cloudflare.com:3478' }]), now: NOW });
  assert.equal(source, 'openrelay');
  assert.deepEqual(await fetchServerIce({ fetcher: async () => { throw new Error('offline'); } }), []);
  assert.deepEqual(await fetchServerIce({ fetcher: async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }) }), []);
});

test('a custom ICE server list wins and invalid entries are dropped', async () => {
  const custom = [
    { urls: 'turn:relay.example.com:3478', username: 'u', credential: 'p' },
    { urls: ['javascript:alert(1)', 'http://evil.example'] },
    { urls: 'stun:stun.example.com:3478' },
    null,
    'turn:nope',
  ];
  const { servers, source } = await buildIce({ override: custom, fetcher: hosted([]), now: NOW });
  assert.equal(source, 'custom');
  assert.deepEqual(servers, [
    { urls: EXTRA_STUN_URLS },
    { urls: ['turn:relay.example.com:3478'], username: 'u', credential: 'p' },
    { urls: ['stun:stun.example.com:3478'] },
  ]);
  assert.deepEqual(validIceServers('nope'), []);
});

test('without WebCrypto the config falls back to STUN only instead of failing', async () => {
  const subtle = { importKey: async () => { throw new Error('insecure context'); } };
  const { servers, source } = await buildIce({ override: undefined, fetcher: offline, now: NOW, subtle });
  assert.equal(source, 'stun');
  assert.deepEqual(servers, [{ urls: EXTRA_STUN_URLS }]);
  assert.deepEqual(await buildTurnConfig({ override: undefined, fetcher: offline, now: NOW, subtle }), servers);
});

test('every room is opened with the relay config and all tracker relays', () => {
  const seen = [];
  const fakeRoom = { makeAction: () => ({ onMessage: null, send: async () => {} }), leave: async () => {} };
  const turnConfig = [{ urls: 'turn:relay.example.com:3478', username: 'u', credential: 'p' }];
  const net = { joinRoom: (config, roomId, extra) => { seen.push({ config, roomId, extra }); return fakeRoom; }, selfId: 'me', turnConfig };
  openChannel(net, 'directory');
  openChannel(net, 'game-ABCDE', { password: 'pw' });
  assert.equal(seen.length, 2);
  for (const { config } of seen) {
    assert.equal(config.appId, APP_ID);
    assert.equal(config.relayConfig.redundancy, RELAY_REDUNDANCY);
    assert.deepEqual(config.turnConfig, turnConfig);
  }
  assert.equal(seen[0].config.password, undefined);
  assert.equal(seen[1].config.password, 'pw');
});

test('rooms still open when no relay config is available', () => {
  let config = null;
  const fakeRoom = { makeAction: () => ({ onMessage: null, send: async () => {} }), leave: async () => {} };
  openChannel({ joinRoom: value => { config = value; return fakeRoom; }, selfId: 'me' }, 'directory');
  assert.equal(config.turnConfig, undefined);
  assert.equal(config.relayConfig.redundancy, RELAY_REDUNDANCY);
});

test('the server browser reports rooms that could not connect', () => {
  let extra = null;
  const fakeRoom = { makeAction: () => ({ onMessage: null, send: async () => {} }), leave: async () => {} };
  const net = { joinRoom: (config, roomId, options) => { extra = options; return fakeRoom; }, selfId: 'me' };
  const onJoinError = () => {};
  new ServerBrowser(net).open({ setInterval: () => 0, onJoinError });
  assert.equal(extra.onJoinError, onJoinError);
});

test('candidate types are classified from the SDP candidate lines', () => {
  assert.deepEqual(classifyCandidates(['candidate:1 1 udp 2122 192.168.1.5 5000 typ host', 'candidate:2 1 udp 1686 8.8.8.8 5001 typ srflx raddr 0.0.0.0']), { host: true, srflx: true, relay: false });
  assert.deepEqual(classifyCandidates(['candidate:3 1 udp 41 1.2.3.4 6000 typ relay raddr 0.0.0.0 rport 0']), { host: false, srflx: false, relay: true });
  assert.deepEqual(classifyCandidates(undefined), { host: false, srflx: false, relay: false });
});

function fakePeerConnection(candidates, { fail = false } = {}) {
  return class {
    constructor(config) { this.config = config; this.closed = false; fakePeerConnection.last = this; }
    createDataChannel() {}
    async createOffer() { if (fail) throw new Error('no offer'); return {}; }
    async setLocalDescription() {
      for (const candidate of candidates) setImmediate(() => this.onicecandidate({ candidate: { candidate } }));
      setImmediate(() => setImmediate(() => this.onicecandidate({ candidate: null })));
    }
    close() { this.closed = true; }
  };
}

test('the probe gathers candidates, uses the relay servers and closes the connection', async () => {
  const servers = [{ urls: 'turn:relay.example.com:3478', username: 'u', credential: 'p' }];
  const result = await probeIce({ servers, RTCPeerConnection: fakePeerConnection(['candidate:1 1 udp 1 1.1.1.1 1 typ host', 'candidate:2 1 udp 1 2.2.2.2 2 typ relay']), timeoutMs: 1000 });
  assert.deepEqual(result, { host: true, srflx: false, relay: true, supported: true });
  assert.ok(fakePeerConnection.last.closed);
  assert.deepEqual(fakePeerConnection.last.config.iceServers.at(-1), servers[0]);
});

test('the probe survives a failing connection and a browser without WebRTC', async () => {
  assert.equal((await probeIce({ RTCPeerConnection: fakePeerConnection([], { fail: true }), timeoutMs: 1000 })).relay, false);
  assert.equal((await probeIce({ RTCPeerConnection: undefined })).supported, false);
});

test('the network check explains each outcome', () => {
  assert.equal(describeProbe({ supported: true, host: true, srflx: true, relay: true }, 'server').ok, true);
  assert.match(describeProbe({ supported: true, srflx: true }, 'stun').text, /no relay server is set up/);
  assert.match(describeProbe({ supported: true, srflx: true }, 'openrelay').text, /Open Relay/);
  assert.match(describeProbe({ supported: true, host: true }, 'server').text, /VPN, firewall/);
  assert.match(describeProbe({ supported: true }, 'server').text, /No network candidates/);
  assert.match(describeProbe({ supported: false }, 'server').text, /WebRTC is unavailable/);
});
