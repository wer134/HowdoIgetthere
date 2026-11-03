import test from 'node:test';
import assert from 'node:assert/strict';
import { accountConfig } from '../backend/config.js';
import { createAccountStore } from '../backend/store.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

const snapshot = () => ({id:'guest',name:'테스트 여행',updated:1,headers:['장소'],records:[{rowNumber:2,cells:[{v:'공원'}]}],mapping:{name:0,date:-1,category:-1,time:-1,region:-1,memo:-1,address:-1,lat:-1,lng:-1,mode:-1},library:[],dates:[],places:[]});
function setup(t, overrides = {}) {
  const config = {...accountConfig({}),dbPath:':memory:',secret:'test-secret-for-isolated-tests-only-32',...overrides};
  const store = createAccountStore(config); t.after(()=>store.close());
  const owner = store.upsertUser({sub:'owner',name:'Owner',email:'owner@example.test'});
  const other = store.upsertUser({sub:'other',name:'Other',email:'other@example.test'});
  return {store,owner,other};
}
test('owner saves with version and stale writers cannot overwrite', t => {
  const {store,owner,other} = setup(t); const travel=store.createTravel(owner.id,snapshot());
  assert.throws(()=>store.getTravel(other.id,travel.id),{code:'not_found'});
  const saved=store.saveTravel(owner.id,travel.id,{...travel.snapshot,name:'새 이름'},travel.version);
  assert.equal(saved.version,2);
  assert.throws(()=>store.saveTravel(owner.id,travel.id,travel.snapshot,1),{code:'conflict'});
  assert.equal(store.getTravel(owner.id,travel.id).snapshot.name,'새 이름');
});
test('share rotation invalidates old token and only owner accepts suggestions once', t => {
  const {store,owner,other}=setup(t); const travel=store.createTravel(owner.id,snapshot());
  const first=store.createShare(owner.id,travel.id,1); const second=store.createShare(owner.id,travel.id,1);
  assert.throws(()=>store.readShare(first.token),{code:'not_found'});
  const suggestion=store.suggest(other.id,second.token,{name:'카페',memo:'창가'});
  assert.throws(()=>store.acceptSuggestion(other.id,travel.id,suggestion.id,1),{code:'not_found'});
  const accepted=store.acceptSuggestion(owner.id,travel.id,suggestion.id,1);
  assert.equal(accepted.snapshot.library[0].memo,'창가');
  assert.throws(()=>store.acceptSuggestion(owner.id,travel.id,suggestion.id,2),{code:'already_reviewed'});
});
test('reservations consume budget even when external provider fails', t => {
  const {store,owner}=setup(t,{ai:{dailyCalls:1,monthlyCalls:5,dailyCost:100,monthlyCost:500,cost:100}});
  store.reserve({kind:'ai',user:owner.id,phone:'phonehash',travel:'travel',requestId:'first'});
  store.finishReservation('first','failed');
  assert.throws(()=>store.reserve({kind:'ai',user:owner.id,phone:'phonehash',travel:'travel',requestId:'second'}),{code:'usage_limit'});
});
test('session tokens are hashed, bounded, and expire', t => {
  let now=1000; const {store,owner}=setup(t,{now:()=>now}); let first;
  for(let i=0;i<11;i++) { const token=store.createSession(owner.id); first ||= token; }
  assert.equal(store.session(first),null);
  const token=store.createSession(owner.id); assert.equal(store.session(token).id,owner.id);
  now+=8*86400000; assert.equal(store.session(token),null);
});
test('storage quota rejects oversized replacement without changing original',t=>{
  const {store,owner}=setup(t,{maxUserBytes:500,maxTravelBytes:1000});const travel=store.createTravel(owner.id,snapshot());
  assert.throws(()=>store.saveTravel(owner.id,travel.id,{...travel.snapshot,name:'x'.repeat(400)},1),{code:'storage_limit'});
  assert.equal(store.getTravel(owner.id,travel.id).version,1);
});
test('account and travel count limits are enforced atomically',t=>{
  const {store,owner}=setup(t,{maxAccounts:2,maxTravels:1});
  assert.throws(()=>store.upsertUser({sub:'third'}),{code:'account_limit'});
  store.createTravel(owner.id,snapshot());assert.throws(()=>store.createTravel(owner.id,snapshot()),{code:'travel_limit'});
});
test('global storage and suggestion quotas reject excess without creating partial data',t=>{
  const {store,owner,other}=setup(t,{maxTotalBytes:600,maxSuggestions:1});const travel=store.createTravel(owner.id,snapshot());
  assert.throws(()=>store.createTravel(other.id,snapshot()),{code:'service_storage_limit'});
  const share=store.createShare(owner.id,travel.id,1);store.suggest(other.id,share.token,{name:'첫째'});
  assert.throws(()=>store.suggest(other.id,share.token,{name:'둘째'}),{code:'suggestion_limit'});
  assert.equal(store.listSuggestions(owner.id,travel.id).length,1);
});
test('share expires after 30 days and authentication flows are single-use and expire',t=>{
  let now=1000;const {store,owner}=setup(t,{now:()=>now}),travel=store.createTravel(owner.id,snapshot());
  const share=store.createShare(owner.id,travel.id,1),flow=store.putFlow({state:'state'});assert.equal(store.takeFlow(flow).state,'state');assert.equal(store.takeFlow(flow),null);
  const expired=store.putFlow({state:'expired'});now+=31*86400000;assert.equal(store.takeFlow(expired),null);assert.throws(()=>store.readShare(share.token),{code:'not_found'});
});
const budget={dailyCalls:100,monthlyCalls:200,dailyCost:10000,monthlyCost:20000,cost:100};
test('same verified phone across accounts cannot reset the daily AI limit',t=>{
  const {store,owner,other}=setup(t,{ai:budget});store.reserve({kind:'ai',user:owner.id,phone:'same-number',travel:'a',requestId:'a'});
  assert.throws(()=>store.reserve({kind:'ai',user:other.id,phone:'same-number',travel:'b',requestId:'b'}),{code:'daily_ai_limit'});
});
test('stale AI becomes failed on idempotent retry and does not release budget',t=>{
  let now=1000;const {store,owner}=setup(t,{ai:budget,now:()=>now}),args={kind:'ai',user:owner.id,phone:'p',travel:'t',requestId:'a',fingerprint:'same'};
  store.reserve(args);now+=181000;assert.equal(store.reserve(args).status,'failed');
  assert.throws(()=>store.reserve({...args,requestId:'b'}),{code:'daily_ai_limit'});
});
test('SMS five failed checks exhaust request and phone changes wait 30 days',t=>{
  let now=100000;const {store,owner}=setup(t,{sms:budget,now:()=>now});store.startPhone(owner.id,'+821012345678','network');
  for(let i=0;i<5;i++)store.checkPhone(owner.id);assert.throws(()=>store.checkPhone(owner.id),{code:'verification_expired'});
  now+=61000;store.startPhone(owner.id,'+821012345678','network');store.verifyPhone(owner.id,store.checkPhone(owner.id));
  now+=61000;assert.throws(()=>store.startPhone(owner.id,'+821087654321','network'),{code:'phone_change_wait'});
});
test('zero cost budget disables reservations',t=>{
  const {store,owner}=setup(t);assert.throws(()=>store.reserve({kind:'sms',user:owner.id,requestId:'a'}),{code:'service_disabled'});
});
test('eight SQLite connections racing for last global budget reserve exactly once',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'routeflow-race-')),dbPath=path.join(dir,'race.sqlite');
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const config={...accountConfig({}),dbPath,secret:'test-secret-32-characters-minimum-only',ai:{dailyCalls:1,monthlyCalls:1,dailyCost:100,monthlyCost:100,cost:100}};
  const initial=createAccountStore(config);initial.close();
  const storeUrl=new URL('../backend/store.js',import.meta.url).href;
  const workers=Array.from({length:8},(_,i)=>new Worker(`const {parentPort,workerData}=require('node:worker_threads'); (async()=>{ const {createAccountStore}=await import(workerData.storeUrl); const store=createAccountStore(workerData.config); parentPort.postMessage('ready'); parentPort.once('message',()=>{try{store.reserve({kind:'ai',user:String(workerData.i),phone:String(workerData.i),travel:String(workerData.i),requestId:String(workerData.i)});parentPort.postMessage('reserved');}catch(e){parentPort.postMessage(e.code || e.message);}finally{store.close();}});})().catch(e=>{throw e;});`,{eval:true,workerData:{storeUrl,config,i}}));
  t.after(()=>Promise.all(workers.map(worker=>worker.terminate())));
  await Promise.all(workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);})));const results=workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);}));workers.forEach(worker=>worker.postMessage('go'));
  const outcomes=await Promise.all(results);assert.equal(outcomes.filter(value=>value==='reserved').length,1);assert.equal(outcomes.filter(value=>value==='usage_limit').length,7);
  const sql=new DatabaseSync(dbPath);try{sql.exec('PRAGMA busy_timeout=5000');assert.equal(sql.prepare('SELECT count(*) AS n FROM reservations').get().n,1);}finally{sql.close();}
});
