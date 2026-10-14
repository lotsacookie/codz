#!/usr/bin/env node
// Static server for the composed Kino scene.
//   node .tools/serve.mjs [port]
// Range requests are supported because the 54 MB kino.bin is fetched by
// GLTFLoader and Chrome will issue partial requests for it.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';

const ROOT = process.env.KINO_WEB_ROOT ? resolve(process.env.KINO_WEB_ROOT) : resolve(import.meta.dirname, '..', 'export', 'web');
const PORT = Number(process.argv[2]) || 5173;
const LAN = process.argv.includes('--lan');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

createServer((req, res) => {
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'}).end();return;}
  let url;
  try {url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end('bad request');return;}
  if(url==='/__health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(req.method==='HEAD'?undefined:JSON.stringify({app:'kino-browser-zombies',version:'0.1.0',root:ROOT}));return;}

  // The page ships no icon; answering avoids a console error on every load.
  if (url === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }

  const path = resolve(ROOT, '.'+(url==='/'?'/index.html':url).replace(/\\/g,'/'));

  if (!path.toLowerCase().startsWith((ROOT+sep).toLowerCase())) {
    res.writeHead(403).end('forbidden');
    return;
  }

  let stat;
  try {
    stat = statSync(path);
    if(!stat.isFile())throw new Error('not a file');
  } catch {
    res.writeHead(404).end('not found');
    return;
  }

  const type = TYPES[extname(path).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = m?.[1] ? Number(m[1]) : m?.[2] ? Math.max(0,stat.size-Number(m[2])) : NaN;
    const end = m?.[1] && m[2] ? Math.min(Number(m[2]),stat.size-1) : stat.size-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return;}
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    if(req.method==='HEAD')res.end();else createReadStream(path, { start, end }).on('error',()=>res.destroy()).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  });
  if(req.method==='HEAD')res.end();else createReadStream(path).on('error',()=>res.destroy()).pipe(res);
}).listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`kino: http://127.0.0.1:${PORT}/`);
  if (LAN) for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) if (address.family === 'IPv4' && !address.internal) {
      console.log(`Phone on the same Wi-Fi: http://${address.address}:${PORT}/ (map list: Kino, Moon, Shangri-La, Ascension, Call of the Dead)`);
    }
  }
});
