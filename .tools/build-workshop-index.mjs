import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_ID, crawl } from './lib/workshop-crawl.mjs';

const MIN_ITEMS = 30;
const file = path.resolve(import.meta.dirname, '..', 'export', 'web', 'maps', 'workshop', 'index.json');

const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { items: [] };
const items = await crawl({ log: message => console.log(message) });

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
