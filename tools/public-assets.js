import fs from 'node:fs';
import path from 'node:path';

const rootFiles = ['index.html', 'config.js', 'runtime-config.js', '지도_양식.xlsx',
  'privacy.html', 'terms.html', 'robots.txt', 'sitemap.xml', 'release.json', 'THIRD_PARTY_NOTICES.md', 'COPYRIGHT.md'];
const vendorFiles = ['xlsx.full.min.js', 'anthropic-sdk-0.131.0.min.js', 'SheetJS-APACHE-2.0.txt', 'anthropic-sdk-LICENSE.txt'];
export function publicAssets(root) {
  const files = rootFiles.filter(name => fs.existsSync(path.join(root, name)));
  for (const [dir, pattern] of [['js', /^[a-z0-9-]+\.js$/], ['css', /^[a-z0-9-]+\.css$/], ['assets', /^[a-z0-9-]+\.(svg|png|webp|avif|ico|woff2)$/]]) {
    if (fs.existsSync(path.join(root, dir))) for (const name of fs.readdirSync(path.join(root, dir))) {
      if (pattern.test(name)) files.push(`${dir}/${name}`);
    }
  }
  files.push(...vendorFiles.filter(name => fs.existsSync(path.join(root, 'vendor', name))).map(name => `vendor/${name}`));
  return files;
}
export function safeAsset(root, name, allowed) {
  if (!allowed.has(name)) return null;
  const file = path.join(root, name);
  try {
    const real = fs.realpathSync(file);
    if (!real.startsWith(fs.realpathSync(root) + path.sep) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}
