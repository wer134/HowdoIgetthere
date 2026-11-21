const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

function validateNegativeResults(results, selected = '') {
  const expected = selected ? [...new Set(selected.split(',').map(Number))].sort((a,b)=>a-b) : Array.from({length:78},(_,index)=>index+1);
  const unavailable = [5,40,50,59,67,69,71,72,75].filter(id=>expected.includes(id));
  if(!Array.isArray(results) || JSON.stringify(results.map(result=>result.id).sort((a,b)=>a-b))!==JSON.stringify(expected))throw new Error('Negative results are missing, duplicated, or outside the requested case set');
  if(results.some(result=>result.harnessError || !Array.isArray(result.checks) || !result.checks.length || result.checks.some(check=>!['통과','해당 없음','검증 불가'].includes(check.status))))throw new Error('Negative results include a harness error, missing checks, or failed check');
  if(results.some(result=>!['통과','검증 불가'].includes(result.status)))throw new Error('Negative results include a failed or unknown status');
  const actualUnavailable=results.filter(result=>result.status==='검증 불가').map(result=>result.id).sort((a,b)=>a-b);
  if(JSON.stringify(actualUnavailable)!==JSON.stringify(unavailable))throw new Error('Negative unavailable cases differ from the explicit verification boundary');
  return {ok:true,total:results.length,passed:results.filter(result=>result.status==='통과').length,unavailable:actualUnavailable};
}
module.exports={validateNegativeResults};

if(require.main===module) {
const root = path.resolve(__dirname, '../..');
const out = path.resolve(process.env.REGRESSION_OUT || 'docs/testing/evidence/rebuild/regressions');
const {startMemberFixture} = require('./member-fixture.cjs');
const names = (process.env.REGRESSION_ONLY || 'traveler-journey,travel-order,travel-drag,travel-safety,day-revision,production-stability').split(',');
const release=JSON.parse(fs.readFileSync(path.join(root,'dist/release.json'),'utf8'));
const env = {...process.env,
  ACCOUNT_ORIGIN:'', GOOGLE_OAUTH_CLIENT_ID:'', GOOGLE_OAUTH_CLIENT_SECRET:'', ACCOUNT_SECRET:'',
  FREE_AI_ENABLED:'false', SERVICE_GEMINI_API_KEY:'', TWILIO_ACCOUNT_SID:'', TWILIO_AUTH_TOKEN:'', TWILIO_VERIFY_SERVICE_SID:'',
  CHROMIUM_PATH:process.env.CHROMIUM_PATH || chromium.executablePath()};
fs.mkdirSync(out,{recursive:true});
const results=[];
async function run(name, fixture) {
  const target=path.join(out,name);fs.mkdirSync(target,{recursive:true});
  const script=name==='negative-78'?'docs/testing/repro/negative-78.cjs':`tests/browser/${name}.cjs`;
  const log=fs.createWriteStream(path.join(target,'run.txt'));
  const start=new Date().toISOString();
  const child=spawn(process.execPath,[script],{cwd:root,windowsHide:true,env:{...env,
    APP_URL:fixture.origin, REGRESSION_MEMBER_TOKEN:fixture.memberToken(name), WORKSPACE_OUT:target, REPEATED_OUT:target, JOURNEY_OUT:target,REVISION_OUT:target,STABILITY_OUT:target,NEGATIVE_OUT:target,RESULT_PATH:path.join(target,'results.json')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',value=>{log.write(value);process.stdout.write(value);});
  child.stderr.on('data',value=>{log.write(value);process.stderr.write(value);});
  const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  await new Promise(resolve=>log.end(resolve));
  let verification;
  if(name==='negative-78') {
    try {verification=validateNegativeResults(JSON.parse(fs.readFileSync(path.join(target,'results.json'),'utf8')),env.ONLY || '');}
    catch(error){verification={ok:false,error:error.message};}
  }
  results.push({name,script,started:start,finished:new Date().toISOString(),exitCode,...(verification?{verification}:{})});
  const unchanged=JSON.parse(fs.readFileSync(path.join(root,'dist/release.json'),'utf8')).version===release.version;
  fs.writeFileSync(path.join(out,'run-summary.json'),JSON.stringify({base:fixture.origin,release,artifactUnchanged:unchanged,externalProviders:'blocked or mocked by individual scripts; no supplied credentials',results},null,2));
  if(!unchanged)throw new Error('Production artifact changed during regression execution');
}
(async()=>{
  const fixture = await startMemberFixture({port:Number(process.env.REGRESSION_PORT || 0)});
  try {
    for(const name of names)await run(name, fixture);
    if(results.some(result=>result.exitCode!==0 || result.verification?.ok===false))process.exitCode=1;
  } finally {
    await fixture.close();
    fs.writeFileSync(path.join(out,'cleanup.json'),JSON.stringify({serverExited:true,finished:new Date().toISOString()},null,2));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
}
