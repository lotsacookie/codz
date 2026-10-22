import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { loadBinaryParts } from '../export/web/assets/js/binary-parts.js';

test('collision downloads preserve order across network chunks and reject incomplete or oversized data', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/missing') { res.writeHead(404).end(); return; }
    const bytes = req.url === '/first' ? [0, 1, 2, 3] : [4, 5, 6];
    res.write(Buffer.from(bytes.slice(0, 1)));
    setTimeout(() => res.end(Buffer.from(bytes.slice(1))), 5);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/collision.json`;
  const parts = [{ uri: 'first', byteLength: 4 }, { uri: 'second', byteLength: 3 }];
  try {
    const progress = [];
    const bytes = await loadBinaryParts(parts, { baseUrl, byteLength: 7, onProgress: p => progress.push(p.loaded) });
    assert.deepEqual([...new Uint8Array(bytes)], [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(progress[0], 0); assert.equal(progress.at(-1), 7);
    assert(progress.every((value, i) => !i || value >= progress[i - 1]));
    await assert.rejects(loadBinaryParts([{ uri: 'first', byteLength: 5 }], { baseUrl, byteLength: 5 }), /size mismatch/);
    await assert.rejects(loadBinaryParts([{ uri: 'first', byteLength: 3 }], { baseUrl, byteLength: 3 }), /size mismatch/);
    await assert.rejects(loadBinaryParts([{ uri: 'missing', byteLength: 1 }], { baseUrl, byteLength: 1 }), /HTTP 404/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('collision layouts are validated against the declared byte length before any download is used', async () => {
  const { validateCollisionLayout } = await import('../export/web/assets/js/collision-world.js');
  const fs = await import('node:fs');
  for (const map of ['shangri-la', 'moon']) {
    const meta = JSON.parse(fs.readFileSync(new URL(`../export/web/assets/${map}/collision.json`, import.meta.url)));
    assert.doesNotThrow(() => validateCollisionLayout(meta, [{ uri: meta.binary, byteLength: meta.byteLength }]), map);
    assert.throws(() => validateCollisionLayout({ ...meta, byteLength: meta.byteLength + 4 }, [{ uri: meta.binary }]), /size mismatch/);
    assert.throws(() => validateCollisionLayout(meta, [{ uri: 'a', byteLength: 10 }, { uri: 'b', byteLength: 10 }]), /size mismatch/);
  }
});
