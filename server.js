// Development only: public assets, loopback binding, no shared keys unless explicitly enabled.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './tools/http-server.js';
import { buildRuntimeConfig } from './runtime-config-builder.js';
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535');
const localKeys = process.argv.includes('--local-keys');
if (process.env.NODE_ENV === 'production') throw new Error('Use npm run build && npm run start:production');
const server = createStaticServer({ root, port, runtime: buildRuntimeConfig(process.env, { localKeys }) });
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Requested port is already in use.' : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`RouteFlow: http://127.0.0.1:${port}/${localKeys ? ' (local credentials enabled)' : ''}`));
