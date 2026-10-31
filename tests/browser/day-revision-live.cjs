// 실제 API를 호출하는 선택 실행 검사. 환경 키 값을 로그/파일에 기록하지 않는다.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const XLSX = require('../../vendor/xlsx.full.min.js');
const BASE = process.env.APP_URL || 'http://127.0.0.1:8093';
const OUT = process.env.REVISION_LIVE_OUT || '/tmp/routeflow-day-revision-live';
fs.mkdirSync(OUT, { recursive: true });
const secrets = [process.env.googlemap, process.env.geminiapi].filter(Boolean);
const clean = value => secrets.reduce((s, key) => s.split(key).join('[REDACTED]'), String(value));
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/chromium', proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' }, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const report = { mode: '실제 Google 지도 + 실제 Gemini, 모의 응답 없음', responses: [], errors: [] };
  try {
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
    p.setDefaultTimeout(15000);
    p.on('pageerror', e => report.errors.push(clean(e.message)));
    p.on('response', async r => {
      if (r.url().includes('generativelanguage.googleapis.com') && r.url().includes(':generateContent')) {
        const entry = { service: 'Gemini', http: r.status() }; report.responses.push(entry);
        const body = await r.json().catch(() => ({})); entry.usage = body.usageMetadata;
      }
    });
    await p.goto(BASE);
    await p.waitForFunction(() => document.querySelector('#syncText').textContent === '지도 연결됨', null, { timeout: 30000 });
    await p.waitForTimeout(2000);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['장소', '날짜', '시간', '메모', '지역', '위도', '경도', '개인 열'],
      ['오호리 공원', '2026-11-07', '10:00–11:00', '[고정] 오전 산책 유지', '후쿠오카', 33.5862065, 130.3764646, '원본 보존'],
      ['후쿠오카시 미술관', '', '11:30–12:30', '전시를 보고 쉬기', '후쿠오카', 33.5841636, 130.3796718, '사용자 내용'],
      ['오호리 공원', '2026-11-08', '09:00', '다음 날 계획 보존', '후쿠오카', 33.5862065, 130.3764646, '다른 날짜'],
    ]), '사용자 계획');
    await p.setInputFiles('#fileInput', { name: '사용자_계획_실제검증.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))) });
    await p.click('#runBtn'); await p.waitForFunction(() => document.querySelectorAll('#resultList .item-name').length === 3); await p.waitForTimeout(600);
    const saved = async () => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('routeflow.travels.v1')))[0]);
    const before = await saved();
    await p.click('#dayRevisionOpen'); await p.selectOption('#dayRevisionDay', '2026-11-07');
    await p.fill('#dayRevisionRequest', '기존 두 장소만 유지하고 미술관 관람을 13:00–14:00으로 늦춰 주세요. 오전 공원 일정은 그대로 유지하고 새 장소나 이동 행은 추가하지 마세요.');
    await p.click('#dayRevisionGenerate');
    await p.waitForFunction(() => !document.querySelector('#dayRevisionGenerate').disabled, null, { timeout: 180000 });
    report.status = await p.textContent('#dayRevisionStatus');
    report.preview = await p.textContent('#dayRevisionAfter');
    assert.equal(await p.locator('#dayRevisionApply').isEnabled(), true, report.status);
    assert.deepEqual((await saved()).records, before.records);
    await p.screenshot({ path: path.join(OUT, 'preview.png'), fullPage: true });
    await p.click('#dayRevisionApply'); await p.waitForFunction(() => !document.querySelector('#dayRevisionDialog').open);
    const after = await saved();
    assert.deepEqual(after.records[2], before.records[2]);
    assert.equal(after.records[1].cells[2].v, '13:00–14:00');
    assert.equal(after.records[0].cells[3].v, before.records[0].cells[3].v);
    assert.equal(after.records[1].cells[7].v, '사용자 내용');
    await p.reload(); await p.click('#continueTravel');
    await p.waitForFunction(() => document.querySelectorAll('#resultList .item-name').length === 3);
    assert.equal((await saved()).records[1].cells[2].v, '13:00–14:00');
    await p.waitForTimeout(2000);
    await p.screenshot({ path: path.join(OUT, 'reopened.png'), fullPage: true });
    report.checks = ['직접 작성한 엑셀의 지도 표시', 'Gemini 일별 수정안 실제 응답', '적용 전 원본 유지', '잠근 시간·개인 메모·추가 열·다른 날짜 보존', '적용 후 새로고침·이어서 준비하기에서 유지'];
    report.records = after.records.map(r => ({ name: r.cells[0]?.v, date: r.cells[1]?.v, time: r.cells[2]?.v }));
    report.mapRendered = await p.locator('#map .gm-style').count() > 0;
    report.mockPresent = await p.evaluate(() => !!window.__mock);
    assert(report.mapRendered && !report.mockPresent); assert(report.responses.some(r => r.http === 200));
    assert.deepEqual(report.errors, []); report.completed = true;
  } catch (error) { report.completed = false; report.error = clean(error.message); process.exitCode = 1; }
  finally { fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await b.close(); }
})().catch(error => { console.error(clean(error.message)); process.exitCode = 1; });
