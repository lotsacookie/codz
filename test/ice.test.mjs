import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { EXTRA_STUN_URLS, RELAY_REDUNDANCY, TURN_HOST, TURN_SECRET, buildTurnConfig, sharedSecretCredentials, turnUrls, validIceServers } from '../export/web/net/ice.js';
import { APP_ID } from '../export/web/net/protocol.js';
import { openChannel } from '../export/web/net/transport.js';

const NOW = 1_700_000_000_000;

test('shared secret credentials match the coturn REST scheme', async () => {
  const { username, credential } = await sharedSecretCredentials(TURN_SECRET, { now: NOW, ttl: 3600 });
  assert.equal(username, `${NOW / 1000 + 3600}:codz`);
  assert.equal(credential, createHmac('sha1', TURN_SECRET).update(username).digest('base64'));
});

test('default config relays through TURN over UDP, TCP and TLS and adds extra STUN', async () => {
  const config = await buildTurnConfig({ override: undefined, now: NOW });
  assert.deepEqual(config[0].urls, EXTRA_STUN_URLS);
  const turn = config.find(server => server.username);
  assert.ok(turn.credential);
  assert.deepEqual(turn.urls, turnUrls(TURN_HOST));
  assert.ok(turn.urls.some(url => url.startsWith('turn:') && !url.includes('transport=tcp')));
  assert.ok(turn.urls.some(url => url.startsWith('turns:')));
});

test('a custom ICE server list is used instead of the default TURN and invalid entries are dropped', async () => {
  const custom = [
    { urls: 'turn:relay.example.com:3478', username: 'u', credential: 'p' },
    { urls: ['javascript:alert(1)', 'http://evil.example'] },
    { urls: 'stun:stun.example.com:3478' },
    null,
    'turn:nope',
  ];
  const config = await buildTurnConfig({ override: custom, now: NOW });
  assert.deepEqual(config, [
    { urls: EXTRA_STUN_URLS },
    { urls: ['turn:relay.example.com:3478'], username: 'u', credential: 'p' },
    { urls: ['stun:stun.example.com:3478'] },
  ]);
  assert.deepEqual(validIceServers('nope'), []);
});

test('without WebCrypto the config falls back to STUN only instead of failing', async () => {
  const config = await buildTurnConfig({ override: undefined, now: NOW, subtle: { importKey: async () => { throw new Error('insecure context'); } } });
  assert.deepEqual(config, [{ urls: EXTRA_STUN_URLS }]);
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
