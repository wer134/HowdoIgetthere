const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {randomBytes} = require('node:crypto');

// Loopback-only server with the real account API, SQLite store and session validation.
// The identity provider is the only server dependency replaced here.
async function startMemberFixture({root = path.resolve('dist'), port = 0} = {}) {
  const {accountConfig} = await import('../../backend/config.js');
  const {createAccountApi} = await import('../../backend/api.js');
  const {createStaticServer} = await import('../../tools/http-server.js');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'routeflow-members-'));
  let api;
  const server = createStaticServer({
    root, production: true,
    api: (req, res) => api.handle(req, res),
    authorizeEditor: req => api.isMember(req),
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const config = accountConfig({
    ACCOUNT_ORIGIN: origin, ACCOUNT_SECRET: randomBytes(32).toString('hex'),
    GOOGLE_OAUTH_CLIENT_ID: 'browser-test', GOOGLE_OAUTH_CLIENT_SECRET: 'browser-test',
    ACCOUNT_DB_PATH: path.join(temp, 'accounts.sqlite'),
  });
  api = createAccountApi({config, providers: {
    authorizationUrl: async flow => origin + '/api/auth/callback?code=test&state=' + encodeURIComponent(flow.state),
    exchange: async () => ({sub:'owner-test', name:'테스트 주인', email:'owner@example.test'}),
  }});
  return {
    origin, api,
    memberToken(sub) {
      const user = api.store.upsertUser({sub, name:'회귀 테스트', email:sub + '@example.test'});
      return api.store.createSession(user.id);
    },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      api.close();
      await fs.rm(temp, {recursive:true, force:true});
    },
  };
}

async function authenticateMember(page, origin) {
  const token = process.env.REGRESSION_MEMBER_TOKEN;
  if (!token) throw new Error('Run browser regressions with REGRESSION_ONLY=<suite> node tests/browser/rebuild-regressions.cjs');
  await page.context().addCookies([{name:'routeflow_session', value:token, url:origin, httpOnly:true, sameSite:'Lax'}]);
}

async function openNewMemberTravel(page, origin) {
  await authenticateMember(page, origin);
  await page.goto(new URL('/editor.html?action=new', origin).href);
  await page.waitForSelector('#travelDialog[open]');
}

// These regressions cover legacy on-device data, storage failures and migration.
// Authenticate the real server request. Only in this Playwright page, mount the
// existing device editor module directly so old device workflows can be exercised.
async function openDeviceEditor(page, origin, options) {
  await authenticateMember(page, origin);
  const url = new URL('/editor.html', origin).href;
  await page.route(url, async route => {
    const response = await route.fetch({maxRedirects:0});
    if (response.status() !== 200) throw new Error('Authenticated editor returned ' + response.status());
    const html = await response.text();
    if (!html.includes('js/editor-entry.js')) throw new Error('Editor entry module is missing');
    const body = html.replace('js/editor-entry.js', 'js/app.js').replace(/(<body\b[^>]*?)\s+inert\b/i, '$1');
    await route.fulfill({response, body});
  });
  return page.goto(url, options);
}
module.exports = {startMemberFixture, authenticateMember, openNewMemberTravel, openDeviceEditor};
