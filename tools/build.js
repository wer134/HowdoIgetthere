import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { publicAssets, safeAsset } from './public-assets.js';
import { buildRuntimeConfig } from '../runtime-config-builder.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const url = new URL(process.env.SITE_URL || 'https://wer134.github.io/HowdoIgetthere/');
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('SITE_URL must be a public HTTPS URL without query/credentials');
if (['localhost','127.0.0.1','0.0.0.0','[::1]'].includes(url.hostname)) throw new Error('SITE_URL must not be local');
if (!url.pathname.endsWith('/')) url.pathname += '/';
const allowed = new Set(publicAssets(root));
const contents = new Map();
for (const name of allowed) {
  if (name === 'release.json') continue;
  const source = safeAsset(root, name, allowed);
  if (!source) throw new Error(`Unsafe public asset: ${name}`);
  contents.set(name, await fs.readFile(source));
}
contents.set('runtime-config.js', Buffer.from(buildRuntimeConfig({ NODE_ENV: 'production', PUBLIC_GOOGLE_MAPS_KEY: process.env.PUBLIC_GOOGLE_MAPS_KEY })));
for (const [name, bytes] of contents) if (/\.(html|xml|txt)$/.test(name)) {
  contents.set(name, Buffer.from(bytes.toString().replaceAll('https://wer134.github.io/HowdoIgetthere/', url.href)));
}
const version = createHash('sha256');
for (const [name, bytes] of [...contents].sort()) version.update(name).update(bytes);
const id = version.digest('hex').slice(0, 16);
for (const [name, bytes] of contents) {
  let body = bytes;
  if (name.startsWith('js/') && name.endsWith('.js')) body = Buffer.from(bytes.toString().replace(/(['"])((?:\.\.?\/)[\w./-]+\.js)\1/g, (_, q, target) => `${q}${target}?v=${id}${q}`));
  if (name.endsWith('.html')) body = Buffer.from(body.toString().replace(/((?:src|href)=["'])(js\/[^"']+\.js|css\/[^"']+\.css|vendor\/[^"']+\.js)(["'])/g, `$1$2?v=${id}$3`));
  contents.set(name, body);
}
let revision = 'unknown';
try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}
contents.set('release.json', Buffer.from(JSON.stringify({ version: id, revision, site: url.href, assets: [...contents.keys()] }, null, 2)));
const secrets = ['geminiapi','googlemap','googleAPI'].map(key => process.env[key]).filter(Boolean);
for (const [name, body] of contents) if (secrets.some(secret => body.includes(secret) && secret !== process.env.PUBLIC_GOOGLE_MAPS_KEY)) throw new Error(`Private environment credential in asset: ${name}`);
await fs.rm(out, { recursive: true, force: true });
for (const [name, body] of contents) {
  const target = path.join(out, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, body);
  if (/\.(js|css|html|xml|svg|txt|json|md)$/.test(name) && body.length > 1024) {
    await fs.writeFile(target + '.br', brotliCompressSync(body)); await fs.writeFile(target + '.gz', gzipSync(body));
  }
}
await fs.writeFile(path.join(out, '.nojekyll'), '');
console.log(`Built ${contents.size} public assets (${id}); private runtime credentials excluded.`);
