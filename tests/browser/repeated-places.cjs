const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const OUT = path.resolve(process.env.REPEATED_OUT || 'docs/testing/evidence/repeated-places-layout/repeated');
const PHASE = process.env.REPEATED_PHASE || 'green';
const ASSET_ROOT = path.resolve(process.env.BOARD_ASSET_ROOT || '.');
const DAY = '2026-11-07';
const A = { id: 'mock-station-a', name: '반복 방문역', address: '가상 도시 1', lat: 35, lng: 139 };
const B = { id: 'mock-stop-b', name: '중간 버스정류장', address: '가상 도시 2', lat: 35.01, lng: 139.01 };
const C = { id: 'mock-entrance-c', name: '다른 역 입구', address: '가상 도시 3', lat: 35.00004, lng: 139 };
const cells = (place, time, memo) => [place.name, DAY, time, memo, place.address, place.lat, place.lng].map(v => ({ v, t: typeof v === 'number' ? 'n' : 's' }));
const fixture = () => ({
  id: 'repeated-visits-test', name: '반복 방문 검증', updated: Date.now(),
  headers: ['장소', '날짜', '시간', '메모', '주소', '위도', '경도'],
  mapping: { name: 0, date: 1, time: 2, memo: 3, address: 4, lat: 5, lng: 6, category: 1, region: -1, mode: -1 },
  records: [{ rowNumber: 2, cells: cells(A, '09:00', '첫 출발') }, { rowNumber: 3, cells: cells(B, '11:00', '중간 방문') }],
  places: [A, B].map((place, recordIndex) => ({ place, recordIndex, status: 'given', cachedAt: Date.now() })),
  dates: [DAY, '2026-11-08', '2026-11-09'], library: [], sheetName: '일정',
});
const snapshot = page => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('routeflow.travels.v1') || '{}')).find(t => t.id === 'repeated-visits-test'));
const rows = async page => {
  const trip = await snapshot(page), m = trip.mapping;
  return trip.records.map(record => ({ name: record.cells[m.name]?.v, day: record.cells[m.date]?.v, time: record.cells[m.time]?.v || '', memo: record.cells[m.memo]?.v || '' }));
};
async function saved(page, count) {
  await page.waitForFunction(expected => {
    const trip = JSON.parse(localStorage.getItem('routeflow.travels.v1') || '{}')['repeated-visits-test'];
    return trip?.records.length === expected && document.querySelector('#travelSaveStatus').textContent.includes('이 기기에 저장됨');
  }, count);
}

(async () => {
  await fs.mkdir(OUT, { recursive: true });
  const { createStaticServer } = await import('../../tools/http-server.js');
  const production = ASSET_ROOT !== path.resolve('.');
  const release = production ? JSON.parse(await fs.readFile(path.join(ASSET_ROOT, 'release.json'), 'utf8')) : null;
  const server = createStaticServer({ root: ASSET_ROOT, production });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const report = { phase: PHASE, status: 'FAIL', assetRoot: ASSET_ROOT, release, providerCalls: 'none; all nonlocal requests blocked, mock SDK/map only', checks: [], viewports: [], errors: [] };
  let browser;
  try {
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' });
    for (const width of PHASE === 'red' ? [1440] : [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'ko-KR', serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (url.pathname === '/runtime-config.js') return route.fulfill({ contentType: 'text/javascript', body: 'window.APP_CONFIG = {};' });
        if (url.pathname === '/js/mapview.js') return route.fulfill({ contentType: 'text/javascript', path: path.resolve('docs/testing/repro/mapview-mock.js') });
        return route.continue();
      });
      await context.addInitScript({ path: path.resolve('docs/testing/repro/google-mock.js') });
      await context.addInitScript(({ trip, places }) => {
        localStorage.setItem('googleMapsApiKey', 'TEST_GOOGLE_NOT_REAL');
        if (!localStorage.getItem('repeated-seeded')) {
          localStorage.setItem('routeflow.travels.v1', JSON.stringify({ [trip.id]: trip }));
          localStorage.setItem('repeated-seeded', '1');
        }
        for (const place of places) window.__mock.query[place.name] = { results: [place] };
      }, { trip: fixture(), places: [A, B, C] });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      const open = async () => {
        await page.click('#continueTravel');
        await page.click('[data-workspace-mode="map"]');
        if (width < 950) await page.click('[data-mobile-view="itinerary"]');
        await page.waitForFunction(() => window.__mock.events.includes('map-init'));
      };
      const closePanel = async () => { if (await page.locator('#placePanelClose').isVisible()) await page.click('#placePanelClose'); };
      const search = async (place, day) => {
        await closePanel();
        await page.click('#scheduleAdd');
        await page.fill('#scheduleDate', day);
        await page.click('#schedulePlaceTab');
        await page.fill('#schedulePlaceQuery', place.name);
        await page.click('#schedulePlaceSearch');
        await page.locator('[data-schedule-pick="0"]').waitFor();
      };
      const pick = async (place, day, time, memo) => {
        await search(place, day);
        assert.equal(await page.locator('[data-schedule-pick="0"]').isEnabled(), true, `Existing ${place.name} must remain selectable for a new visit on ${day}`);
        await page.screenshot({ path: path.join(OUT, `${PHASE}-${width}-${place.id}-${day}-search.png`), fullPage: true });
        if (place === C) assert.doesNotMatch(await page.locator('.schedule-recommend-rating').textContent(), /일정에 있음/, 'Different IDs within 15 m must not share an existing-visit hint');
        await page.click('[data-schedule-pick="0"]');
        await page.fill('#scheduleTime', time);
        await page.fill('#scheduleMemo', memo);
        await page.click('#scheduleForm button[type="submit"]');
      };
      await page.goto(base); await open();
      await search(A, DAY);
      await page.screenshot({ path: path.join(OUT, `${PHASE}-${width}-initial-repeat.png`), fullPage: true });
      assert.equal(await page.locator('[data-schedule-pick="0"]').isEnabled(), true, 'Existing station is disabled: a new same-day visit must be selectable');
      await page.keyboard.press('Escape');
      await pick(A, DAY, '17:00', '돌아오는 방문'); await saved(page, 3);
      assert.deepEqual((await rows(page)).map(row => row.name), [A.name, B.name, A.name]);
      const identity = await page.evaluate(() => ({ markerKeys: Object.keys(__mock.markers), legKeys: Object.keys(__mock.legs) }));
      assert.deepEqual(identity.markerKeys, ['0', '1', '2']);
      assert.deepEqual(identity.legKeys, ['0>1', '1>2']);
      await fs.writeFile(path.join(OUT, `${width}-visit-keys.json`), JSON.stringify(identity, null, 2));
      await pick(C, DAY, '18:00', '별도 입구'); await saved(page, 4);
      await pick(A, '2026-11-08', '08:00', '다음날 출발'); await saved(page, 5);
      await closePanel();
      await page.locator('#resultList [data-action="edit"]').nth(2).click();
      await page.fill('#scheduleTime', '17:30'); await page.fill('#scheduleMemo', '복귀 방문만 수정');
      await page.click('#scheduleForm button[type="submit"]'); await saved(page, 5);
      await page.waitForFunction(() => {
        const trip = JSON.parse(localStorage.getItem('routeflow.travels.v1'))['repeated-visits-test'];
        return trip.records[2].cells[trip.mapping.memo]?.v === '복귀 방문만 수정';
      });
      assert.deepEqual((await rows(page)).filter(row => row.name === A.name).map(({ day, time, memo }) => ({ day, time, memo })), [
        { day: DAY, time: '09:00', memo: '첫 출발' }, { day: DAY, time: '17:30', memo: '복귀 방문만 수정' },
        { day: '2026-11-08', time: '08:00', memo: '다음날 출발' },
      ]);
      await closePanel();
      await page.locator('#resultList [data-action="travel-move"]').nth(4).click();
      await page.fill('#travelAssignDay', '2026-11-09');
      await page.click('#travelAssignForm button'); await saved(page, 5);
      assert.deepEqual((await rows(page)).filter(row => row.name === A.name).map(row => row.day), [DAY, DAY, '2026-11-09']);
      await page.click('#dayTabs [data-all]');
      await closePanel();
      await page.locator('#resultList [data-action="delete"]').first().click(); await saved(page, 4);
      const afterDelete = await rows(page);
      assert.deepEqual(afterDelete.filter(row => row.name === A.name).map(row => row.memo), ['복귀 방문만 수정', '다음날 출발']);
      await page.reload(); await open();
      assert.deepEqual(await rows(page), afterDelete);
      assert.equal(await page.locator('#resultList > li.item').count(), 4);
      await page.screenshot({ path: path.join(OUT, `${width}-independent-visits-reloaded.png`), fullPage: true });
      if (width < 950) await page.click('#mobileSave');
      else await page.locator('[data-open="workspaceTools"]:visible').first().click();
      const download = page.waitForEvent('download');
      await page.click(width < 950 ? '#mobileTravelBackup' : '#travelBackup');
      const backup = await download;
      const backupPath = path.join(OUT, `${width}-backup.json`); await backup.saveAs(backupPath);
      const envelope = JSON.parse(await fs.readFile(backupPath, 'utf8'));
      assert.equal(envelope.travel.places.filter(entry => entry.place.id === A.id).length, 2);
      const fresh = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      await fresh.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
      const restored = await fresh.newPage(); await restored.goto(base);
      await restored.setInputFiles('#travelBackupInput', backupPath);
      await restored.waitForFunction(() => document.querySelector('#fileName').textContent.endsWith('(복원본)'));
      const roundTrip = await restored.evaluate(() => Object.values(JSON.parse(localStorage.getItem('routeflow.travels.v1')))[0]);
      assert.deepEqual(roundTrip.records, envelope.travel.records);
      assert.deepEqual(roundTrip.places.map(entry => [entry.recordIndex, entry.place.id]), envelope.travel.places.map(entry => [entry.recordIndex, entry.place.id]));
      await fresh.close();
      report.viewports.push({ width, status: 'PASS', visits: afterDelete, identity });
      await context.close();
    }
    assert.deepEqual(report.errors, []);
    report.status = 'PASS';
    report.checks = ['same-day A→B→A', 'cross-day repeated station', 'distinct nearby provider ID', 'independent time/memo edit', 'independent date move and delete', 'reload persistence', 'fresh-context backup roundtrip', 'visit-specific marker and leg keys'];
  } catch (error) { report.failure = error.stack; throw error; }
  finally {
    await fs.writeFile(path.join(OUT, `${PHASE}-results.json`), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
