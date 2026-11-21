const {openDeviceEditor} = require('./member-fixture.cjs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const XLSX = require('../../vendor/xlsx.full.min.js');

const base = process.env.APP_URL || 'http://127.0.0.1:8096';
const headers = ['장소', '날짜', '시간', '메모'];

function workbook(rows) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), '여행');
  return {
    name: '여행 일정.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(XLSX.write(book, { type: 'array', bookType: 'xlsx' })),
  };
}

async function importTrip(page, rows) {
  await page.locator('#fileInput').setInputFiles(workbook(rows));
  await page.waitForFunction(name => Array.from(document.querySelectorAll('#resultList .item-name')).some(el => el.textContent === name), rows[0][0]);
}

async function openBudget(page) {
  await page.locator('[data-open="workspaceTools"]:visible').first().click();
  const firstDay = page.locator('[data-budget-day]').first();
  if (await firstDay.getAttribute('aria-expanded') === 'false') await firstDay.click();
}

async function setAmount(page, index, amount) {
  await page.locator(`[data-amount="${index}"]`).click();
  const input = page.locator(`[data-amount-input="${index}"]`);
  await input.fill(amount);
  await input.press('Enter');
}

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    let lastConfirmation = '';
    let useLegacy = false;
    page.on('dialog', dialog => {
      lastConfirmation = dialog.message();
      return useLegacy || lastConfirmation.includes('삭제할까요') ? dialog.accept() : dialog.dismiss();
    });
    await openDeviceEditor(page, base);

    await importTrip(page, [
      ['점심 식당 A', '2026-12-07', '12:30', '점심 12000원'],
      ['점심 식당 A', '2026-12-07', '13:30', '점심 13000원'],
    ]);
    const amounts = () => page.locator('.budget-line .bl-amount').allInnerTexts();
    const closeBudget = () => page.locator('#workspaceTools .dialog-x').click();
    await openBudget(page);
    await setAmount(page, 0, '59000');
    assert.deepEqual(await amounts(), ['59,000원', '13,000원']);
    await setAmount(page, 1, '23000');
    await closeBudget();

    await importTrip(page, [['점심 식당 B', '2026-12-25', '12:30', '점심 8000원']]);
    await openBudget(page);
    assert.equal(await page.locator('.budget-line .bl-amount').innerText(), '8,000원');
    assert.equal(await page.locator('.budget-day-sum strong').innerText(), '8,000원');
    await closeBudget();

    const legacy = '{"여행 일정.xlsx|여행":{"2":47000}}';
    await page.evaluate(value => localStorage.setItem('budgetOverrides.v1', value), legacy);
    await page.locator('[data-open="workspaceTools"]:visible').first().click();
    await page.locator('[data-budget-day]').first().click();
    await page.locator('[data-budget-day]').first().click();
    const recover = page.locator('[data-recover-amount]');
    await recover.click();
    assert.match(lastConfirmation, /여행 일정.*점심 식당 B/);
    assert.deepEqual(await amounts(), ['8,000원']);
    useLegacy = true;
    await recover.click();
    assert.deepEqual(await amounts(), ['47,000원']);
    assert.equal(await page.evaluate(() => localStorage.getItem('budgetOverrides.v1')), legacy);
    await closeBudget();

    const id = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('routeflow.travels.v1')))
      .find(trip => trip.records[0].cells[0].v === '점심 식당 A').id);
    await page.click('#savedTravels');
    await page.locator(`[data-travel-open="${id}"]`).click();
    await openBudget(page);
    assert.deepEqual(await amounts(), ['59,000원', '23,000원']);
    await closeBudget();

    await page.locator('[data-workspace-mode="board"]').click();
    await page.getByRole('button', { name: '점심 식당 A 앞으로', exact: true }).last().click();
    await page.waitForFunction(id => JSON.parse(localStorage.getItem('routeflow.travels.v1'))[id].records[0].cells[2].v === '13:30', id);
    await openBudget(page);
    assert.deepEqual(await amounts(), ['23,000원', '59,000원']);
    await closeBudget();

    await page.getByRole('button', { name: '점심 식당 A 편집', exact: true }).last().click();
    await page.locator('#scheduleName').fill('이름을 고친 식당');
    await page.locator('#scheduleForm button[type=submit]').click();
    if (await page.locator('#placePanelClose').isVisible()) await page.locator('#placePanelClose').click();
    await openBudget(page);
    assert.match(await page.locator('.budget-line .bl-title').last().innerText(), /이름을 고친 식당/);
    assert.deepEqual(await amounts(), ['23,000원', '59,000원']);
    await closeBudget();

    await page.locator('[data-workspace-mode="map"]').click();
    await page.locator('#resultList [data-action="delete"]').first().click();
    await page.waitForFunction(() => document.querySelectorAll('#resultList .item-name').length === 1);
    await page.locator('#scheduleAdd').click();
    await page.locator('#scheduleName').fill('새 점심 식당');
    await page.locator('#scheduleTime').fill('13:30');
    await page.locator('#scheduleMemo').fill('점심 9000원');
    await page.locator('#scheduleForm button[type=submit]').click();
    await page.waitForFunction(id => JSON.parse(localStorage.getItem('routeflow.travels.v1'))[id].records.some(record => record.cells[0].v === '새 점심 식당' && record.rowNumber === 3), id);
    await openBudget(page);
    assert.deepEqual(await amounts(), ['59,000원', '9,000원']);
    assert.deepEqual(errors, []);
    console.log('같은 파일명, 이전 금액 확인, 여행 재개, 반복 방문 이동·이름 변경 및 삭제 행 재사용을 검증했습니다.');
  } finally {
    await browser.close();
  }
}

run().catch(err => { console.error(err); process.exitCode = 1; });
