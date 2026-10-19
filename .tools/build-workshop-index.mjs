import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_ID, crawl } from './lib/workshop-crawl.mjs';

const MIN_ITEMS = 30;
const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'export', 'web', 'maps', 'workshop', 'index.json');
const debugDir = path.join(root, '.work', 'workshop-debug');

const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { items: [] };
const items = await crawl({
  log: message => console.log(message),
  dump: ({ sort, page, html }) => {
    mkdirSync(debugDir, { recursive: true });
    writeFileSync(path.join(debugDir, `${String(sort).replace(/\W+/g, "-")}-page${page}.html`), html.slice(0, 500000));
  },
});

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
