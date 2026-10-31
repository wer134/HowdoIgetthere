const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const BASE=process.env.APP_URL||'http://127.0.0.1:8093';
const OUT=process.env.JOURNEY_OUT||'/tmp/routeflow-review/journey';
fs.mkdirSync(OUT,{recursive:true});
const store=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('routeflow.travels.v1')||'{}'));
const waitSave=p=>p.waitForFunction(()=>document.querySelector('#travelSaveStatus').textContent.includes('이 기기에 저장됨'));
async function download(p,selector){const promise=p.waitForEvent('download');await p.click(selector);const d=await promise;const target=path.join(OUT,d.suggestedFilename());await d.saveAs(target);return target;}
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const results=[];
 try{for(const width of [1440,390]){
  const c=await browser.newContext({viewport:{width,height:900},locale:'ko-KR'});const external=[];
  await c.route('**/*',r=>r.request().url().startsWith(BASE)||r.request().url().startsWith('blob:')?r.continue():(external.push(r.request().url().split('?')[0]),r.abort()));
  const p=await c.newPage();p.setDefaultTimeout(7000);const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(BASE);
  await p.screenshot({path:path.join(OUT,`${width}-start.png`),fullPage:true});
  await p.click('#newTravel');assert.match(await p.inputValue('#travelStart'),/^\d{4}-\d{2}-\d{2}$/);
  await p.fill('#travelName','부산 주말 여행');await p.fill('#travelStart','2026-11-07');await p.click('#newTravelForm button');
  assert.equal(await p.locator('#scheduleAdd').isVisible(),true);assert.equal(await p.locator('#runBtn').isVisible(),false);
  await p.click('#travelLibraryTab');
  for(const [name,memo]of [['해운대 해변','일몰 산책'],['같은 이름','첫 후보'],['같은 이름','둘째 후보']]){
   await p.click('#manualPlaceAdd');await p.fill('#manualPlaceName',name);await p.fill('#manualPlaceAddress','부산 해운대구');await p.fill('#manualPlaceMemo',memo);await p.click('#manualPlaceForm button');
  }
  assert.equal(await p.locator('[data-library]').count(),3);
  await p.locator('[data-travel-add]').first().click();await p.fill('#travelAssignDay','2026-11-08');await p.click('#travelAssignForm button');
  assert.deepEqual(await p.locator('#resultList .item-name').allTextContents(),['해운대 해변']);
  await p.locator('#resultList [data-action="edit"]').first().click();await p.fill('#scheduleTime','17:00–18:00');await p.fill('#scheduleMemo','일몰 산책\n근처 저녁 식사');await p.click('#scheduleForm button[type=submit]');
  await p.click('#placePanelClose');await p.click('#renameTravel');await p.fill('#renameTravelName','부산 느긋한 주말');await p.click('#renameTravelForm button');await waitSave(p);
  await p.fill('#workspaceSearch','없는 장소');await p.click('[data-reset-filters]');assert.equal(await p.locator('#resultList > li.item').count(),1);
  const before=Object.values(await store(p))[0];assert.equal(before.library.length,3);assert.equal(before.name,'부산 느긋한 주말');
  if(width<950)await p.click('#mobileSave');else await p.locator('[data-open="workspaceTools"]:visible').first().click();
  const backup=await download(p,width<950?'#mobileTravelBackup':'#travelBackup');
  const json=JSON.parse(fs.readFileSync(backup,'utf8'));assert.equal(json.travel.library.length,3);assert.equal(json.travel.records.length,1);assert.ok(!/ApiKey|apiKey/.test(JSON.stringify(json)));
  await p.click(width<950?'#mobileTravelItinerary':'#travelItinerary');
  assert.match(await p.textContent('#itineraryPreview'),/일몰 산책/);assert.match(await p.textContent('#itineraryPreview'),/아직 정한 일정/);
  const html=await download(p,'#saveItinerary');await p.screenshot({path:path.join(OUT,`${width}-itinerary.png`),fullPage:true});
  if(width===1440){await p.emulateMedia({media:'print'});await p.pdf({path:path.join(OUT,'itinerary.pdf'),format:'A4',printBackground:true});await p.emulateMedia({media:'screen'});}
  await p.locator('#travelItineraryDialog .dialog-x').click();
  await p.setInputFiles('#travelBackupInput',{name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{oops')});await p.waitForTimeout(100);assert.equal(await p.textContent('#fileName'),before.name);assert.match(await p.textContent('#toast'),/読|읽을 수 없/);
  await p.setInputFiles('#travelBackupInput',backup);await p.waitForFunction(()=>document.querySelector('#fileName').textContent.endsWith('(복원본)'));
  const after=Object.values(await store(p));assert.equal(after.length,2);const restored=after.find(t=>t.id!==before.id);assert.deepEqual(restored.records,before.records);assert.deepEqual(restored.library,before.library);
  await p.screenshot({path:path.join(OUT,`${width}-restored.png`),fullPage:true});
  const restoredName=await p.textContent('#fileName');
  await p.setInputFiles('#travelBackupInput',{name:'future.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...json,version:99}))});await p.waitForTimeout(100);
  assert.equal(await p.textContent('#fileName'),restoredName);assert.equal(Object.keys(await store(p)).length,2);assert.match(await p.textContent('#toast'),/지원하는/);
  await p.evaluate(()=>{const original=Storage.prototype.setItem;window.__restoreStorage=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(k,v){if(k==='routeflow.travels.v1')throw new DOMException('full','QuotaExceededError');return original.call(this,k,v);};});
  await p.setInputFiles('#travelBackupInput',backup);await p.waitForTimeout(600);assert.equal(await p.textContent('#fileName'),restoredName);assert.equal(Object.keys(await store(p)).length,2);assert.match(await p.textContent('#toast'),/저장할 수 없|저장하지 못/);await p.evaluate(()=>__restoreStorage());
  // Another browser context has neither API keys nor the original storage.
  const fresh=await browser.newContext({viewport:{width,height:900}});await fresh.route('**/*',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());const q=await fresh.newPage();await q.goto(BASE);await q.setInputFiles('#travelBackupInput',backup);await q.waitForFunction(()=>document.querySelector('#fileName').textContent.endsWith('(복원본)'));assert.equal(Object.values(await store(q))[0].library.length,3);
  await q.reload();await q.click('#continueTravel');assert.equal(await q.locator('#resultList > li.item').count(),1);
  await q.reload();await q.evaluate(()=>{const key='routeflow.travels.v1', data=JSON.parse(localStorage.getItem(key));const t=Object.values(data)[0];t.library[0]={id:'expired',name:'오래된 후보',memo:'내 예약 메모',cachedAt:Date.now()-31*86400000};localStorage.setItem(key,JSON.stringify(data));});await q.click('#continueTravel');await q.click('#travelLibraryTab');assert.equal(await q.locator('[data-travel-note]').first().inputValue(),'내 예약 메모');await fresh.close();
  const offline=await browser.newContext();const op=await offline.newPage();await op.route('**/*',r=>r.abort());await op.setContent(fs.readFileSync(html,'utf8'));assert.match(await op.textContent('body'),/부산 느긋한 주말/);assert.match(await op.textContent('body'),/둘째 후보/);assert.equal(await op.locator('script').count(),0);await offline.close();
  assert.deepEqual(errors,[]);results.push({width,status:'통과',externalGoogleRequests:external.filter(u=>u.includes('maps.googleapis')).length,steps:['지도 없이 생성·후보 3곳 보관·중복 이름 보존','날짜 배치·시간/메모 수정·이름 변경','빈 검색 복구','전체 백업·손상 백업 거부·원본 보존 복원','다른 컨텍스트 복원·최근 여행 재시작·만료 장소의 개인 메모 보존','미지원 백업/저장 실패 시 기존 여행 보존','오프라인 일정표·인쇄 PDF 생성']});console.log(width,'PASS');await c.close();
 }fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(results,null,2));}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
