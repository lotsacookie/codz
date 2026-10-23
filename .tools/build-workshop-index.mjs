import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_ID, DEFAULT_LIMIT, crawl } from './lib/workshop-crawl.mjs';
import { discover } from './lib/github-discover.mjs';
import { verifySource } from './lib/github-verify.mjs';

const MIN_ITEMS = 1;
const LIMIT = Math.max(1, Math.floor(Number(process.env.WORKSHOP_MAX_ITEMS ?? process.argv[2])) || DEFAULT_LIMIT);
console.log(`Item limit: ${LIMIT}`);
const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'export', 'web', 'assets', 'maps', 'workshop', 'index.json');
const debugDir = path.join(root, '.work', 'workshop-debug');

const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { items: [] };
// GitHub first: it returns many items per request. Steam then only fills what is left of the limit.
let githubItems = [];
try {
  githubItems = await discover({ maxRepos: LIMIT, token: process.env.GITHUB_TOKEN ?? '', log: message => console.log(message) });
} catch (error) {
  console.error(`GitHub search failed: ${error.message}`);
}
console.log(`GitHub: +${githubItems.length} repos with a .map file.`);
const taken = new Set(githubItems.map(item => item.source.toLowerCase()));
const cache = new Map();
const steamItems = await crawl({
  verify: async (item, candidates) => {
    const source = await verifySource(candidates, { token: process.env.GITHUB_TOKEN ?? '', cache, log: message => console.log(message) });
    return source ? { ...item, source } : null;
  },
  limit: Math.max(0, LIMIT - githubItems.length),
  skip: item => taken.has(item.source.toLowerCase()),
  log: message => console.log(message),
  dump: ({ sort, page, html }) => {
    mkdirSync(debugDir, { recursive: true });
    writeFileSync(path.join(debugDir, `${String(sort).replace(/\W+/g, "-")}-page${page}.html`), html.slice(0, 500000));
  },
});
console.log(`Steam: +${steamItems.length} items with a source link.`);
const items = [...githubItems, ...steamItems].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0)).slice(0, LIMIT);

if (items.length < MIN_ITEMS) {
  console.error(`Only ${items.length} Workshop items were read; keeping the existing index.`);
  process.exit(1);
}

const lines = items.map(item => JSON.stringify(item));
const unchanged = lines.length === previous.items.length && lines.every((line, index) => line === JSON.stringify(previous.items[index]));
if (unchanged) {
  console.log(`${items.length} items, no changes.`);
} else {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `{"appId":${APP_ID},"generated":${JSON.stringify(new Date().toISOString())},"items":[\n${lines.join(',\n')}\n]}\n`);
  console.log(`Wrote ${items.length} items to ${path.relative(process.cwd(), file)}.`);
}
