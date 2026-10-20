import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanIceServers, turnResponse } from '../functions/api/turn.js';

const env = { TURN_KEY_ID: 'key 1', TURN_KEY_API_TOKEN: 'secret-token' };
const cloudflare = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp'], username: 'user', credential: 'pass' },
  ],
};

test('without a TURN key the endpoint answers 404 so the game falls back', async () => {
  const response = await turnResponse({}, { fetcher: async () => { throw new Error('must not be called'); } });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('credentials are requested server side with the API token and port 53 urls are removed', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => cloudflare }; };
  const response = await turnResponse(env, { fetcher });
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, 'https://rtc.live.cloudflare.com/v1/turn/keys/key%201/credentials/generate-ice-servers');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), { ttl: 86400 });
  const body = await response.json();
  assert.deepEqual(body.iceServers[0].urls, ['stun:stun.cloudflare.com:3478']);
  assert.deepEqual(body.iceServers[1], { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp'], username: 'user', credential: 'pass' });
  assert.ok(!JSON.stringify(body).includes('secret-token'));
});

test('upstream failures and answers without a relay become a 502', async () => {
  assert.equal((await turnResponse(env, { fetcher: async () => ({ ok: false }) })).status, 502);
  assert.equal((await turnResponse(env, { fetcher: async () => { throw new Error('network'); } })).status, 502);
  assert.equal((await turnResponse(env, { fetcher: async () => ({ ok: true, json: async () => ({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }) }) })).status, 502);
  assert.deepEqual(cleanIceServers('nope'), []);
});
