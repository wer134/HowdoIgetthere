import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { accountConfig } from '../backend/config.js';
import { createAccountApi } from '../backend/api.js';
import { createStaticServer } from '../tools/http-server.js';

const snapshot = () => ({id:'guest',name:'테스트 여행',updated:1,headers:['장소','시간'],records:[{rowNumber:2,cells:[{v:'공원'},{v:0.5,f:'A1+1',t:'n',w:'12:00'}]}],mapping:{name:0,date:-1,category:-1,time:1,region:-1,memo:-1,address:-1,lat:-1,lng:-1,mode:-1},library:[],dates:[],places:[]});
async function setup(t,overrides={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'routeflow-account-'));
  const config={...accountConfig({}),available:true,secret:'test-secret-32-characters-minimum-only',dbPath:path.join(dir,'test.sqlite'),origin:'http://127.0.0.1',...overrides};
  const calls={sms:0,ai:0,exchange:0,authorize:0};let flow;
  const providers={
    async authorizationUrl(value){calls.authorize++;flow=value;return 'https://identity.example.test/login';},
    async exchange(url,value){calls.exchange++;assert.equal(value.state,flow.state);return {sub:'oidc-user',name:'OIDC',email:'oidc@example.test'};},
    async startVerification(){calls.sms++;},async checkVerification(phone,code){return code==='123456';},
    async generate(){calls.ai++;return '공원에서 산책하세요.';},
  };
  const api=createAccountApi({config,providers}),server=createStaticServer({root:path.resolve('.'),api:api.handle});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));config.origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));api.close();await fs.rm(dir,{recursive:true,force:true});});
  const owner=api.store?.upsertUser({sub:'owner',name:'Owner',email:'owner@example.test'}),other=api.store?.upsertUser({sub:'other',name:'Other',email:'other@example.test'});
  const ownerCookie=api.store?`routeflow_session=${api.store.createSession(owner.id)}`:'',otherCookie=api.store?`routeflow_session=${api.store.createSession(other.id)}`:'';
  const request=async(route,{method='GET',data,cookie=ownerCookie,headers={}}={})=>{
    const response=await fetch(config.origin+route,{method,redirect:'manual',headers:{Cookie:cookie,Origin:config.origin,'X-RouteFlow-Request':'1','Content-Type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const text=await response.text();return {status:response.status,headers:response.headers,data:text?JSON.parse(text):null};
  };
  return {config,api,providers,calls,request,owner,other,ownerCookie,otherCookie,flow:()=>flow};
}
test('real HTTP session/CRUD protects ownership, version, formula metadata and field whitelist',async t=>{
  const f=await setup(t);const session=await f.request('/api/session');assert.equal(session.data.user.id,f.owner.id);assert.equal(session.headers.get('cache-control'),'no-store');
  const created=await f.request('/api/travels',{method:'POST',data:{snapshot:{...snapshot(),secret:'must disappear'}}});assert.equal(created.status,201);
  const travel=created.data.travel;assert.notEqual(travel.id,'guest');assert.equal(travel.snapshot.records[0].cells[1].f,'A1+1');assert.equal(travel.snapshot.secret,undefined);
  assert.equal((await f.request(`/api/travels/${travel.id}`,{cookie:f.otherCookie})).status,404);
  assert.equal((await f.request(`/api/travels/${travel.id}`,{method:'PUT',data:{snapshot:travel.snapshot,version:0}})).status,409);
  assert.equal((await f.request(`/api/travels/${travel.id}`,{method:'PUT',data:{snapshot:{...travel.snapshot,name:'다음'},version:1}})).data.travel.version,2);
});
test('mutation rejects foreign Origin, missing marker, missing session and oversized body',async t=>{
  const f=await setup(t);
  for(const headers of [{Origin:'https://attacker.example'},{'X-RouteFlow-Request':''}])assert.equal((await f.request('/api/travels',{method:'POST',data:{snapshot:snapshot()},headers})).status,403);
  assert.equal((await f.request('/api/travels',{method:'POST',data:{snapshot:snapshot()},cookie:''})).status,401);
  assert.equal((await f.request('/api/travels',{method:'POST',data:{snapshot:snapshot(),padding:'x'.repeat(2200000)}})).status,413);
  const response=await new Promise((resolve,reject)=>http.get(f.config.origin+'/api/session',{headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));assert.equal(response,403);
});
test('OIDC state is single-use, bad state never reaches provider, logout revokes session',async t=>{
  const f=await setup(t);let login=await f.request('/api/auth/login',{cookie:''});assert.equal(login.status,302);assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  const flowCookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.request('/api/auth/callback?state=wrong&code=test',{cookie:flowCookie})).status,400);assert.equal(f.calls.exchange,0);
  assert.equal((await f.request(`/api/auth/callback?state=${f.flow().state}&code=test`,{cookie:flowCookie})).status,400);
  login=await f.request('/api/auth/login',{cookie:''});const result=await f.request(`/api/auth/callback?state=${f.flow().state}&code=test`,{cookie:login.headers.get('set-cookie').split(';')[0]});assert.equal(result.status,302);assert.equal(f.calls.exchange,1);
  assert.equal((await f.request('/api/logout',{method:'POST',data:{}})).status,200);assert.equal((await f.request('/api/session')).data.user,null);
});
test('share reads without login, proposals require login, acceptance is owner-version gated',async t=>{
  const f=await setup(t);const {travel}=(await f.request('/api/travels',{method:'POST',data:{snapshot:snapshot()}})).data;
  const share=(await f.request(`/api/travels/${travel.id}/share`,{method:'POST',data:{version:1}})).data;
  assert.equal((await f.request(`/api/shared/${share.token}`,{cookie:''})).data.snapshot.name,travel.snapshot.name);
  assert.equal((await f.request(`/api/shared/${share.token}/suggestions`,{method:'POST',data:{place:{name:'카페'}},cookie:''})).status,401);
  const suggestion=(await f.request(`/api/shared/${share.token}/suggestions`,{method:'POST',data:{place:{name:'카페',memo:'메모'}},cookie:f.otherCookie})).data;
  assert.equal((await f.request(`/api/travels/${travel.id}/suggestions/${suggestion.id}/accept`,{method:'POST',data:{version:1},cookie:f.otherCookie})).status,404);
  const accepted=await f.request(`/api/travels/${travel.id}/suggestions/${suggestion.id}/accept`,{method:'POST',data:{version:1}});assert.equal(accepted.data.travel.snapshot.library[0].memo,'메모');
  await f.request(`/api/travels/${travel.id}/share`,{method:'DELETE',data:{}});assert.equal((await f.request(`/api/shared/${share.token}`,{cookie:''})).status,404);
});
const budgets={dailyCalls:100,monthlyCalls:200,dailyCost:10000,monthlyCost:20000,cost:100};
const paidConfig={sms:budgets,ai:budgets,freeAI:true,twilioAccount:'test',twilioToken:'test',twilioService:'test'};
test('SMS reserves before provider, phone checks are bounded, AI is idempotent and number/account/travel limited',async t=>{
  const f=await setup(t,paidConfig);const {travel}=(await f.request('/api/travels',{method:'POST',data:{snapshot:snapshot()}})).data;
  const requestId=randomUUID();assert.equal((await f.request(`/api/travels/${travel.id}/ai`,{method:'POST',data:{requestId,prompt:'일정 추천'}})).status,403);
  assert.equal((await f.request('/api/phone/start',{method:'POST',data:{phone:'01012345678'}})).status,200);assert.equal(f.calls.sms,1);
  assert.equal((await f.request('/api/phone/start',{method:'POST',data:{phone:'01012345678'}})).status,429);assert.equal(f.calls.sms,1);
  assert.equal((await f.request('/api/phone/check',{method:'POST',data:{code:'000000'}})).status,400);
  assert.equal((await f.request('/api/phone/check',{method:'POST',data:{code:'123456'}})).status,200);
  assert.equal((await f.request('/api/session')).data.user.phoneVerified,true);
  const first=await f.request(`/api/travels/${travel.id}/ai`,{method:'POST',data:{requestId,prompt:'일정 추천'}});assert.equal(first.data.status,'completed');
  const second=await f.request(`/api/travels/${travel.id}/ai`,{method:'POST',data:{requestId,prompt:'일정 추천'}});assert.equal(second.data.text,first.data.text);assert.equal(f.calls.ai,1);
  assert.equal((await f.request(`/api/travels/${travel.id}/ai`,{method:'POST',data:{requestId,prompt:'다른 내용'}})).status,409);
  assert.equal((await f.request(`/api/travels/${travel.id}/ai`,{method:'POST',data:{requestId:randomUUID(),prompt:'일정 추천'}})).status,429);
});
test('failed external AI remains charged and failed duplicate is not invoked again',async t=>{
  const f=await setup(t,paidConfig);const travel=f.api.store.createTravel(f.owner.id,snapshot());
  f.api.store.startPhone(f.owner.id,'+821012345678','network');f.api.store.verifyPhone(f.owner.id,f.api.store.checkPhone(f.owner.id));
  f.providers.generate=async()=>{f.calls.ai++;throw new Error('provider failure sensitive detail');};const requestId=randomUUID();
  const first=await f.request(`/api/travels/${travel.id}/ai`,{method:'POST',data:{requestId,prompt:'일정'}});assert.equal(first.status,502);assert.doesNotMatch(JSON.stringify(first.data),/sensitive/);
  assert.equal((await f.request(`/api/travels/${travel.id}/ai`,{method:'POST',data:{requestId,prompt:'일정'}})).data.status,'failed');assert.equal(f.calls.ai,1);
  assert.equal((await f.request(`/api/travels/${travel.id}/ai`,{method:'POST',data:{requestId:randomUUID(),prompt:'일정'}})).status,429);
});
test('default service budgets and unconfigured account API fail closed',async t=>{
  const f=await setup(t,{available:false});assert.deepEqual((await f.request('/api/session',{cookie:''})).data,{available:false,user:null,freeAI:false});assert.equal((await f.request('/api/travels')).status,503);
});
test('login initiation is rate limited by trusted canonical network before provider calls',async t=>{
  const f=await setup(t,{trustedProxies:['127.0.0.1']});
  for(let i=0;i<10;i++)assert.equal((await f.request('/api/auth/login',{cookie:'',headers:{'X-Forwarded-For':`2001:db8::${i+1}`}})).status,302);
  const denied=await f.request('/api/auth/login',{cookie:'',headers:{'X-Forwarded-For':'2001:0DB8:0000:0000::ffff'}});assert.equal(denied.status,429);assert.equal(denied.data.error,'login_rate_limit');assert.equal(f.calls.authorize,10);
  assert.equal((await f.request('/api/auth/login',{cookie:'',headers:{'X-Forwarded-For':'2001:db8:0:1::1'}})).status,302);
});
test('untrusted forwarded headers cannot reset login initiation limits',async t=>{
  const f=await setup(t);
  for(let i=0;i<10;i++)await f.request('/api/auth/login',{cookie:'',headers:{'X-Forwarded-For':`192.0.2.${i+1}`}});
  assert.equal((await f.request('/api/auth/login',{cookie:'',headers:{'X-Forwarded-For':'198.51.100.1'}})).status,429);assert.equal(f.calls.authorize,10);
});
