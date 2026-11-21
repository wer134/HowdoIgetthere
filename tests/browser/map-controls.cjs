const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');

async function main() {
  const project = path.resolve(__dirname, '../..');
  const {createStaticServer} = await import('../../tools/http-server.js');
  let server, browser;
  try {
    let url = process.env.APP_URL;
    if (!url) {
      server = createStaticServer({root:project});
      await new Promise((resolve,reject) => server.once('error',reject).listen(0,'127.0.0.1',resolve));
      url = 'http://127.0.0.1:' + server.address().port;
    }
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {});
    const page = await browser.newPage({hasTouch:true, viewport:{width:390,height:844}});
    await page.route('https://**/*',route => route.abort());
    await page.route(/\/js\/mapview\.js(?:\?.*)?$/,route => route.fulfill({path:path.join(project,'docs/testing/repro/mapview-mock.js'),contentType:'application/javascript'}));
    await page.addInitScript({path:path.join(project,'docs/testing/repro/google-mock.js')});
    await page.addInitScript(() => localStorage.setItem('googleMapsApiKey','TEST_ONLY'));
    await page.goto(url);
    await page.click('#newTravel');
    await page.fill('#travelName','지도 조작 확인');
    await page.fill('#travelStart','2026-12-04');
    await page.click('#newTravelForm button');
    await page.click('[data-workspace-mode=map]');
    await page.waitForFunction(() => !document.querySelector('#zoomOut').disabled && !document.querySelector('#toast').classList.contains('is-visible'));
    await page.evaluate(() => {
      window.mapActions = [];
      window.__map.setMapType = type => window.mapActions.push(type);
      window.__map.zoomBy = delta => window.mapActions.push(delta);
    });
    for (const [width,height] of [[320,568],[390,844],[768,1024],[844,390],[1024,768],[1440,900]]) {
      await page.setViewportSize({width,height});
      await page.evaluate(() => { window.mapActions.length = 0; });
      for (const selector of ['[data-type=hybrid]','#zoomOut','[data-type=roadmap]','#zoomIn']) {
        const point = await page.locator(selector).evaluate(button => {
          const r = button.getBoundingClientRect();
          const x = r.x + r.width/2, y = r.y + r.height/2;
          const hit = document.elementFromPoint(x,y);
          return {x,y,hit:button.contains(hit),coveredBy:hit?.id || hit?.className};
        });
        assert.ok(point.hit, width+'×'+height+' '+selector+' is covered by '+point.coveredBy);
        await page.touchscreen.tap(point.x,point.y);
      }
      assert.deepEqual(await page.evaluate(() => window.mapActions),['hybrid',-1,'roadmap',1]);
      console.log(width+'×'+height+' map type and zoom passed');
    }
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
