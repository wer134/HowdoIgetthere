const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const { createStaticServer } = await import('../../tools/http-server.js');
  const server = createStaticServer({root: path.resolve(__dirname, '../../dist'), production:true});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    let user = {id:'first'};
    await page.route('**/api/session', route => route.fulfill({json:{available:true,user}}));
    await page.route('**/editor.html*', route => route.fulfill({body:'editor'}));
    await page.goto(origin);
    const select = (container, item) => page.locator(container + ' ' + item);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({width, height:840});
      for (const city of ['busan', 'seoul', 'tokyo']) {
        await page.locator('[data-city="' + city + '"]').click();
        if (width <= 720) await page.locator('[data-view=list]').click();
        await select('#stops', '[data-leg="1"]').click();
        if (width <= 720) await page.locator('[data-view=map]').click();
        assert.equal(await select('#schematic', '[data-leg="1"]').getAttribute('aria-pressed'), 'true');
        await select('#schematic', '[data-stop="2"]').focus();
        await page.keyboard.press('Enter');
        assert.equal(await select('#stops', '[data-stop="2"]').getAttribute('aria-pressed'), 'true');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
    }
    // A different tab logs out after this page rendered the member controls.
    user = null;
    await page.locator('[data-action=new]').click();
    await page.locator('#authDialog[open]').waitFor();
    assert.match(await page.locator('#authMessage').innerText(), /빈 일정/);
    await page.locator('#authCancel').click();
    // Another tab signs into a new account. Copy must be bound to this identity.
    user = {id:'second'};
    let copyUser;
    await page.route('**/api/examples/tokyo/copy', route => {
      copyUser = route.request().headers()['x-routeflow-user'];
      return route.fulfill({json:{travel:{id:'second-copy'}}});
    });
    await page.locator('[data-action=copy]').click();
    await page.waitForURL(origin + '/editor.html?travel=second-copy');
    assert.equal(copyUser, 'second');
    // First request loses the SDK script. The next reaches the SDK but authorization
    // fails while constructing the map. The last retry uses the latest selected city.
    await page.route('**/runtime-config.js', route => route.fulfill({
      contentType:'text/javascript', body:"window.APP_CONFIG={googleMapsApiKey:'fixture',mapId:'fixture'};"
    }));
    let sdkLoads = 0;
    await page.route('https://maps.googleapis.com/maps/api/js?*', route => {
      if (++sdkLoads === 1) return route.abort();
      return route.fulfill({contentType:'text/javascript', body:`
        const lib = {
          Map:class {constructor(){if(!window.failedOnce){window.failedOnce=true;window.gm_authFailure();}} addListener(){} fitBounds(){}},
          LatLngBounds:class {extend(){}}, InfoWindow:class {close(){}},
          PinElement:class {}, AdvancedMarkerElement:class {addEventListener(){}},
          Polyline:class {addListener(){} setOptions(){} setMap(){}}
        };
        google.maps.importLibrary=async()=>lib;
        google.maps.__ib__();
      `});
    });
    await page.goto(origin);
    await page.locator('[data-view=map]').click();
    await page.locator('#switchMap').click();
    await page.waitForFunction(()=>!document.querySelector('#switchMap').disabled);
    assert.ok(await page.locator('#schematic').isVisible());
    await page.locator('#switchMap').click();
    await page.waitForFunction(()=>!document.querySelector('#switchMap').disabled);
    assert.equal(sdkLoads, 2);
    assert.ok(await page.locator('#schematic').isVisible());
    await page.locator('[data-city=tokyo]').click();
    await page.locator('#switchMap').click();
    await page.locator('#liveMap').waitFor();
    assert.equal(await page.locator('#selectionTitle').textContent(), '센소지');
    console.log('Public examples, selection, cross-tab member changes and Maps failure/retry passed');
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
