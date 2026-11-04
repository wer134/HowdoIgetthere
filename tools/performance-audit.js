import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0,'127.0.0.1',resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
const out = path.resolve(process.argv[2] || '.omo/evidence/performance-followup/audit');
await fs.mkdir(out,{recursive:true});
const appPort = await freePort(), cdpPort = await freePort();
const base = `http://127.0.0.1:${appPort}`;
const server = spawn(process.execPath,['production-server.js'],{
  cwd:process.cwd(),windowsHide:true,
  env:{...process.env,PORT:String(appPort),HOST:'127.0.0.1',ACCOUNT_ORIGIN:'',GOOGLE_OAUTH_CLIENT_ID:'',GOOGLE_OAUTH_CLIENT_SECRET:'',ACCOUNT_SECRET:'',FREE_AI_ENABLED:'false'},
  stdio:['ignore','pipe','pipe'],
});
let serverText = '', browser;
server.stdout.on('data',value => {serverText+=value;});
server.stderr.on('data',value => {serverText+=value;});
const rows = [];
try {
  let ready = false;
  for (let attempt=0;attempt<100;attempt++) {
    try {if ((await fetch(base+'/healthz',{signal:AbortSignal.timeout(1000)})).ok) {ready=true;break;}}
    catch {}
    await new Promise(resolve => setTimeout(resolve,100));
  }
  if (!ready) throw new Error('Production server did not start');
  const session = await fetch(base+'/api/session');
  if (session.status!==200 || (await session.json()).available!==false) throw new Error('Production account boundary is not disabled');
  browser = await chromium.launch({channel:'chrome',headless:true,args:[`--remote-debugging-port=${cdpPort}`,'--disable-dev-shm-usage']});
  for (const form of ['mobile','desktop']) for (let run=1;run<=3;run++) {
    const result = await lighthouse(base+'/',{
      port:cdpPort,output:'json',logLevel:'error',
      onlyCategories:['performance','accessibility','best-practices','seo'],
      maxWaitForFcp:30000,maxWaitForLoad:45000,
    },form==='desktop'?desktopConfig:undefined);
    const report = result.lhr;
    if (report.configSettings.formFactor!==form) throw new Error('Wrong Lighthouse profile');
    if (report.runtimeError) throw new Error(JSON.stringify(report.runtimeError));
    await fs.writeFile(path.join(out,`${form}-${run}.json`),result.report);
    rows.push({
      form,run,fetchTime:report.fetchTime,
      scores:Object.fromEntries(Object.entries(report.categories).map(([key,value]) => [key,Math.round(value.score*100)])),
      metrics:Object.fromEntries(['first-contentful-paint','largest-contentful-paint','total-blocking-time','cumulative-layout-shift','speed-index'].map(key => [key,report.audits[key].numericValue])),
      warnings:report.runWarnings,
    });
    await fs.writeFile(path.join(out,'progress.json'),JSON.stringify(rows,null,2));
    console.log(JSON.stringify(rows.at(-1)));
  }
} finally {
  await browser?.close();
  if (server.exitCode===null) {
    const ended = new Promise(resolve => server.once('exit',resolve));
    server.kill();await ended;
  }
  await fs.writeFile(path.join(out,'server.txt'),serverText);
  await fs.writeFile(path.join(out,'summary.json'),JSON.stringify({
    release:JSON.parse(await fs.readFile('dist/release.json','utf8')),
    browserVersion:browser?.version(),
    environment:'Windows Chrome stable via Playwright, Lighthouse Node API, actual production-server.js with disabled account service, sequential cold visits and default mobile/desktop throttling',
    rows,cleanup:{browserClosed:true,serverClosed:true},
  },null,2));
}
