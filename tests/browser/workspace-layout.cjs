const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const dates = ['2026-11-28','2026-11-29','2026-11-30','2026-12-01','2026-12-02'];
const fixture = () => ({id:'layout-five-day-test',name:'후쿠오카 · 긴 역 이름과 왕복 이동을 포함한 5일 여행',updated:Date.now(),headers:['장소','날짜','시간','메모','개인 열'],mapping:{name:0,date:1,time:2,memo:3,category:-1,region:-1,address:-1,lat:-1,lng:-1,mode:-1},dates,library:[],records:dates.flatMap((day,d)=>Array.from({length:8},(_,i)=>({rowNumber:d*8+i+2,cells:[{v:`하카타역 지하철 공항선 · ${d+1}일 ${i+1}번째 이동과 환승 확인`},{v:day},{v:'09:30~10:15'},{v:'출구와 승강장을 확인하고 일행을 만난 뒤 다음 목적지로 이동합니다. 긴 메모도 카드 안에서 읽을 수 있어야 합니다.'},{v:'개인 기록'}]}))),places:[],sheetName:'일정'});

(async()=>{
  const {createStaticServer} = await import('../../tools/http-server.js');
  const root=path.resolve(process.env.BOARD_ASSET_ROOT || 'dist');
  const out=path.resolve(process.env.WORKSPACE_OUT || 'docs/testing/evidence/repeated-places-layout/board');
  await fs.mkdir(out,{recursive:true});
  let release=null;
  try {release=JSON.parse(await fs.readFile(path.join(root,'release.json'),'utf8'));} catch {}
  const server=createStaticServer({root,production:!!release});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const result={status:'FAIL',time:new Date().toISOString(),assetRoot:root,release,providers:'no external calls; local guest storage, generated XLSX, account HTTP responses mocked for logout/reset only',checks:[],viewports:[]};
  let browser;
  try {
    browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chrome'});
    const context=await browser.newContext({viewport:{width:1920,height:1020}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('https://**/*',route=>route.abort());
    await page.addInitScript(value=>{if(!localStorage.getItem('routeflow.travels.v1'))localStorage.setItem('routeflow.travels.v1',JSON.stringify({[value.id]:value}));},fixture());
    const state=async()=>page.evaluate(()=>{
      const box=selector=>{const element=document.querySelector(selector),r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,visible:!!(r.width&&r.height)&&getComputedStyle(element).visibility!=='hidden'};};
      return {bodyBoard:document.body.classList.contains('workspace-board-open'),boardPressed:document.querySelector('[data-workspace-mode=board]').getAttribute('aria-pressed'),mapPressed:document.querySelector('[data-workspace-mode=map]').getAttribute('aria-pressed'),board:box('.workspace-board'),search:box('.workspace-board-search'),map:box('.right-column'),host:box('#workspaceBoard'),overflow:document.documentElement.scrollWidth>innerWidth,days:[...document.querySelectorAll('.workspace-day')].map(element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};}),cards:[...document.querySelectorAll('.workspace-place')].map(element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};})};
    });
    const checkMode=async(mode,label)=>{
      const metrics=await state();result.checks.push({label,mode,...metrics});
      assert.equal(metrics.bodyBoard,mode==='board',`${label}: body layout agrees with selected mode`);
      assert.equal(metrics.boardPressed,String(mode==='board'));assert.equal(metrics.mapPressed,String(mode==='map'));
      assert.equal(metrics.board.visible,mode==='board');assert.equal(metrics.search.visible,mode==='board');assert.equal(metrics.map.visible,mode==='map');
      return metrics;
    };
    await page.goto(url);await page.click('#continueTravel');
    await page.screenshot({path:path.join(out,'1920x1020-saved-continue.png'),fullPage:true});
    await checkMode('board','saved travel continue without extra board click');
    for(const size of [{width:1920,height:1020},{width:1440,height:1000},{width:1280,height:900},{width:768,height:1024},{width:390,height:844}]){
      await page.setViewportSize(size);await page.locator('.page-content').evaluate(element=>{element.scrollTop=0;});
      const metrics=await checkMode('board',`resize ${size.width}`);
      assert.equal(metrics.overflow,false);assert.equal(metrics.days.length,size.width<=760?1:size.width<=1100?2:3);
      assert.ok(metrics.days.every(day=>day.width>=200),`readable date columns ${size.width}`);
      assert.ok(metrics.cards.every(card=>card.width>=170),`readable cards ${size.width}`);
      assert.ok(metrics.days.every((day,i)=>i===0||day.left>=metrics.days[i-1].right),`columns never overlap ${size.width}`);
      await page.screenshot({path:path.join(out,`${size.width}x${size.height}.png`),fullPage:true});result.viewports.push({...size,...metrics});
    }
    await page.setViewportSize({width:1920,height:1020});
    await page.click('[data-workspace-mode=map]');await checkMode('map','switch to map');
    await page.click('[data-workspace-mode=board]');await checkMode('board','switch back to board');
    await page.click('[data-workspace-travel=saved]');await page.click('[data-travel-open="layout-five-day-test"]');await checkMode('board','saved history reopen');
    const bytes=await page.evaluate(value=>{const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([value.headers,...value.records.map(row=>row.cells.map(cell=>cell.v))]),'일정');return Array.from(new Uint8Array(XLSX.write(workbook,{type:'array',bookType:'xlsx'})));},fixture());
    await page.locator('#fileInput').setInputFiles({name:'5일_여행_일정.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('일정 파일을 불러왔어요'));
    await checkMode('map','real XLSX import opens map/list');
    await page.screenshot({path:path.join(out,'1920x1020-import-map.png'),fullPage:true});
    assert.equal(await page.locator('#resultList .item').count(),40,'import retains all dates');
    await page.click('[data-workspace-mode=board]');await checkMode('board','import then board uses full page');
    await page.screenshot({path:path.join(out,'1920x1020-import-board.png'),fullPage:true});
    const beforeFailedImport=await page.locator('.workspace-travel-name').textContent();
    await page.locator('#fileInput').setInputFiles({name:'broken.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('broken zip')});
    await page.waitForFunction(()=>document.querySelector('#dropTitle').textContent.includes('파일을 읽지 못했습니다'));
    await checkMode('board','failed XLSX retains original board mode');
    assert.equal(await page.locator('.workspace-travel-name').textContent(),beforeFailedImport);
    assert.equal(await page.locator('[data-workspace-kind=record]').count(),24);
    const downloadPromise=page.waitForEvent('download');await page.click('[data-workspace-travel=backup]');
    const backup=await downloadPromise,backupBytes=await fs.readFile(await backup.path());
    await page.click('[data-workspace-mode=map]');
    await page.locator('#travelBackupInput').setInputFiles({name:'test-backup.json',mimeType:'application/json',buffer:backupBytes});
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('백업을 새 여행으로 복원'));
    await checkMode('map','same-tab backup restore keeps selected map mode');
    await page.click('[data-workspace-mode=board]');await checkMode('board','restored backup switches to full board');
    await page.click('[data-workspace-travel=new]');await page.fill('#travelName','빈 새 여행');await page.fill('#travelStart','2026-12-10');await page.locator('#newTravelForm button').click();await checkMode('board','new travel after import');
    await page.reload();await page.click('#savedTravels');await page.click('[data-travel-open="layout-five-day-test"]');await checkMode('board','fresh load saved history without continue');
    await context.route('**/api/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      const snapshot=fixture();snapshot.id='mock-account-layout';
      const travel={id:snapshot.id,version:1,snapshot};
      const response=pathname==='/api/session'?{available:true,user:{id:'layout-user',name:'레이아웃 테스트'},freeAI:false}:pathname==='/api/travels'?{travels:[{id:travel.id,name:snapshot.name,version:1}]}:pathname==='/api/logout'?{}:{travel};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
    });
    await page.reload();await page.waitForFunction(()=>document.querySelector('[data-account-open]').textContent.includes('계정 · 저장'));
    await page.locator('[data-account-open]').first().click();await page.click('[data-account-travel=mock-account-layout]');
    await page.waitForFunction(()=>!document.querySelector('#accountDialog').open);await checkMode('board','mock account open');
    await page.locator('[data-account-open]').first().click();await page.click('#accountLogout');
    await page.waitForFunction(()=>document.querySelector('#accountContent').hidden);
    assert.equal(await page.locator('#workspaceBoard').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.body.classList.contains('workspace-board-open')),false);
    await page.click('#accountClose');await page.click('#newTravel');await page.fill('#travelName','로그아웃 뒤 새 여행');await page.fill('#travelStart','2026-12-15');await page.locator('#newTravelForm button').click();await checkMode('board','new travel after account logout resets applied mode');
    assert.deepEqual(errors,[]);await context.close();result.status='PASS';
  } catch(error){result.error=error.stack;throw error;}
  finally {await browser?.close();await new Promise(resolve=>server.close(resolve));result.cleanup='fresh browser context and local server closed';await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));}
  console.log(JSON.stringify({status:result.status,checks:result.checks.length,viewports:result.viewports.length,out},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
