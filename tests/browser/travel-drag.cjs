const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});try{
 const c=await browser.newContext({viewport:{width:1440,height:900}}),base=process.env.APP_URL||'http://127.0.0.1:8093';await c.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());const p=await c.newPage();p.setDefaultTimeout(5000);await p.goto(base);
 await p.click('#newTravel');await p.fill('#travelName','검색 후 드래그');await p.fill('#travelStart','2026-11-07');await p.click('#newTravelForm button');
 for(const name of ['첫 장소','둘째 장소']){await p.click('#scheduleAdd');await p.fill('#scheduleName',name);await p.fill('#scheduleDate','2026-11-07');await p.click('#scheduleForm button[type=submit]');await p.click('#placePanelClose');}
 await p.fill('#workspaceSearch','없는 검색어');await p.fill('#workspaceSearch','');
 assert.deepEqual(await p.locator('#resultList > li.item').evaluateAll(es=>es.map(e=>e.draggable)),[true,true]);
 const first=p.locator('#resultList > li.item').first(),second=p.locator('#resultList > li.item').nth(1);await second.scrollIntoViewIfNeeded();await first.scrollIntoViewIfNeeded();
 await p.evaluate(()=>{window.dragEvents=[];for(const event of ['dragstart','drop'])document.addEventListener(event,()=>dragEvents.push(event));});
 await second.dragTo(first,{sourcePosition:{x:20,y:25},targetPosition:{x:20,y:25}});await p.click('#travelAssignForm button');
 assert.deepEqual(await p.locator('#resultList .item-name').allTextContents(),['둘째 장소','첫 장소']);assert.deepEqual(await p.evaluate(()=>dragEvents),['dragstart','drop']);
 console.log('빈 검색 → 직접 입력 지우기 → 실제 드래그 → 순서 변경 PASS');
 if(process.env.RESULT_PATH)fs.writeFileSync(process.env.RESULT_PATH,JSON.stringify({status:'통과',nativeEvents:await p.evaluate(()=>dragEvents)},null,2));
 await c.close();
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
