// Optional paid live check. No mocks, persistent browser profile, or credential output.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const BASE=process.env.APP_URL||'http://127.0.0.1:8093';
const OUT=process.env.GOOGLE_LIVE_OUT||'/tmp/routeflow-google-live.json';
const secrets=[process.env.googlemap,process.env.geminiapi].filter(Boolean);
const clean=value=>secrets.reduce((s,key)=>s.split(key).join('[REDACTED]'),String(value));
(async()=>{
 assert(process.env.googlemap,'Google environment key required');
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}:undefined,args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const result={mode:'실제 Google Maps·Places·Routes; 새 테스트 브라우저 BYOK, 모의 응답 없음',responses:[],errors:[]};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900},locale:'ko-KR'});
  await page.addInitScript(key=>localStorage.setItem('googleMapsApiKey',key),process.env.googlemap);
  page.on('pageerror',e=>result.errors.push(clean(e.message)));
  page.on('response',r=>{const u=new URL(r.url());if(/SearchText|ComputeRoutes/.test(u.pathname))result.responses.push({service:u.pathname.split('/').pop(),http:r.status()});});
  await page.goto(BASE);await page.waitForFunction(()=>document.querySelector('#syncText').textContent==='지도 연결됨',null,{timeout:45000});
  result.check=await page.evaluate(async()=>{
   const {searchPlaces,clearCache}=await import('/js/places.js');const {computeLeg,clearRouteCache,isRouteCached}=await import('/js/routes.js');clearCache();clearRouteCache();
   const origin=(await searchPlaces('후쿠오카 오호리 공원',{language:'ko',region:'jp'}))[0];
   const destination=(await searchPlaces('후쿠오카시 미술관',{language:'ko',region:'jp'}))[0];
   if(!origin||!destination)throw new Error('실제 장소 검색 결과 없음');
   const options={mode:'WALKING',origin,destination,language:'ko',region:'jp'};
   const route=await computeLeg(options);const cached=isRouteCached(options);const second=await computeLeg(options);
   return{origin:{name:origin.name,lat:origin.lat,lng:origin.lng},destination:{name:destination.name,lat:destination.lat,lng:destination.lng},route:route&&{distance:route.distance,duration:route.duration,segments:route.segments.length},cached,repeatedSame:JSON.stringify(route)===JSON.stringify(second),mapRendered:!!document.querySelector('#map .gm-style'),mockPresent:!!window.__mock};
  });
  assert(result.check.mapRendered&&!result.check.mockPresent);assert(result.check.route?.distance>0&&result.check.route?.duration>0);assert(result.check.cached&&result.check.repeatedSame);assert(result.responses.some(r=>r.service.includes('ComputeRoutes')&&r.http===200));assert.deepEqual(result.errors,[]);result.completed=true;
 }catch(e){result.completed=false;result.error=clean(e.message);process.exitCode=1;}
 finally{fs.writeFileSync(OUT,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await browser.close();}
})().catch(e=>{console.error(clean(e.message));process.exitCode=1;});
