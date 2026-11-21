const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {startMemberFixture}=require('./member-fixture.cjs');
const {createHash}=require('node:crypto');

(async()=>{
  const {accountConfig}=await import('../../backend/config.js');
  const {createAccountApi}=await import('../../backend/api.js');
  const {createStaticServer}=await import('../../tools/http-server.js');
  await fs.access(path.resolve('dist/release.json'));
  const evidence=path.resolve(process.env.ACCOUNT_OUT || '/tmp/routeflow-account-browser');
  await fs.mkdir(evidence,{recursive:true});
  const fixture=await startMemberFixture();
  const {origin,api}=fixture;
  const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chrome'}),headless:true});
  const results=[],errors=[];
  const release=JSON.parse(await fs.readFile('dist/release.json','utf8'));
  const backendHashes=Object.fromEntries(await Promise.all((await fs.readdir('backend')).filter(name=>name.endsWith('.js')).map(async name=>[name,createHash('sha256').update(await fs.readFile(path.join('backend',name))).digest('hex')])));
  async function newContext(options) {
    const context=await browser.newContext(options);
    await context.route('https://**/*',route=>route.abort());
    return context;
  }
  let owner,guest,companion;
  const openAccount=async page=>{await page.locator('[data-account-open]').first().click();await page.locator('#accountDialog').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('accountClose').disabled);};
  try {
    owner=await newContext({viewport:{width:1440,height:1000}});const page=await owner.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin + '/editor.html?action=new');
    await page.waitForURL(origin + '/');
    assert.equal(await page.locator('#travelDialog').count(),0);
    await page.locator('[data-city=seoul]').click();
    await page.locator('#stops [data-leg="1"]').click();
    assert.match(await page.textContent('#selectionTitle'),/북촌문화센터.*인사동/);
    assert.equal(await page.locator('#schematic [data-leg="1"]').getAttribute('aria-pressed'),'true');
    await page.locator('[data-city=tokyo]').click();
    await page.locator('#schematic [data-stop="2"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.textContent('#selectionTitle'),'스미다공원');
    assert.equal(await page.locator('#stops [data-stop="2"]').getAttribute('aria-pressed'),'true');
    await page.setViewportSize({width:390,height:844});
    await page.click('[data-view=list]');
    assert.equal(await page.locator('#stops [data-stop="0"]').isVisible(),true);
    await page.click('[data-view=map]');
    assert.equal(await page.locator('#schematic').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('[data-city=busan]').click();
    await page.setViewportSize({width:1440,height:1000});
    results.push({scenario:'three public examples link map and list selection by mouse and keyboard, with mobile view switching',pass:true});
    await page.locator('[data-action=copy]:visible').first().click();
    await page.click('#authCancel');
    assert.equal(await page.locator('#authDialog').isVisible(),false);
    assert.equal((await (await owner.request.get(origin + '/api/session')).json()).user,null);
    results.push({scenario:'direct anonymous editor request returns to public home and cancelled copy keeps session anonymous',pass:true});
    await page.locator('[data-action=copy]:visible').first().click();
    // Let the server finish the copy, then drop its response. The browser retries
    // the same operation after the user sees the failure message.
    let requestId;
    await page.route('**/api/examples/busan/copy', async route => {
      const id = route.request().postDataJSON().requestId;
      if (requestId) {
        assert.equal(id,requestId);
        return route.continue();
      }
      requestId = id;
      const response = await route.fetch();
      assert.equal(response.ok(),true);
      await route.abort('connectionreset');
    });
    await page.click('#authContinue');
    await page.waitForFunction(()=>document.querySelector('#homeStatus')?.textContent.includes('복사하지 못'));
    await page.locator('[data-action=copy]:visible').first().click();
    await page.waitForURL(/\/editor\.html\?travel=/);
    const accountId=new URL(page.url()).searchParams.get('travel');
    const user=(await (await owner.request.get(origin+'/api/session')).json()).user;
    const copied=api.store.getTravel(user.id,accountId);
    assert.equal(copied.snapshot.records.length,4);
    assert.equal(copied.snapshot.records[0].cells[copied.snapshot.mapping.name].v,'동백섬');
    const replay=await owner.request.post(origin+'/api/examples/busan/copy',{headers:{Origin:origin,'X-RouteFlow-Request':'1'},data:{requestId}});
    assert.equal((await replay.json()).travel.id,accountId);
    assert.equal(api.store.listTravels(user.id).length,1);
    await page.waitForSelector('[data-workspace-add]');
    results.push({scenario:'copy intent survives OAuth roundtrip; lost response, visible retry and replay preserve exactly one account travel',pass:true});
    await openAccount(page);
    for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(evidence,`account-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
    await page.click('#accountClose');await page.locator('[data-workspace-add]').click();await page.fill('#manualPlaceName','동네 산책');await page.fill('#manualPlaceMemo','오후에 가기');await page.click('#manualPlaceForm button');
    await page.waitForFunction(()=>document.getElementById('travelSaveStatus').textContent.includes('계정에 저장됨'));
    assert.equal(api.store.getTravel(user.id,accountId).snapshot.library[0].name,'동네 산책');
    assert.equal(await page.evaluate(()=>localStorage.getItem('routeflow.travels.v1')),null);
    results.push({scenario:'editing an example copy saves to SQLite without writing a device travel',pass:true});
    await openAccount(page);await page.click('#accountShareCreate');await page.waitForFunction(()=>document.getElementById('accountShareLink').value.includes('#share='));const share=await page.inputValue('#accountShareLink');await page.click('#accountClose');
    guest=await newContext({viewport:{width:390,height:844}});const shared=await guest.newPage();await shared.goto(share);
    assert.equal(await shared.locator('#sharedItinerary').count(),0);
    const shareToken=new URLSearchParams(new URL(share).hash.slice(1)).get('share');
    assert.equal((await guest.request.get(origin+'/api/shared/'+shareToken)).status(),401);
    const friend=api.store.upsertUser({sub:'friend-test',name:'테스트 동행자',email:'friend@example.test'});companion=await newContext();await companion.addCookies([{name:'routeflow_session',value:api.store.createSession(friend.id),url:origin,httpOnly:true,sameSite:'Lax'}]);const proposal=await companion.newPage();await proposal.goto(share);await proposal.waitForSelector('#sharedDialog[open]');await proposal.fill('#sharedPlaceName','동행자 카페');await proposal.fill('#sharedPlaceMemo','커피가 좋아요');await proposal.click('#sharedSuggestionForm button');await proposal.waitForFunction(()=>document.getElementById('sharedSuggestionStatus').textContent.includes('제안을 보냈어요'));
    await openAccount(page);await page.click('#accountSuggestionsRefresh');await page.locator('[data-accept-suggestion]').click();await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('후보로 수락'));
    assert.equal(api.store.getTravel(user.id,accountId).snapshot.library.some(p=>p.name==='동행자 카페'),true);results.push({scenario:'member-only fragment sharing and authenticated suggestion owner acceptance',pass:true});
    await page.click('#accountClose');await owner.setOffline(true);await page.locator('[data-workspace-add]').click();await page.fill('#manualPlaceName','오프라인 후보');await page.click('#manualPlaceForm button');await page.waitForFunction(()=>document.getElementById('travelSaveStatus').textContent.includes('저장 실패'));
    assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('routeflow.accountDraft.v1:'))),true);
    await openAccount(page);await page.click('#accountLogout');assert.equal(await page.locator('#accountContent').isVisible(),true);await owner.setOffline(false);await page.click('#accountRetry');await page.waitForFunction(()=>document.getElementById('accountStatus').textContent==='계정에 저장됨');results.push({scenario:'offline draft retained, logout blocked, retry succeeds',pass:true});
    const original=api.store.getTravel(user.id,accountId);api.store.saveTravel(user.id,accountId,{...original.snapshot,name:'다른 탭의 제목'},original.version);
    await page.click('#accountClose');await page.locator('[data-workspace-add]').click();await page.fill('#manualPlaceName','충돌 후보');await page.click('#manualPlaceForm button');await page.waitForFunction(()=>document.getElementById('travelSaveStatus').textContent.includes('다른 곳에서'));
    await page.reload();await page.waitForFunction(()=>document.getElementById('accountStatus').textContent.includes('다른 곳에서'));assert.equal(await page.locator('.workspace-place').filter({hasText:'충돌 후보'}).count(),1);
    await openAccount(page);page.once('dialog',d=>d.accept());await page.click('#accountLatest');await page.waitForFunction(()=>document.getElementById('accountStatus').textContent==='계정에 저장됨');assert.equal(await page.locator('.workspace-place').filter({hasText:'충돌 후보'}).count(),0);
    let releaseLogout;const logoutDelay=new Promise(resolve=>releaseLogout=resolve);
    await page.route('**/api/logout',async route=>{const response=await route.fetch();await logoutDelay;await route.fulfill({response});});
    await page.click('#accountLogout');await page.waitForFunction(()=>document.querySelector('.app-shell').inert);
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.getElementById('accountDialog').open),true);assert.equal(await page.locator('#accountClose').isDisabled(),true);
    releaseLogout();await page.waitForURL(origin+'/');assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('routeflow.accountDraft.v1:'))),false);results.push({scenario:'version conflict survives refresh, explicit latest and logout clear account draft; logout freezes edits and blocks Escape until response',pass:true});
    const revisionContext=await newContext({viewport:{width:1440,height:900}});
    await revisionContext.addCookies([{name:'routeflow_session',value:api.store.createSession(user.id),url:origin,httpOnly:true,sameSite:'Lax'}]);
    await revisionContext.addInitScript(id=>{
      const prefix='routeflow.user.'+encodeURIComponent(id)+':';
      localStorage.setItem(prefix+'plannerProvider','gemini');
      localStorage.setItem(prefix+'geminiApiKey','TEST_GEMINI_NOT_REAL');
    },user.id);
    const revisionSnapshot={id:'revision-fixture',name:'계정 AI 검증',updated:Date.now(),headers:['장소','날짜','시간','메모'],mapping:{name:0,date:1,category:1,time:2,memo:3,region:-1,address:-1,lat:-1,lng:-1,mode:-1},records:[{rowNumber:2,cells:[{v:'공원'},{v:'2026-11-10'},{v:'09:00'},{v:'원본 메모'}]},{rowNumber:3,cells:[{v:'미술관'},{v:'2026-11-10'},{v:'11:00'},{v:'전시 메모'}]}],dates:['2026-11-10'],library:[],places:[{recordIndex:0,place:{name:'공원',lat:33.58,lng:130.37,cachedAt:Date.now()},status:'manual'},{recordIndex:1,place:{name:'미술관',lat:33.59,lng:130.38,cachedAt:Date.now()},status:'manual'}],sheetName:'일정'};
    const revisionTravel=api.store.createTravel(user.id,revisionSnapshot);
    await revisionContext.route('https://generativelanguage.googleapis.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({summary:'미술관을 오후로 이동',items:[{id:'r0',name:'공원',time:'09:00',region:'',note:''},{id:'r1',name:'미술관',time:'14:00',region:'',note:''}]})}]}}]})}));
    const revision=await revisionContext.newPage();revision.on('pageerror',e=>errors.push(e.message));await revision.goto(origin+'/editor.html?travel='+revisionTravel.id);
    await revision.locator('[data-workspace-mode="map"]').click();await revision.click('#dayRevisionOpen');await revision.fill('#dayRevisionRequest','미술관을 오후 두 시로 변경');await revision.click('#dayRevisionGenerate');await revision.waitForFunction(()=>!document.getElementById('dayRevisionApply').disabled);
    let releasePut;let holdPut=true;let putDelay=new Promise(resolve=>releasePut=resolve);
    await revision.route(`**/api/travels/${revisionTravel.id}`,async route=>{if(route.request().method()!=='PUT')return route.continue();const response=await route.fetch();if(holdPut){holdPut=false;await putDelay;}await route.fulfill({response});});
    const firstPut=revision.waitForRequest(req=>req.method()==='PUT' && req.url().endsWith(revisionTravel.id));await revision.click('#dayRevisionApply');await firstPut;
    await revision.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true})));releasePut();await revision.waitForFunction(()=>!document.getElementById('dayRevisionDialog').open && document.getElementById('accountStatus').textContent==='계정에 저장됨');
    assert.equal(api.store.getTravel(user.id,revisionTravel.id).snapshot.records[1].cells[2].v,'14:00');assert.equal(await revision.evaluate(()=>localStorage.getItem('routeflow.travels.v1')),null);
    holdPut=true;putDelay=new Promise(resolve=>releasePut=resolve);const undoPut=revision.waitForRequest(req=>req.method()==='PUT' && req.url().endsWith(revisionTravel.id));await revision.click('#toastUndo');await undoPut;
    await revision.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true})));releasePut();await revision.waitForFunction(()=>document.getElementById('accountStatus').textContent==='계정에 저장됨');
    assert.deepEqual(api.store.getTravel(user.id,revisionTravel.id).snapshot.records,revisionTravel.snapshot.records);assert.equal(await revision.evaluate(()=>localStorage.getItem('routeflow.travels.v1')),null);
    results.push({scenario:'BYOK day revision apply and undo retain account-only storage during delayed PUT plus beforeunload (Gemini mocked)',pass:true});
    await revision.locator('[data-workspace-mode="board"]').click();await revision.locator('[data-workspace-action="edit"]').first().click();await revision.fill('#scheduleMemo','저장 전 편집 메모');
    await openAccount(revision);await revision.click('#accountLogout');await revision.waitForFunction(()=>document.getElementById('toast').textContent.includes('편집창을 닫은 뒤'));
    assert.equal(await revision.locator('#accountContent').isVisible(),true);assert.equal(await revision.inputValue('#scheduleMemo'),'저장 전 편집 메모');
    await revision.click('#accountClose');await revision.click('#scheduleForm button[type=submit]');await revision.waitForFunction(()=>document.getElementById('accountStatus').textContent==='계정에 저장됨');
    assert.equal(api.store.getTravel(user.id,revisionTravel.id).snapshot.records[0].cells[3].v,'저장 전 편집 메모');await openAccount(revision);await revision.click('#accountLogout');await revision.waitForURL(origin+'/');
    assert.equal(await revision.evaluate(()=>Object.keys(sessionStorage).some(key=>key.startsWith('routeflow.accountEditor.v1:'))),false);await revisionContext.close();
    results.push({scenario:'unsaved nonmodal editor blocks logout; saving retains memo and subsequent logout clears user-scoped editor drafts',pass:true});
    const disabledApi=createAccountApi({config:accountConfig({})});
    const disabledServer=createStaticServer({root:path.resolve('dist'),production:true,api:disabledApi.handle});
    await new Promise(resolve=>disabledServer.listen(0,'127.0.0.1',resolve));
    try {
      const disabledOrigin=`http://127.0.0.1:${disabledServer.address().port}`;
      const disabled=await newContext();const home=await disabled.newPage();
      for(const width of [390,768,1440]){
        await home.setViewportSize({width,height:900});await home.goto(disabledOrigin);await home.locator('[data-action=copy]:visible').first().click();
        await home.waitForSelector('#authDialog[open]');
        assert.equal(await home.locator('#authContinue').isEnabled() && await home.locator('#authContinue').isVisible(),false);
        await home.screenshot({path:path.join(evidence,`account-unavailable-${width}.png`),fullPage:true});
        await home.click('#authCancel');
      }
      await disabled.close();results.push({scenario:'unconfigured account service keeps examples readable and prevents unavailable login at 390/768/1440',pass:true});
    } finally {disabledServer.closeAllConnections();await new Promise(resolve=>disabledServer.close(resolve));disabledApi.close();}
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify({date:new Date().toISOString(),release,backendHashes,boundary:'Real local production static assets + HTTP API + SQLite; mocked Google provider only; no real OAuth SMS or AI calls.',results,errors},null,2));
    console.log(JSON.stringify({passed:results.length,results},null,2));
  } finally {await browser.close();await fixture.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
