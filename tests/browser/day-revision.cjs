const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const XLSX = require('../../vendor/xlsx.full.min.js');
const BASE = process.env.APP_URL || 'http://127.0.0.1:8093';
const OUT = process.env.REVISION_OUT || '/tmp/routeflow-day-revision';
fs.mkdirSync(OUT, { recursive: true });
const store = p => p.evaluate(() => JSON.parse(localStorage.getItem('routeflow.travels.v1') || '{}'));
const latest = async p => Object.values(await store(p))[0];
const proposal = { summary: '예약은 유지하고 미술관 시간을 늦춘 뒤 카페를 추가해요.', items: [
  { id: 'r0', name: '오호리 공원', time: '10:00–11:00', region: '후쿠오카', note: '' },
  { id: 'r1', name: '후쿠오카시 미술관', time: '13:00–14:00', region: '후쿠오카', note: '관람 후 휴식' },
  { id: '', name: '새 카페', time: '14:30–15:00', region: '후쿠오카', note: '가까운 휴식 장소' },
] };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const results = [];
  try { for (const width of [1440, 390]) {
    const c = await b.newContext({ viewport: { width, height: 900 }, locale: 'ko-KR' });
    let reply = proposal, delay = 0, calls = 0, fail = false;
    await c.route('**/*', async r => {
      const u = new URL(r.request().url());
      if (u.hostname === 'generativelanguage.googleapis.com') {
        calls++;
        const input = JSON.parse(JSON.parse(r.request().postData()).contents[0].parts[0].text);
        assert.equal(input.day, '2026-11-07'); assert.equal(input.items.length, 2);
        assert(!JSON.stringify(input).includes('다음날 메모'));
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        return r.fulfill({ status: fail ? 429 : 200, contentType: 'application/json', body: JSON.stringify(fail ? { error: { message: 'test quota' } } : { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(reply) }] } }] }) }).catch(() => {});
      }
      if (!r.request().url().startsWith(BASE)) return r.abort();
      if (u.pathname === '/runtime-config.js') return r.fulfill({ contentType: 'text/javascript', body: 'window.APP_CONFIG = window.APP_CONFIG || {};' });
      if (u.pathname === '/js/mapview.js') return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.resolve('docs/testing/repro/mapview-mock.js'), 'utf8') });
      return r.continue();
    });
    await c.addInitScript({ path: path.resolve('docs/testing/repro/google-mock.js') });
    await c.addInitScript(() => {
      localStorage.setItem('googleMapsApiKey', 'TEST_GOOGLE'); localStorage.setItem('plannerProvider', 'gemini'); localStorage.setItem('geminiApiKey', 'TEST_GEMINI');
      window.__mock.query['새 카페 후쿠오카'] = { results: [{ id: 'test-cafe', name: '새 카페', address: '후쿠오카', lat: 33.585, lng: 130.38 }] };
    });
    const p = await c.newPage(); p.setDefaultTimeout(10000);
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['장소', '날짜', '시간', '메모', '지역', '위도', '경도', '내 추가 열'],
      ['오호리 공원', '2026-11-07', '10:00–11:00', '[고정] 예약 메모', '후쿠오카', 33.586, 130.376, '개인 정보 보존'],
      ['후쿠오카시 미술관', '', '11:30–12:30', '전시 메모', '후쿠오카', 33.584, 130.379, '추가 열 보존'],
      ['다음날 장소', '2026-11-08', '09:00', '다음날 메모', '후쿠오카', 33.59, 130.39, '다른 날짜 보존'],
    ]), '내 일정');
    await p.setInputFiles('#fileInput', { name: '내가_작성한_계획.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))) });
    await p.click('#runBtn');
    await p.waitForFunction(() => document.querySelectorAll('#resultList .item-name').length === 3);
    await p.waitForTimeout(600);
    const original = await latest(p);
    assert(original);
    const open = async () => { await p.click('#dayRevisionOpen'); await p.selectOption('#dayRevisionDay', '2026-11-07'); await p.fill('#dayRevisionRequest', '미술관을 오후로 바꾸고 카페 추가. 예약 유지.'); };
    const generate = async () => { await p.click('#dayRevisionGenerate'); await p.waitForFunction(() => !document.querySelector('#dayRevisionApply').disabled); };
    await open(); assert(await p.locator('[data-revision-lock=""][value="r0"]').isChecked());
    await generate();
    assert.deepEqual((await latest(p)).records, original.records);
    await p.screenshot({ path: path.join(OUT, `${width}-preview.png`), fullPage: true });
    if (width === 390) assert(await p.locator('#dayRevisionDialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await p.click('#dayRevisionApply');
    await p.waitForFunction(() => !document.querySelector('#dayRevisionDialog').open);
    let changed = await latest(p);
    assert.equal(changed.records.length, 4);
    assert.deepEqual(changed.records[3], original.records[2]);
    assert.equal(changed.records[0].cells[3].v, '[고정] 예약 메모');
    assert.equal(changed.records[1].cells[3].v, '전시 메모\nAI 참고: 관람 후 휴식');
    assert.equal(changed.records[1].cells[7].v, '추가 열 보존');
    assert.equal(changed.places.length, 4);
    await p.screenshot({ path: path.join(OUT, `${width}-applied.png`), fullPage: true });
    await p.click('#toastUndo'); await p.waitForTimeout(600);
    assert.deepEqual((await latest(p)).records, original.records);
    // Locked row deletion and provider errors leave the original intact.
    await open(); reply = { ...proposal, items: proposal.items.slice(1) };
    await p.click('#dayRevisionGenerate'); await p.waitForFunction(() => document.querySelector('#dayRevisionStatus').textContent.includes('잠금'));
    assert(await p.locator('#dayRevisionApply').isDisabled());
    reply = proposal; fail = true;
    await p.click('#dayRevisionGenerate'); await p.waitForFunction(() => document.querySelector('#dayRevisionStatus').textContent.includes('429'));
    assert.deepEqual((await latest(p)).records, original.records); fail = false;
    // Duplicate submits, closing a pending request and late responses never apply.
    delay = 500; const beforeCalls = calls;
    await p.locator('#dayRevisionForm').evaluate(f => { f.requestSubmit(); f.requestSubmit(); });
    await p.waitForTimeout(100); await p.locator('#dayRevisionDialog .dialog-x').click();
    await p.waitForTimeout(650); assert.equal(calls, beforeCalls + 1);
    assert.deepEqual((await latest(p)).records, original.records); delay = 0;
    // Failed persistence must not apply the preview to memory or disk.
    await open(); await generate();
    await p.evaluate(() => { const old = Storage.prototype.setItem; window.__restoreWrite = () => Storage.prototype.setItem = old; Storage.prototype.setItem = function(k,v) { if(k === 'routeflow.travels.v1') throw new DOMException('quota','QuotaExceededError'); return old.call(this,k,v); }; });
    await p.click('#dayRevisionApply'); await p.waitForFunction(() => document.querySelector('#dayRevisionStatus').textContent.includes('저장할 수 없'));
    assert.deepEqual((await latest(p)).records, original.records); await p.evaluate(() => __restoreWrite());
    // A second tab changes the same travel after preview; CAS refuses overwrite.
    const q = await c.newPage(); await q.goto(BASE); await q.evaluate(id => { const k = 'routeflow.travels.v1'; const data=JSON.parse(localStorage.getItem(k)); data[id].name = '다른 탭에서 변경'; localStorage.setItem(k, JSON.stringify(data)); }, original.id);
    await p.click('#dayRevisionApply'); await p.waitForFunction(() => document.querySelector('#dayRevisionStatus').textContent.includes('다른 탭'));
    assert.equal((await latest(p)).name, '다른 탭에서 변경');
    await q.close();
    assert.deepEqual(errors, []);
    results.push({ width, status: '통과', mode: '모의 Gemini/Google SDK 및 지도', checks: ['엑셀 업로드·빈 날짜 상속·날짜 선택', '미리보기 원본 유지·잠금', '하루 적용·메모/추가 열/다른 날짜/좌표 보존', '되돌리기', '잠금 위반·429·중복 제출·취소 후 늦은 응답', '저장 실패·다른 탭 충돌 시 원본 유지'], calls });
    await c.close(); console.log(width, 'PASS');
  } fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2)); }
  finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
