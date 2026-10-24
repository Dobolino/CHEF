import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
async function files(directory) {
  const result = [];
  for (const item of await fs.readdir(new URL(directory, root), { withFileTypes: true })) {
    const name = `${directory}${item.name}`;
    if (item.isDirectory()) result.push(...await files(`${name}/`)); else result.push(name);
  }
  return result;
}
const assets = ['index.html', 'kochmodus.html', 'recipes.json', 'manifest.json', 'icon.svg', 'PROMPT_RECIPES.md',
  ...await files('src/'), ...await files('icons/'), ...await files('schemas/')].sort();
const hash = createHash('sha256');
for (const asset of assets) { hash.update(asset); hash.update(await fs.readFile(new URL(asset, root))); }
const cache = `chef-app-${hash.digest('hex').slice(0, 16)}`;
const template = await fs.readFile(new URL('sw-template.js', import.meta.url), 'utf8');
await fs.writeFile(new URL('sw.js', root), template.replace('__CACHE_NAME__', JSON.stringify(cache)).replace('__ASSETS__', JSON.stringify(['./', ...assets.map(a => `./${a}`)], null, 2)));
console.log(`Offline app cache generated: ${cache}`);
