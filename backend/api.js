import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { accountConfig } from './config.js';
import { createAccountStore } from './store.js';
import { createProviders } from './providers.js';
import { ApiError, requireValue } from './errors.js';
import { networkAddress } from './network.js';

function cookies(header='') {return Object.fromEntries(header.split(';').map(part=>part.trim().split('=')).filter(pair=>pair.length===2));}
async function body(req,maxBytes) {
  requireValue(/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''),415,'json_required');
  requireValue(!req.headers['content-encoding'] || req.headers['content-encoding']==='identity',415,'encoding_not_supported');
  requireValue(!req.headers['content-length'] || Number(req.headers['content-length'])<=maxBytes,413,'body_too_large');
  let size=0;const chunks=[];
  for await (const chunk of req){size+=chunk.length;requireValue(size<=maxBytes,413,'body_too_large');chunks.push(chunk);}
  let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'invalid_json');}
  requireValue(value && typeof value==='object' && !Array.isArray(value),400,'invalid_json');return value;
}
export function createAccountApi({config=accountConfig(),providers,store}={}) {
  const db=store || (config.available?createAccountStore(config):null), external=providers || createProviders(config);
  const sessionCookie=config.secure?'__Host-routeflow_session':'routeflow_session',flowCookie=config.secure?'__Host-routeflow_flow':'routeflow_flow';
  function cookie(name,value,age){return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.secure?'; Secure':''}`;}
  function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
  function network(req) {
    const socket=req.socket.remoteAddress || 'unknown';
    const forwarded=config.trustedProxies.includes(socket)?String(req.headers['x-forwarded-for'] || '').split(',')[0].trim():'';
    return db.hash(networkAddress(isIP(forwarded)?forwarded:socket));
  }
  async function handle(req,res) {
    let url;try{url=new URL(req.url,config.origin || 'http://localhost');}catch{return false;}
    if(!url.pathname.startsWith('/api/'))return false;
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    try {
      if(config.origin)requireValue(req.headers.host===new URL(config.origin).host,403,'invalid_host');
      const sessionToken=cookies(req.headers.cookie)[sessionCookie],user=db?.session(sessionToken) || null;
      if(req.method==='GET' && url.pathname==='/api/session'){send(res,200,{available:config.available,user,freeAI:config.available && config.freeAI});return true;}
      requireValue(config.available,503,'accounts_unavailable');
      if(!['GET','HEAD'].includes(req.method))requireValue(req.headers.origin===config.origin && req.headers['x-routeflow-request']==='1',403,'invalid_origin');
      const route=url.pathname.split('/').filter(Boolean);
      if(req.method==='GET' && url.pathname==='/api/auth/login') {
        requireValue(!req.headers.origin || req.headers.origin===config.origin,403,'invalid_origin');
        const flow={state:randomBytes(32).toString('base64url'),nonce:randomBytes(32).toString('base64url'),verifier:randomBytes(32).toString('base64url')};
        const raw=db.putFlow(flow,network(req));
        let location;try{location=await external.authorizationUrl(flow);}catch(error){db.takeFlow(raw);throw error;}
        res.setHeader('Set-Cookie',cookie(flowCookie,raw,600));res.writeHead(302,{Location:location});res.end();return true;
      }
      if(req.method==='GET' && url.pathname==='/api/auth/callback') {
        const flow=db.takeFlow(cookies(req.headers.cookie)[flowCookie]);res.setHeader('Set-Cookie',cookie(flowCookie,'',0));
        requireValue(flow && url.searchParams.get('state')===flow.state && !url.searchParams.has('error'),400,'invalid_auth_flow');
        const identity=await external.exchange(url,flow),account=db.upsertUser(identity),raw=db.createSession(account.id);
        res.setHeader('Set-Cookie',[cookie(flowCookie,'',0),cookie(sessionCookie,raw,7*86400)]);res.writeHead(302,{Location:config.origin+'/'});res.end();return true;
      }
      if(req.method==='POST' && url.pathname==='/api/logout'){db.logout(sessionToken);res.setHeader('Set-Cookie',cookie(sessionCookie,'',0));send(res,200,{ok:true});return true;}
      if(req.method==='GET' && route[1]==='shared' && route.length===3){send(res,200,db.readShare(route[2]));return true;}
      requireValue(user,401,'login_required');
      const data=['POST','PUT','DELETE'].includes(req.method)?await body(req,config.maxTravelBytes+16384):{};
      if(route[1]==='travels' && route.length===2) {
        if(req.method==='GET'){send(res,200,{travels:db.listTravels(user.id)});return true;}
        if(req.method==='POST'){send(res,201,{travel:db.createTravel(user.id,data.snapshot)});return true;}
      }
      if(route[1]==='travels' && route.length>=3) {
        const id=route[2];
        if(route.length===3){
          if(req.method==='GET'){send(res,200,{travel:db.getTravel(user.id,id)});return true;}
          if(req.method==='PUT'){send(res,200,{travel:db.saveTravel(user.id,id,data.snapshot,data.version)});return true;}
          if(req.method==='DELETE'){send(res,200,db.deleteTravel(user.id,id,data.version));return true;}
        }
        if(route.length===4 && route[3]==='share') {
          if(req.method==='POST'){send(res,200,db.createShare(user.id,id,data.version));return true;}
          if(req.method==='DELETE'){send(res,200,db.revokeShare(user.id,id));return true;}
        }
        if(route.length===4 && route[3]==='suggestions' && req.method==='GET'){send(res,200,{suggestions:db.listSuggestions(user.id,id)});return true;}
        if(route.length===6 && route[3]==='suggestions' && route[5]==='accept' && req.method==='POST'){send(res,200,{travel:db.acceptSuggestion(user.id,id,route[4],data.version)});return true;}
        if(route.length===4 && route[3]==='ai' && req.method==='POST') {
          requireValue(config.freeAI,503,'ai_disabled');
          requireValue(typeof data.requestId==='string' && /^[0-9a-f-]{36}$/i.test(data.requestId),400,'invalid_request_id');
          requireValue(typeof data.prompt==='string' && data.prompt.trim().length>0 && data.prompt.length<=config.aiInputChars,400,'invalid_prompt');
          const phone=db.aiIdentity(user.id,id),reservation=db.reserve({kind:'ai',user:user.id,phone,travel:id,requestId:data.requestId,fingerprint:db.hash(data.prompt)});
          if(reservation.reused){send(res,200,db.reservation(user.id,data.requestId));return true;}
          try {const text=await external.generate(data.prompt);requireValue(typeof text==='string' && text.length<=config.aiOutputTokens*12,502,'invalid_ai_result');db.finishReservation(data.requestId,'completed',text);}
          catch(error){db.finishReservation(data.requestId,'failed');throw error;}
          send(res,200,db.reservation(user.id,data.requestId));return true;
        }
      }
      if(route.length===4 && route[1]==='shared' && route[3]==='suggestions' && req.method==='POST'){send(res,201,db.suggest(user.id,route[2],data.place));return true;}
      if(req.method==='POST' && url.pathname==='/api/phone/start') {
        requireValue(config.twilioAccount && config.twilioToken && config.twilioService,503,'sms_disabled');
        requireValue(typeof data.phone==='string' && data.phone.length<=40,400,'invalid_phone');
        const phone=parsePhoneNumberFromString(data.phone,config.countries[0]);
        requireValue(phone?.isValid() && phone.getType()==='MOBILE' && config.countries.includes(phone.country),400,'mobile_phone_required');
        db.startPhone(user.id,phone.number,network(req));await external.startVerification(phone.number);send(res,200,{ok:true});return true;
      }
      if(req.method==='POST' && url.pathname==='/api/phone/check') {
        requireValue(typeof data.code==='string' && /^\d{4,10}$/.test(data.code),400,'invalid_code');
        const pending=db.checkPhone(user.id);requireValue(await external.checkVerification(pending.phone,data.code),400,'incorrect_code');send(res,200,db.verifyPhone(user.id,pending));return true;
      }
      throw new ApiError(404,'not_found');
    } catch(error) {
      if(!res.headersSent)send(res,error instanceof ApiError?error.status:502,{error:error instanceof ApiError?error.code:'service_error',message:error instanceof ApiError?error.message:'서비스 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'});else res.end();
      return true;
    }
  }
  return {handle,store:db,close(){db?.close();}};
}
