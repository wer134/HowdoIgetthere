import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {createStaticServer} from './http-server.js';
import {createAccountApi} from '../backend/api.js';
import {accountConfig} from '../backend/config.js';

const out = process.argv[2] || '.omo/evidence/performance-followup/startup.json';
const api = createAccountApi({config:accountConfig({})});
const server = createStaticServer({root:path.resolve('dist'),production:true,api:api.handle});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let browser;
const rows = [];
try {
  browser = await chromium.launch({channel:'chrome',headless:true});
  for (const viewport of [{width:390,height:844},{width:1440,height:1000}]) {
    const context = await browser.newContext({viewport});
    const page = await context.newPage();
    let releaseModule;
    const gate = new Promise(resolve => {releaseModule=resolve;});
    await page.route('**/js/app.js*',async route => {await gate;await route.continue();});
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'commit'});
    await page.waitForFunction(() => document.querySelector('.page-content') && document.styleSheets.length>=3);
    const before = await page.locator('.left-column').boundingBox();
    releaseModule();
    await page.waitForFunction(() => document.getElementById('workspaceBoard').hidden && document.getElementById('workspaceBoard').classList.contains('workspace'));
    const after = await page.locator('.left-column').boundingBox();
    assert.equal(after.y,before.y,'Initializing an empty workspace must not move the visible planner');
    await page.click('#newTravel');
    await page.fill('#travelName','성능 회귀 여행');
    await page.fill('#travelStart','2026-11-10');
    await page.click('#newTravelForm button');
    await page.waitForFunction(() => !document.getElementById('workspaceBoard').hidden);
    rows.push({viewport,beforeTop:before.y,afterTop:after.y,delta:after.y-before.y,newTravelBoardVisible:true});
    await context.close();
  }
  await fs.mkdir(path.dirname(out),{recursive:true});
  await fs.writeFile(out,JSON.stringify(rows,null,2));
  console.log(JSON.stringify(rows));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  api.close();
}
