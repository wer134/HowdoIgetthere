import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createStaticServer } from '../tools/http-server.js';

test('public assets only: hidden paths, source, symlink escapes and unsupported methods are blocked', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'routeflow-public-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'routeflow-outside-'));
  await fs.mkdir(path.join(root, '.git')); await fs.mkdir(path.join(root, 'js'));
  await fs.writeFile(path.join(root, '.git/config'), 'private'); await fs.writeFile(path.join(root, 'server.js'), 'private');
  await fs.writeFile(path.join(root, 'index.html'), 'public'); await fs.writeFile(path.join(root, 'js/app.js'), 'export const ok=true;');
  await fs.writeFile(path.join(root, 'js/app.js.gz'), gzipSync('export const ok=true;'));
  await fs.writeFile(path.join(outside, 'secret.js'), 'private'); await fs.symlink(path.join(outside, 'secret.js'), path.join(root, 'js/escape.js'));
  const server = createStaticServer({ root, production: true, assetVersion: 'version' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root,{recursive:true,force:true}); await fs.rm(outside,{recursive:true,force:true}); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const file of ['/.git/config','/%2egit/config','/server.js','/.env','/js/escape.js','/docs/testing/report.json']) assert.equal((await fetch(base + file)).status,404,file);
  assert.equal((await fetch(base, {method:'POST'})).status,405);
  const response = await fetch(base + '/js/app.js?v=version', {headers:{'Accept-Encoding':'gzip'}});
  assert.equal(response.status,200); assert.equal(response.headers.get('content-encoding'),'gzip');
  assert.match(response.headers.get('cache-control'),/immutable/); assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal(await response.text(),'export const ok=true;');
  assert.equal((await fetch(base+'/js/app.js',{headers:{'If-None-Match':response.headers.get('etag')}})).status,304);
  assert.doesNotMatch((await fetch(base+'/js/app.js?v=old')).headers.get('cache-control'),/immutable/);
  assert.equal((await fetch(base+'/healthz')).status,200);
});

test('opted-in local key endpoint rejects foreign origins and hosts', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'routeflow-local-'));
  const server=createStaticServer({root,runtime:'dummy only',port:8080});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${server.address().port}/runtime-config.js`;
  const request = headers => new Promise((resolve,reject) => {
    http.get(url,{headers},response=>{response.resume();resolve(response);}).on('error',reject);
  });
  assert.equal((await request({Host:'attacker.example'})).statusCode,403);
  assert.equal((await request({Host:'localhost:8080',Origin:'https://attacker.example'})).statusCode,403);
  const response=await request({Host:'localhost:8080'});
  assert.equal(response.statusCode,200);assert.equal(response.headers['cache-control'],'no-store');
});
