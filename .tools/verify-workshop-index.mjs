// Re-checks the saved Workshop index: drops entries whose source has no loadable .map and points the rest at the .map itself.
// Usage: GITHUB_TOKEN=... node .tools/verify-workshop-index.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { verifySource } from './lib/github-verify.mjs';

const file = path.join(path.resolve(import.meta.dirname, '..'), 'export', 'web', 'assets', 'maps', 'workshop', 'index.json');
const index = JSON.parse(readFileSync(file, 'utf8'));
const cache = new Map();
const items = [];
for (const item of index.items) {
  const source = await verifySource([item.source], { token: process.env.GITHUB_TOKEN ?? '', cache, log: message => console.log(message) });
  console.log(`${source ? 'keep' : 'drop'} ${item.name} (${item.source})`);
  if (source) items.push({ ...item, source });
}
writeFileSync(file, `{"appId":${index.appId},"generated":${JSON.stringify(index.generated)},"items":[\n${items.map(item => JSON.stringify(item)).join(',\n')}\n]}\n`);
console.log(`${items.length} of ${index.items.length} kept.`);
