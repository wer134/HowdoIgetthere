const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const out = path.resolve(process.env.REGRESSION_OUT || 'docs/testing/evidence/rebuild/regressions');
const port = Number(process.env.REGRESSION_PORT || 8107);
const base = `http://127.0.0.1:${port}`;
const names = (process.env.REGRESSION_ONLY || 'traveler-journey,travel-order,travel-drag,travel-safety,day-revision,production-stability').split(',');
const release=JSON.parse(fs.readFileSync(path.join(root,'dist/release.json'),'utf8'));
const env = {...process.env, PORT:String(port), HOST:'127.0.0.1', APP_URL:base,
  ACCOUNT_ORIGIN:'', GOOGLE_OAUTH_CLIENT_ID:'', GOOGLE_OAUTH_CLIENT_SECRET:'', ACCOUNT_SECRET:'',
  FREE_AI_ENABLED:'false', SERVICE_GEMINI_API_KEY:'', TWILIO_ACCOUNT_SID:'', TWILIO_AUTH_TOKEN:'', TWILIO_VERIFY_SERVICE_SID:'',
  CHROMIUM_PATH:process.env.CHROMIUM_PATH || chromium.executablePath()};
fs.mkdirSync(out,{recursive:true});
const serverLog=fs.createWriteStream(path.join(out,'server.txt'));
const server=spawn(process.execPath,['production-server.js'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
server.stdout.pipe(serverLog,{end:false});server.stderr.pipe(serverLog,{end:false});
const results=[];
async function run(name) {
  const target=path.join(out,name);fs.mkdirSync(target,{recursive:true});
  const script=name==='negative-78'?'docs/testing/repro/negative-78.cjs':`tests/browser/${name}.cjs`;
  const log=fs.createWriteStream(path.join(target,'run.txt'));
  const start=new Date().toISOString();
  const child=spawn(process.execPath,[script],{cwd:root,windowsHide:true,env:{...env,
    JOURNEY_OUT:target,REVISION_OUT:target,STABILITY_OUT:target,NEGATIVE_OUT:target,RESULT_PATH:path.join(target,'results.json')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',value=>{log.write(value);process.stdout.write(value);});
  child.stderr.on('data',value=>{log.write(value);process.stderr.write(value);});
  const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  await new Promise(resolve=>log.end(resolve));
  results.push({name,script,started:start,finished:new Date().toISOString(),exitCode});
  const unchanged=JSON.parse(fs.readFileSync(path.join(root,'dist/release.json'),'utf8')).version===release.version;
  fs.writeFileSync(path.join(out,'run-summary.json'),JSON.stringify({base,release,artifactUnchanged:unchanged,externalProviders:'blocked or mocked by individual scripts; no supplied credentials',results},null,2));
  if(!unchanged)throw new Error('Production artifact changed during regression execution');
}
(async()=>{
  try {
    let ready=false;
    for(let i=0;i<100;i++) {try {if((await fetch(`${base}/healthz`)).ok){ready=true;break;}}catch{} await new Promise(resolve=>setTimeout(resolve,100));}
    if(!ready)throw new Error('Production server did not become ready');
    for(const name of names)await run(name);
    if(results.some(result=>result.exitCode!==0))process.exitCode=1;
  } finally {
    if(server.exitCode===null){const closed=new Promise(resolve=>server.once('exit',resolve));server.kill();await closed;}
    await new Promise(resolve=>serverLog.end(resolve));
    fs.writeFileSync(path.join(out,'cleanup.json'),JSON.stringify({serverExited:true,port,finished:new Date().toISOString()},null,2));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
