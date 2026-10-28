import test from 'node:test';
import assert from 'node:assert/strict';
import { planWithAI, planToWorkbook, listGeminiModels } from '../js/planner.js';
import { createRequire } from 'node:module';
globalThis.XLSX = createRequire(import.meta.url)('../vendor/xlsx.full.min.js');
const req = { region: '부산', days: 1, start: '', interests: [], pace: 'normal', transport: 'transit' };
const plan = { title: '부산 여행', summary: '부산 하루', tips: [], days: [{ date: '', city: '부산', theme: '바다', items: [{ start: '10:00', end: '11:00', kind: 'place', title: '해변 산책', place_ko: '해운대해수욕장', place: '해운대해수욕장', search: '해운대해수욕장 부산', mode: '', memo: '' }] }] };
const raw = JSON.stringify(plan);
const responses = {
  openai: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: raw }] }] },
  gemini: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: raw }] } }] },
};
for (const provider of ['openai', 'gemini']) {
  test(`${provider}: 요청·수정 지시·일정 변환·엑셀 내보내기`, async (t) => {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert(!url.includes('test-key'));
      const body = JSON.parse(options.body);
      assert(!options.body.includes('test-key'));
      if (provider === 'openai') {
        assert.equal(url, 'https://api.openai.com/v1/responses');
        assert.equal(options.headers.Authorization, 'Bearer test-key');
        assert.equal(body.model, 'custom-model');
        assert.equal(body.text.format.type, 'json_schema');
        assert(body.input.includes('휴관일 수정'));
      } else {
        assert(url.endsWith('/custom-model:generateContent'));
        assert.equal(options.headers['x-goog-api-key'], 'test-key');
        assert.equal(body.generationConfig.responseMimeType, 'application/json');
        assert(body.contents[0].parts[0].text.includes('휴관일 수정'));
      }
      return Response.json(responses[provider]);
    });
    const result = await planWithAI(req, { provider, apiKey: 'test-key', model: 'custom-model', previous: raw, issues: ['휴관일 수정'] });
    assert.equal(result.plan.days[0].items[0].place, '해운대해수욕장');
    assert.equal(result.cost, null);
    const file = planToWorkbook(result.plan, req, provider);
    const workbook = XLSX.read(file.buffer, { type: 'array' });
    assert(workbook.SheetNames.includes('일정표'));
    assert(workbook.Sheets['일정표'].A1.v.includes(provider === 'openai' ? 'OpenAI' : 'Google Gemini'));
  });
}
for (const status of [401, 402, 403, 429, 400, 500]) {
  test(`API 오류 ${status}는 사용자에게 전달`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status }));
    await assert.rejects(planWithAI(req, { provider: 'openai', apiKey: 'test' }), new RegExp(String(status)));
  });
}
for (const [provider, response] of [
  ['openai', { status: 'incomplete' }],
  ['openai', { status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }],
  ['gemini', { candidates: [{ finishReason: 'MAX_TOKENS' }] }],
  ['gemini', { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '잘못된 JSON' }] } }] }],
  ['gemini', { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"days":[]}' }] } }] }],
]) {
  test(`${provider}: 불완전하거나 잘못된 일정은 사용하지 않음 ${JSON.stringify(response).slice(0,65)}`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json(response));
    await assert.rejects(planWithAI(req, { provider, apiKey: 'test' }));
  });
}
test('빈 키와 미지원 제공업체는 요청 전에 거부', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('호출되면 안 됨'); });
  await assert.rejects(planWithAI(req, { provider: 'other', apiKey: 'test' }), /지원하지/);
  await assert.rejects(planWithAI(req, { provider: 'openai', apiKey: '' }), /API 키/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('Gemini 모델 목록에서 generateContent 지원 모델만 고른다', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    assert(!String(url).includes('test-key'));
    return Response.json({ models: [
      { name: 'models/gemini-working', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-embedding', supportedGenerationMethods: ['embedContent'] },
    ] });
  });
  assert.deepEqual(await listGeminiModels('test-key'), ['gemini-working']);
});

test('Gemini 404는 키를 가리고 Google 상세 오류를 보여 준다', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'models/old is not found for API version v1beta. key=test-key' } }, { status: 404 }));
  await assert.rejects(planWithAI(req, { provider: 'gemini', apiKey: 'test-key' }), (err) => {
    assert.match(err.message, /models\/old is not found/);
    assert.match(err.message, /사용 가능한 모델 확인/);
    assert(!err.message.includes('test-key'));
    return true;
  });
});

test('Gemini 402는 선불 크레딧 소진을 안내한다', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'Your prepayment credits are depleted.' } }, { status: 402 }));
  await assert.rejects(planWithAI(req, { provider: 'gemini', apiKey: 'test-key' }), (err) => {
    assert.match(err.message, /prepayment credits are depleted/);
    assert.match(err.message, /선불 크레딧/);
    assert.doesNotMatch(err.message, /잠시 후 다시 시도/);
    return true;
  });
});
