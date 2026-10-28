// 앱을 내 컴퓨터에서 띄우는 작은 정적 파일 서버 (설치할 패키지 없음)
// 실행: node server.js        포트 바꾸기: PORT=9000 node server.js        브라우저 자동 열기 끄기: --no-open
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const OPEN_BROWSER = !process.argv.includes('--no-open');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  if (pathname === '/runtime-config.js') {
    const key = process.env.googleAPI;
    const script = key ? `window.APP_CONFIG.googleMapsApiKey = ${JSON.stringify(key)};` : '';
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    }).end(script);
    return;
  }
  const file = path.join(ROOT, pathname);
  // 앱 폴더 바깥이나 숨김 파일은 내주지 않는다
  if (!file.startsWith(ROOT + path.sep) || path.basename(file).startsWith('.')) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

function openBrowser(url) {
  const command = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(command, () => {});
}

function listen(port, triesLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) {
      listen(port + 1, triesLeft - 1);
      return;
    }
    console.error(err.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`엑셀 지도 만들기: ${url}`);
    if (port !== PORT) {
      console.log(`(${PORT}번 포트가 사용 중이라 ${port}번을 씁니다. API 키에 리퍼러 제한을 걸었다면 이 주소도 추가하세요.)`);
    }
    console.log('끝내려면 이 창을 닫거나 Ctrl+C를 누르세요.');
    if (OPEN_BROWSER) openBrowser(url);
  });
}

listen(PORT, 10);
