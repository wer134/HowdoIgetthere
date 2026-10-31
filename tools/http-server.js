import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { publicAssets, safeAsset } from './public-assets.js';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'Content-Security-Policy-Report-Only': "default-src 'self'; script-src 'self' https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.googleusercontent.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.googleusercontent.com https://api.anthropic.com https://api.openai.com https://api.frankfurter.dev; worker-src 'self' blob:; frame-src https://www.google.com",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
export function createStaticServer({ root, production = false, runtime = null, port = 8080, assetVersion = null }) {
  const allowed = new Set(publicAssets(root));
  return http.createServer(async (req, res) => {
    for (const [key, value] of Object.entries(securityHeaders)) res.setHeader(key, value);
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); res.writeHead(405).end(); return; }
    let url, name;
    try { url = new URL(req.url, 'http://localhost'); name = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html'; }
    catch { res.writeHead(400).end(); return; }
    if (name === 'healthz') { res.setHeader('Cache-Control', 'no-store'); res.writeHead(200, { 'Content-Type': 'text/plain' }).end(req.method === 'HEAD' ? undefined : 'ok'); return; }
    if (!production && runtime && name === 'runtime-config.js') {
      // Browser-origin and Host checks also reject DNS rebinding/cross-site access to opted-in local keys.
      const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
      const ownOrigin = !req.headers.origin || [...hosts].some(host => req.headers.origin === `http://${host}`);
      if (!hosts.has(req.headers.host) || !ownOrigin || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403).end(); return; }
      res.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store' }).end(req.method === 'HEAD' ? undefined : runtime);
      return;
    }
    const file = safeAsset(root, name, allowed);
    if (!file) { res.writeHead(404, { 'Content-Type': types['.txt'] }).end('Not found'); return; }
    try {
      let data = await fs.readFile(file);
      const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
      // Versioned asset URLs are produced by the build. HTML/config always revalidate.
      const versioned = production && assetVersion && url.searchParams.get('v') === assetVersion && /\.(js|css|png|svg|webp|woff2)$/.test(name) && !/^(config|runtime-config)\.js$/.test(name);
      const etag = `W/"${hash}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', versioned ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.setHeader('Content-Type', types[path.extname(name)] || 'application/octet-stream');
      if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return; }
      if (production) {
        const accepted = req.headers['accept-encoding'] || '';
        for (const [coding, extension] of [['br', '.br'], ['gzip', '.gz']]) {
          const offered = accepted.split(',').map(v => v.trim()).find(v => v.split(';')[0] === coding);
          if (!offered || /;\s*q=0(?:\.0*)?$/.test(offered)) continue;
          const compressed = safeAsset(root, name + extension, new Set([name + extension]));
          if (!compressed) continue;
          data = await fs.readFile(compressed); res.setHeader('Content-Encoding', coding); break;
        }
      }
      res.setHeader('Content-Length', data.length);
      res.writeHead(200).end(req.method === 'HEAD' ? undefined : data);
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
}
