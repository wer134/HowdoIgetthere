const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
const BASE=process.env.APP_URL||'http://127.0.0.1:8096',OUT=process.env.STABILITY_OUT||'/tmp/routeflow-production-stability';fs.mkdirSync(OUT,{recursive:true});
const path = require('node:path');
const XLSX = require('../../vendor/xlsx.full.min.js');

async function verifyFirstTravelTap(browser) {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true});
  let releaseWorkbook;
  const workbookReady = new Promise(resolve => { releaseWorkbook = resolve; });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!route.request().url().startsWith(BASE)) return route.abort();
    if (url.pathname.endsWith('/vendor/xlsx.full.min.js')) await workbookReady;
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  try {
    await page.goto(BASE, {waitUntil: 'commit'});
    await page.locator('#newTravel').tap();
    assert(await page.locator('#travelDialog').isVisible(), 'The first tap must open the dialog while XLSX is loading');
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.fill('#travelName', '첫 탭 여행');
    releaseWorkbook();
    await page.click('#newTravelForm button');
    await page.waitForFunction(() => document.querySelector('#fileName').textContent === '첫 탭 여행');
  } finally {
    releaseWorkbook();
    await context.close();
  }
}

async function verifySheetExport(browser) {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  const mockDir = path.resolve(__dirname, '../../docs/testing/repro');
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!route.request().url().startsWith(BASE)) return route.abort();
    if (url.pathname.endsWith('/js/mapview.js')) {
      return route.fulfill({contentType: 'text/javascript', path: path.join(mockDir, 'mapview-mock.js')});
    }
    return route.continue();
  });
  await context.addInitScript({path: path.join(mockDir, 'google-mock.js')});
  await context.addInitScript(() => localStorage.setItem('googleMapsApiKey', 'TEST_GOOGLE'));
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const names = page.locator('#resultList .item-name');
  async function checkDownload(button) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(button)]);
    const exported = XLSX.read(fs.readFileSync(await download.path()), {type: 'buffer'});
    assert.deepEqual(exported.SheetNames, ['형식 다른 일정']);
    const rows = XLSX.utils.sheet_to_json(exported.Sheets['형식 다른 일정'], {header: 1});
    assert.deepEqual(rows.slice(1).map(row => row[0]), ['텐진 지하상가']);
  }
  try {
    await page.goto(BASE);
    await page.waitForFunction(() => document.querySelector('#syncText').textContent === '지도 연결됨');
    const workbook = XLSX.utils.book_new();
    for (const [name, rows] of [
      ['첫 일정', [
        ['장소', '날짜', '시간', '위도', '경도'],
        ['오호리 공원', '2026-12-07', '10:00', 33.586, 130.376],
        ['시립 미술관', '2026-12-07', '13:00', 33.559, 130.395],
      ]],
      ['형식 다른 일정', [['내가가려는곳', '현지 날짜'], ['텐진 지하상가', '2026-12-09']]],
      ['주소 또는 좌표', [['주소', '위도', '경도'], ['후쿠오카 하카타역', '', ''], ['', 33.59, 130.42]]],
    ]) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
    }
    await page.locator('#fileInput').setInputFiles({
      name: '여행 일정.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(XLSX.write(workbook, {type: 'array', bookType: 'xlsx'})),
    });
    await names.first().waitFor();
    assert.deepEqual(await names.allTextContents(), ['오호리 공원', '시립 미술관']);
    await page.waitForFunction(() => Object.keys(window.__mock.markers).length === 2 && Object.keys(window.__mock.legs).length === 1);
    await names.first().click();
    assert(await page.locator('#placePanel').isVisible());
    if (!(await page.locator('#sheetSelect').isVisible())) await page.click('#columnsToggle');
    await page.selectOption('#sheetSelect', '형식 다른 일정');
    assert.deepEqual(await names.allTextContents(), [], 'Unmapped sheet must clear the previous sheet’s rows');
    assert(await page.locator('#placePanel').isHidden());
    assert.deepEqual(await page.evaluate(() => window.__mock.markers), {});
    assert.deepEqual(await page.evaluate(() => window.__mock.legs), {});
    assert(await page.locator('#exportXlsx').isDisabled());

    await page.setViewportSize({width: 390, height: 844});
    await page.click('#mobileSave');
    assert(await page.locator('#mobileExportXlsx').isDisabled());
    await page.locator('#mobileExportDialog .dialog-x').click();

    await page.setViewportSize({width: 1440, height: 900});
    await page.selectOption('#map-name', '0');
    assert.deepEqual(await names.allTextContents(), ['텐진 지하상가']);
    await checkDownload('#exportXlsx');
    await page.setViewportSize({width: 390, height: 844});
    await page.click('#mobileSave');
    await checkDownload('#mobileExportXlsx');
    await page.locator('#mobileExportDialog .dialog-x').click();
    await page.setViewportSize({width: 1440, height: 900});

    await page.selectOption('#map-name', '-1');
    assert.deepEqual(await names.allTextContents(), []);
    assert(await page.locator('#exportXlsx').isDisabled());
    await page.selectOption('#map-name', '0');
    await page.evaluate(async () => {
      const {Place} = await google.maps.importLibrary('places');
      const search = Place.searchByText;
      window.__mock.query['텐진 지하상가'] = {results: [{name: '텐진 지하상가', lat: 33.59, lng: 130.40}]};
      Place.searchByText = async request => {
        if (request.textQuery !== '텐진 지하상가') return search.call(Place, request);
        await new Promise(resolve => { window.finishPreviousSheetSearch = resolve; });
        const result = await search.call(Place, request);
        requestAnimationFrame(() => { window.previousSheetSearchReturned = true; });
        return result;
      };
    });
    await page.click('#runBtn');
    await page.waitForFunction(() => typeof window.finishPreviousSheetSearch === 'function');
    assert(await page.locator('#exportXlsx').isDisabled());
    await page.click('#columnsToggle');
    await page.selectOption('#sheetSelect', '주소 또는 좌표');
    assert.deepEqual(await names.allTextContents(), ['후쿠오카 하카타역', '(장소 없음)']);
    assert(await page.locator('#exportXlsx').isEnabled());
    await page.evaluate(() => window.finishPreviousSheetSearch());
    await page.waitForFunction(() => window.previousSheetSearchReturned);
    assert.deepEqual(await names.allTextContents(), ['후쿠오카 하카타역', '(장소 없음)']);
    assert.deepEqual(await page.evaluate(() => Object.values(window.__mock.markers).map(marker => marker.title)), ['(장소 없음)']);
    await page.evaluate(() => {
      window.__mock.query['후쿠오카 하카타역'] = {results: [{id: 'hakata', name: '하카타역', lat: 33.59, lng: 130.42}]};
    });
    await page.click('#runBtn');
    await page.waitForFunction(() => window.__mock.markers[0]?.position?.lat === 33.59);
    assert(await page.locator('#exportXlsx').isEnabled());
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const results=[];
try{await verifyFirstTravelTap(b);results.push({name:'엑셀 라이브러리가 로딩 중이어도 첫 탭으로 새 여행 시작',status:'통과'});
await verifySheetExport(b);results.push({name:'시트 전환 후 PC·모바일 엑셀 상태와 다운로드 내용 확인',status:'통과'});
const c=await b.newContext({viewport:{width:1440,height:900}});await c.route('**/*',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
const p=await c.newPage();p.setDefaultTimeout(10000);const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(BASE);
await p.click('#newTravel');await p.fill('#travelName','운영 안정성 테스트');await p.fill('#travelStart','2026-11-07');await p.click('#newTravelForm button');await p.click('[data-workspace-mode="map"]');
await p.click('#scheduleAdd');await p.fill('#scheduleName','보존할 장소');await p.fill('#scheduleMemo','보존할 개인 메모');await p.click('#scheduleForm button[type=submit]');await p.waitForTimeout(600);
const get=()=>p.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('routeflow.travels.v1')))[0]);const before=await get();assert.equal(before.records.length,1);
await p.evaluate(()=>{const original=window.structuredClone;window.__snapshotClones=0;window.structuredClone=function(value,...args){if(value?.records&&value?.mapping)window.__snapshotClones++;return original.call(this,value,...args);};});
for(let i=0;i<6;i++){await p.fill('#workspaceSearch','없음');await p.fill('#workspaceSearch','');await p.click('#travelLibraryTab');await p.click('#travelPlanTab');}
await p.waitForTimeout(600);assert.equal(await p.evaluate(()=>__snapshotClones),0);results.push({name:'읽기 전용 탐색에서 전체 snapshot 복제 없음',status:'통과'});
await p.setInputFiles('#fileInput',{name:'too-large.csv',mimeType:'text/csv',buffer:Buffer.alloc(20*1024*1024+1,32)});await p.waitForFunction(()=>document.querySelector('#toast').textContent.includes('20MB'));assert.deepEqual((await get()).records,before.records);
await p.route('**/js/excel-worker.js*',async r=>{await new Promise(resolve=>setTimeout(resolve,600));await r.continue().catch(()=>{});});
await p.setInputFiles('#fileInput',{name:'cancel.csv',mimeType:'text/csv',buffer:Buffer.from('장소,날짜\n새 장소,2026-11-08')});await p.click('#importCancel');await p.waitForFunction(()=>document.querySelector('#toast').textContent.includes('취소'));await p.waitForTimeout(800);assert.deepEqual((await get()).records,before.records);await p.unroute('**/js/excel-worker.js*');
results.push({name:'크기 초과·취소 후 기존 여행 유지',status:'통과'});
const worker=await p.evaluate(async()=>{const {parseWorkbookAsync}=await import('/js/excel-loader.js');const lines=['장소,날짜,시간',...Array.from({length:2000},(_,i)=>`장소 ${i},2026-11-07,10:00`)];let ticks=0;const interval=setInterval(()=>ticks++,5);const start=performance.now();const result=await parseWorkbookAsync(new File([lines.join('\n')],'many.csv'));clearInterval(interval);return{rows:result.parsedSheets[result.defaultSheet].records.length,ticks,milliseconds:Math.round(performance.now()-start)};});assert.equal(worker.rows,2000);assert(worker.ticks>0);results.push({name:'2,000행 실제 Worker 파싱 중 UI 타이머 실행',status:'통과',...worker});
await p.route('**/js/excel-worker.js*',r=>r.fulfill({contentType:'text/javascript',body:'self.onmessage=()=>{while(true){}}'}));
const timed=await p.evaluate(async()=>{const {parseWorkbookAsync}=await import('/js/excel-loader.js');try{await parseWorkbookAsync(new File(['장소\n공원'],'timeout.csv'),{timeout:150});return false;}catch(e){return /초과/.test(e.message);}});assert(timed);await p.unroute('**/js/excel-worker.js*');results.push({name:'멈춘 Worker 시간 제한·종료',status:'통과',mode:'Worker 정지 모의 주입'});
await p.setInputFiles('#fileInput',{name:'valid.csv',mimeType:'text/csv',buffer:Buffer.from('장소,날짜,시간,메모\n새 일정,2026-11-08,10:00,새 메모')});await p.waitForFunction(()=>document.querySelector('#fileName').textContent==='valid.csv');await p.waitForTimeout(600);
const stored=await p.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('routeflow.travels.v1'))));assert.equal(stored.length,2);assert(stored.some(t=>t.records[0].cells.some(c=>c?.v==='새 일정')));
await p.screenshot({path:OUT+'/imported.png',fullPage:true});assert.deepEqual(errors,[]);results.push({name:'취소 후 재시도·원본 여행과 새 여행 저장',status:'통과'});
fs.writeFileSync(OUT+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));await c.close();}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
