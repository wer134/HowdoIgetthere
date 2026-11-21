const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');
const {startMemberFixture} = require('./member-fixture.cjs');

(async () => {
  const fixture = await startMemberFixture({root:path.resolve(process.env.EDITOR_TEST_ROOT || 'dist')});
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
  const context = await browser.newContext();
  const errors = [];
  const origin = fixture.origin;
  const editor = origin + '/editor.html';
  const login = async sub => context.addCookies([{name:'routeflow_session', value:fixture.memberToken(sub), url:origin, httpOnly:true}]);
  try {
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await login('editor-owner');
    await page.goto(editor + '?action=new');
    await page.locator('#travelDialog[open]').waitFor();
    const owner = (await (await page.request.get(origin + '/api/session')).json()).user;
    await page.fill('#travelName', '내 첫 일정');
    await page.fill('#travelStart', '2026-11-22');
    await page.locator('#newTravelForm').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await page.waitForURL('**/editor.html?travel=*');
    await page.locator('#travelDialog').waitFor({state:'hidden'});
    const id = new URL(page.url()).searchParams.get('travel');
    assert.equal(fixture.api.store.listTravels(owner.id).length, 1);
    assert.equal(fixture.api.store.getTravel(owner.id, id).snapshot.dates.length, 3);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#fileName').textContent === '내 첫 일정');
    assert.equal(await page.evaluate(() => localStorage.getItem('routeflow.travels.v1')), null);

    // A same-origin device backup only enters this account after choosing its copy action.
    const legacy = {...fixture.api.store.getTravel(owner.id, id).snapshot, id:'legacy', name:'기기 원본'};
    await page.evaluate(trip => localStorage.setItem('routeflow.travels.v1', JSON.stringify({legacy:trip})), legacy);
    await page.goto(editor + '?action=account');
    await page.locator('[data-account-travel]').waitFor();
    assert.equal(await page.locator('#continueTravel').isVisible(), false);
    assert.equal(fixture.api.store.listTravels(owner.id).length, 1);
    await page.click('#accountLegacy');
    const exported = page.waitForEvent('download');
    await page.click('[data-device-backup="legacy"]');
    const backup = await exported;
    assert.match(backup.suggestedFilename(),/RouteFlow.json$/);
    const backupPath = await backup.path();
    await page.click('[data-travel-open="legacy"]');
    await page.waitForURL('**/editor.html?travel=*');
    assert.equal(fixture.api.store.listTravels(owner.id).length, 2);

    await page.goto(editor + '?action=import');
    await page.locator('#importDialog[open]').waitFor();
    const chooser = page.waitForEvent('filechooser');
    await page.click('#chooseWorkbook');
    await (await chooser).setFiles(path.resolve('지도_양식.xlsx'));
    await page.waitForURL('**/editor.html?travel=*');
    const imported = fixture.api.store.getTravel(owner.id, new URL(page.url()).searchParams.get('travel')).snapshot;
    assert.ok(imported.records.length > 0);
    assert.equal(imported.name, '지도_양식');
    const originals = await page.evaluate(() => JSON.parse(localStorage.getItem('routeflow.travels.v1')));
    assert.deepEqual(originals, {legacy});

    await page.goto(editor + '?action=account');
    await page.click('#accountClose');
    await page.locator('#travelBackupInput').setInputFiles(backupPath);
    await page.waitForURL('**/editor.html?travel=*');
    const restoredId = new URL(page.url()).searchParams.get('travel');
    const restored = fixture.api.store.getTravel(owner.id,restoredId);
    assert.deepEqual(restored.snapshot.dates,legacy.dates);
    assert.match(restored.snapshot.name,/복원본/);
    await page.locator('[data-account-open]').first().click();
    const remove = page.locator('[data-delete-trip="'+restoredId+'"]');
    const cancel = page.waitForEvent('dialog').then(d=>d.dismiss());
    await Promise.all([cancel,remove.click()]);
    assert.equal(fixture.api.store.getTravel(owner.id,restoredId).id,restoredId);
    const confirm = page.waitForEvent('dialog').then(d=>d.accept());
    await Promise.all([confirm,remove.click()]);
    await page.waitForURL('**/editor.html?action=account');
    assert.ok(!fixture.api.store.listTravels(owner.id).some(t=>t.id===restoredId));
    await page.click('#accountLogout');
    await page.waitForURL(origin + '/');
    await login('editor-other');
    await page.goto(editor + '?action=account');
    await page.waitForFunction(() => document.querySelector('#accountTravels')?.textContent.includes('아직'));
    assert.equal(await page.locator('[data-account-travel]').count(), 0);
    await page.goto(editor + '?travel=' + id);
    await page.waitForFunction(() => Boolean(document.querySelector('#accountMessage')?.textContent));
    assert.equal(await page.locator('#fileName').textContent(), '');
    // Account cookies can change while an old tab still holds a private editor.
    await login('editor-owner');
    await page.goto(editor + '?action=new');
    await page.locator('#travelDialog[open]').waitFor();
    await page.fill('#travelName', '이전 계정에서만 보이는 일정');
    await login('editor-other');
    const other = (await (await page.request.get(origin + '/api/session')).json()).user;
    await page.locator('#newTravelForm').evaluate(form => form.requestSubmit());
    await page.waitForURL(origin + '/');
    assert.equal(fixture.api.store.listTravels(other.id).length, 0);
    assert.deepEqual(errors, []);
    console.log('Authenticated new, reopen, explicit legacy copy, Excel import and owner isolation passed');
  } finally {
    await browser.close();
    await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
