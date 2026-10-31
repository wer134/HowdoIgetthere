import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { publicAssets } from './public-assets.js';
const root = path.resolve('dist');
const release = JSON.parse(await fs.readFile(path.join(root, 'release.json')));
const allowed = new Set([...release.assets, 'release.json', '.nojekyll']);
async function walk(dir) { const paths = []; for (const entry of await fs.readdir(dir, { withFileTypes: true })) { assert(!entry.isSymbolicLink(), 'No symlinks in release'); const file = path.join(dir, entry.name); if (entry.isDirectory()) paths.push(...await walk(file)); else paths.push(file); } return paths; }
for (const file of await walk(root)) {
  const name = path.relative(root, file), base = name.replace(/\.(br|gz)$/, '');
  assert(allowed.has(base), `Unlisted release file: ${name}`);
  if (!/\.(html|js|css|json)$/.test(name)) continue;
  const text = await fs.readFile(file, 'utf8');
  if (!name.startsWith('vendor/')) assert(!/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?=[:/])/.test(text), `Local API URL in ${name}`);
  if (name === 'runtime-config.js' || name === 'config.js') assert(!/geminiApiKey|anthropicApiKey|openaiApiKey/.test(text), `AI key configuration in ${name}`);
  if (name.endsWith('.html')) for (const match of text.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)) {
    const ref = match[1]; if (/^(https?:|data:|mailto:)/.test(ref)) continue;
    await fs.access(path.join(root, ref.split('?')[0]));
  }
}
assert(release.assets.every(name => publicAssets(root).includes(name)), 'Public allowlist mismatch');
console.log(`Release checks passed: ${release.assets.length} assets, revision ${release.revision}`);
