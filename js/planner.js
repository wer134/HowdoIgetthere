/* global XLSX */
// 여행 일정 추천: 나라·지역·날짜·관심사로 일정표를 만들어 앱에 바로 올린다.
// 선택한 AI가 도시 배분·동선·시각을 짜고, 앱이 장소마다 구글 지도에서 찾아 위치와 그날 영업 여부를 확인한다.
// 키가 없으면 구글 지도 데이터만으로 지역의 인기 장소를 가까운 곳끼리 날짜별로 묶는다 (도시 하나 며칠에 맞다)
import { searchPlaces, languageFor, classifyError } from './places.js';
import { searchText, openState, dropParts, bayes, walkMinutes, typeLabel } from './nearby.js';
import { distanceMeters } from './routes.js';
import { RESULT_COLUMNS } from './excel.js';
import { normalizeText, similarity } from './util.js';
import { formatMoney } from './budget.js';

export const CLAUDE_MODEL = 'claude-opus-5-5';
export const AI_PROVIDERS = {
  claude: { label: 'Claude', model: CLAUDE_MODEL, keyStorage: 'anthropicApiKey' },
  openai: { label: 'OpenAI', model: 'gpt-4.1-mini', keyStorage: 'openaiApiKey' },
  gemini: { label: 'Google Gemini', model: 'gemini-2.5-flash', keyStorage: 'geminiApiKey' },
};

export async function listGeminiModels(apiKey) {
  if (!apiKey?.trim()) throw new Error('먼저 Gemini API 키를 입력해 주세요.');
  const models = [];
  let pageToken = '';
  for (let page = 0; page < 3; page++) {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    let response;
    try { response = await fetch(url, { headers: { 'x-goog-api-key': apiKey } }); }
    catch { throw new Error('Gemini 모델 목록에 연결하지 못했어요. 네트워크를 확인해 주세요.'); }
    if (!response.ok) throw new Error(`Gemini 모델 목록 오류 (${response.status}): API 키와 Generative Language API 사용 권한을 확인해 주세요.`);
    const data = await response.json();
    models.push(...(data.models || []).filter((model) => model.supportedGenerationMethods?.includes('generateContent') && /^models\/gemini-/.test(model.name)).map((model) => model.name.slice('models/'.length)));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return [...new Set(models)];
}
// Claude Opus 5.5 요금 (100만 토큰당 달러, 2026년 10월). 화면에 사용료를 어림해 보여 줄 때만 쓴다
const PRICE = { input: 4, output: 20 };
const SDK_URL = '../vendor/anthropic-sdk-0.131.0.min.js'; // ES 모듈 (어느 서버에서나 JavaScript로 받도록 .js)

export const INTERESTS = {
  sights: { label: '명소·역사', query: '관광 명소' },
  museum: { label: '박물관·미술관', query: '박물관 미술관' },
  nature: { label: '자연·풍경', query: '공원 정원 경치 좋은 곳' },
  food: { label: '맛집', query: '' },
  cafe: { label: '카페·디저트', query: '' },
  shopping: { label: '쇼핑', query: '쇼핑 거리 시장' },
  onsen: { label: '온천', query: '온천' },
  night: { label: '야경', query: '야경 전망대' },
  kids: { label: '아이와 함께', query: '아이와 가볼 만한 곳' },
};
const PACE_TEXT = { tight: '빠듯하게 (하루 5~6곳)', normal: '보통 (하루 3~4곳)', relaxed: '여유롭게 (하루 2~3곳)' };
const PACE_STOPS = { tight: 5, normal: 4, relaxed: 3 };
const PACE_START = { tight: 9 * 60, normal: 9 * 60 + 30, relaxed: 10 * 60 };

/* ── 날짜 ── */

const WEEK = '일월화수목금토';
const pad2 = (n) => String(n).padStart(2, '0');
const hm = (m) => `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
const toMin = (s) => {
  const m = String(s ?? '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

function parseIso(s) {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// 앱이 읽는 날짜 칸 모양: "11/28 (토)"
const dateLabel = (date, i) => (date ? `${date.getMonth() + 1}/${date.getDate()} (${WEEK[date.getDay()]})` : `${i + 1}일차`);

/* ── Claude로 짜기 ── */

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    start: { type: 'string', description: '시작 시각 HH:MM (24시간)' },
    end: { type: 'string', description: '끝 시각 HH:MM. 열차 출발처럼 시각이 하나면 빈 문자열' },
    kind: { type: 'string', enum: ['place', 'travel', 'meal', 'stay', 'free'] },
    title: { type: 'string', description: '무엇을 하는지 한국어로' },
    place_ko: { type: 'string', description: '장소의 한국어 이름. place·stay가 아니면 빈 문자열' },
    place: { type: 'string', description: '구글 지도에 나오는 현지어 정식 이름. place·stay가 아니면 빈 문자열' },
    search: { type: 'string', description: '구글 지도 검색어: 현지어 이름과 도시. place·stay가 아니면 빈 문자열' },
    mode: { type: 'string', description: 'travel의 이동 수단. 아니면 빈 문자열' },
    memo: { type: 'string', description: '1인 금액(현지 통화)·예약·휴관·팁. 없으면 빈 문자열' },
  },
  required: ['start', 'end', 'kind', 'title', 'place_ko', 'place', 'search', 'mode', 'memo'],
  additionalProperties: false,
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '일정 제목 (예: 규슈 4박 5일 · 후쿠오카·벳푸)' },
    summary: { type: 'string', description: '일정 전체를 두세 문장으로' },
    tips: { type: 'array', items: { type: 'string' }, description: '교통 패스·예약·계절·가정한 것 등 3~6개' },
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD. 날짜를 모르면 빈 문자열' },
          city: { type: 'string', description: '그날 주로 머무는 도시 (한국어)' },
          theme: { type: 'string', description: '그날을 한 줄로' },
          items: { type: 'array', items: ITEM_SCHEMA },
        },
        required: ['date', 'city', 'theme', 'items'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'summary', 'tips', 'days'],
  additionalProperties: false,
};

const SYSTEM = `당신은 한국인 여행자를 위해 실제로 다닐 수 있는 여행 일정을 짜는 여행 플래너입니다.
결과는 엑셀 일정표가 되어 지도 앱에 올라가고, 앱이 장소마다 구글 지도에서 찾아 위치와 그날 영업 여부를 확인합니다. 앱은 끼니마다 주변 맛집을 따로 추천하고, 메모의 금액으로 하루 예산을 셉니다.

하루는 시간 순서의 행 목록입니다. 행 종류(kind):
- place: 들르는 곳. place에는 구글 지도에 나오는 현지어 정식 이름(일본은 일본어, 한국은 한국어, 그 밖은 현지어나 영어), place_ko에는 한국어 이름, search에는 현지어 이름과 도시를 함께(예: "太宰府天満宮 太宰府市"). title은 한국어로 무엇을 하는지(예: "다자이후텐만구 참배, 참배길 산책").
- travel: 장소 사이 이동. 탈것을 타거나 10분 넘게 걷는 이동은 반드시 넣습니다. mode는 구체적으로("지하철 공항선", "JR 특급 소닉", "니시테츠 버스 47번", "도보 약 15분"), title은 "하카타역 → 텐진". place는 비웁니다.
- meal: 아침·점심·저녁(카페는 원할 때만). 가게는 정하지 않고 place를 비웁니다. title은 "점심 (그때 있을 곳 주변) (그 지역에서 먹어 볼 음식 1~2가지)" 모양으로. 예: "점심 (캐널시티 하카타 주변) (하카타 라멘·모츠나베)". 첫 괄호의 곳은 그날 일정의 장소 이름과 같게 씁니다.
- stay: 숙소 체크인·짐 맡기기. 숙소를 알려 주면 그 이름을 place로, 아니면 묵기 좋은 곳의 대표 장소(역 등)를 place로 하고 title에 "숙소 체크인 (하카타역 주변 추천)"처럼 씁니다.
- free: 쉬는 시간·자유 시간. place를 비웁니다.

규칙:
- 시각은 24시간 HH:MM. 행끼리 겹치지 않게, 이동은 실제로 걸리는 만큼(기다림·환승 포함) 잡습니다.
- 그 날짜의 요일에 쉬거나 그 시각에 닫는 곳은 넣지 않습니다. 확실히 있고 지금도 운영하는 곳만 넣습니다.
- 첫날은 도착 이동(공항 → 시내 등)으로 시작하고 마지막 날은 떠나는 이동으로 끝냅니다. 항공편 시각을 모르면 첫날 11시쯤 도착, 마지막 날 16시쯤 출발로 가정하고 tips에 그 가정을 적습니다.
- 나라나 넓은 지역이면 도시를 나누어 되돌아가는 이동이 적게 짜고, 짐을 들고 도시를 옮기는 이동은 memo에 "[짐]"을 붙입니다.
- memo에는 입장료·교통비처럼 1인 금액을 아는 대로 현지 통화로 "1,000엔"처럼 적습니다(확실하지 않으면 "약 "을 붙임). 예약이 필요한 곳·휴관일·꼭 알아 둘 점도 짧게 적습니다.
- 하루 예산을 주면 숙박을 뺀 교통비·입장료·식비가 그 안에 들도록 고릅니다.
- summary는 일정 전체를 두세 문장으로, tips는 교통 패스·예약·계절 정보·가정한 것 등 3~6개.`;

function requestText(req) {
  const start = parseIso(req.start);
  const dates = start ? Array.from({ length: req.days }, (_, i) => {
    const d = addDays(start, i);
    return `${isoOf(d)} (${WEEK[d.getDay()]})`;
  }).join(', ') : '';
  return [
    `여행지: ${req.region}`,
    start ? `날짜: ${dates}` : `기간: ${req.days}일 (날짜는 정하지 않음 — date는 빈 문자열로)`,
    `숙소: ${req.stay || '정하지 않음 — 묵기 좋은 지역을 골라 주세요'}`,
    `관심사: ${req.interests.map((k) => INTERESTS[k]?.label).filter(Boolean).join(', ') || '특별히 없음'}`,
    `여유 정도: ${PACE_TEXT[req.pace] || PACE_TEXT.normal} (끼니·이동 빼고)`,
    `이동: ${req.transport === 'car' ? '렌터카' : '대중교통과 도보'}`,
    req.budget ? `하루 예산 (1인, 숙박 제외): ${formatMoney(req.budget.amount, req.budget.currency)}` : '',
    req.notes ? `더 바라는 점: ${req.notes}` : '',
  ].filter(Boolean).join('\n');
}

let sdk = null;
async function claude(apiKey) {
  sdk ??= import(new URL(SDK_URL, import.meta.url).href);
  const { default: Anthropic } = await sdk;
  // 이 앱은 서버 없이 브라우저에서 바로 부른다. 키는 사용자의 브라우저에만 저장된다
  return { Anthropic, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) };
}

function claudeError(err, Anthropic) {
  if (err instanceof Anthropic.AuthenticationError) return new Error('Claude API 키가 맞지 않아요. 설정에서 키를 확인해 주세요.');
  if (err instanceof Anthropic.PermissionDeniedError) return new Error('이 API 키로는 이 모델을 쓸 수 없어요. Anthropic 콘솔에서 권한을 확인해 주세요.');
  if (err instanceof Anthropic.RateLimitError) return new Error('Claude 요청 한도를 넘었어요. 잠시 뒤 다시 시도해 주세요.');
  if (err instanceof Anthropic.BadRequestError) return new Error(`Claude가 요청을 받지 않았어요. 크레딧 잔액도 확인해 주세요. (${err.message})`);
  if (err instanceof Anthropic.APIConnectionError) return new Error('Claude에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
  if (err instanceof Anthropic.APIError) return new Error(`Claude 오류 ${err.status ?? ''}: ${err.message}`);
  return err;
}

/**
 * Claude에게 일정 초안을 받는다. previous가 있으면 그 일정에서 issues만 고쳐 달라고 한다
 * @param {(p: {chars: number, days: number}) => void} onProgress 받는 동안 글자 수·쓰고 있는 날
 * @returns {Promise<{plan, raw: string, cost: number, model: string}>}
 */
export async function planWithClaude(req, { apiKey, onProgress, previous = null, issues = [], model = CLAUDE_MODEL }) {
  const { Anthropic, client } = await claude(apiKey);
  let content = requestText(req);
  if (previous) {
    content += `\n\n앞서 짠 일정(JSON):\n${previous}\n\n구글 지도로 확인했더니 아래 문제가 있었어요. 이 부분만 고친 전체 일정을 다시 주세요. 문제없는 부분은 그대로 둡니다.\n${issues.map((s) => `- ${s}`).join('\n')}`;
  }
  let text = '';
  try {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 64000,
      // 안전 분류기가 거절하면 서버가 알맞은 모델로 다시 돌린다
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
    stream.on('text', (delta) => {
      text += delta;
      onProgress?.({ chars: text.length, days: (text.match(/"items"\s*:/g) || []).length });
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('Claude가 이 요청에 답하지 않았어요. 요청 내용을 바꿔 다시 시도해 주세요.');
    if (message.stop_reason === 'max_tokens') throw new Error('일정이 너무 길어 끝까지 받지 못했어요. 기간을 줄여 다시 시도해 주세요.');
    const raw = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let plan;
    try {
      plan = JSON.parse(raw);
    } catch {
      throw new Error('Claude가 보낸 일정을 읽지 못했어요. 다시 시도해 주세요.');
    }
    const usage = message.usage || {};
    const cost = model === CLAUDE_MODEL ? ((usage.input_tokens || 0) * PRICE.input + (usage.output_tokens || 0) * PRICE.output) / 1e6 : null;
    return { plan: tidyPlan(plan, req), raw, cost, model: message.model || model };
  } catch (err) {
    throw claudeError(err, Anthropic);
  }
}

// 제공업체 응답을 같은 일정 형식으로 변환한다. 키는 요청 헤더에만 넣는다.
export async function planWithAI(req, { provider, apiKey, model, onProgress, previous = null, issues = [] }) {
  const config = AI_PROVIDERS[provider];
  if (!config) throw new Error('지원하지 않는 AI 제공업체입니다.');
  if (!apiKey?.trim()) throw new Error(`${config.label} API 키를 설정에서 입력해 주세요.`);
  model = model?.trim() || config.model;
  if (provider === 'gemini') model = model.replace(/^models\//, '');
  if (provider === 'claude') return planWithClaude(req, { apiKey, model, onProgress, previous, issues });
  let content = requestText(req);
  if (previous) content += `\n\n앞서 짠 일정(JSON):\n${previous}\n\n아래 문제만 고친 전체 일정을 주세요.\n${issues.map(x => `- ${x}`).join('\n')}`;
  const openai = provider === 'openai';
  const url = openai ? 'https://api.openai.com/v1/responses'
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = { 'Content-Type': 'application/json', ...(openai ? { Authorization: `Bearer ${apiKey}` } : { 'x-goog-api-key': apiKey }) };
  const body = openai ? {
    model, instructions: SYSTEM, input: content, max_output_tokens: 16000,
    text: { format: { type: 'json_schema', name: 'travel_plan', strict: true, schema: PLAN_SCHEMA } },
  } : {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: content }] }],
    generationConfig: { maxOutputTokens: 16000, responseMimeType: 'application/json', responseJsonSchema: PLAN_SCHEMA },
  };
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  } catch (err) {
    throw new Error(err.name === 'TimeoutError' ? `${config.label} 응답 시간이 초과됐어요. 기간을 줄여 다시 시도해 주세요.` : `${config.label}에 연결하지 못했어요. 네트워크와 브라우저 접근 허용 여부를 확인해 주세요.`);
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const serviceMessage = String(detail?.error?.message || '').replaceAll(apiKey, '[API 키]').replace(/\?key=[^\s&]+/gi, '?key=[API 키]').slice(0, 400);
    const reason = response.status === 401 || response.status === 403 ? 'API 키와 모델 사용 권한을 확인해 주세요.'
      : response.status === 429 ? '요청 한도 또는 크레딧을 확인해 주세요.'
      : response.status === 404 && !openai ? '설정에서 ‘사용 가능한 모델 확인’을 눌러 이 키로 제공되는 모델을 선택해 주세요.'
        : response.status === 400 || response.status === 404 ? '모델 이름과 구조화 출력 지원 여부를 확인해 주세요.' : '잠시 후 다시 시도해 주세요.';
    throw new Error(`${config.label} 오류 (${response.status}): ${serviceMessage || reason}${serviceMessage ? ` · ${reason}` : ''}`);
  }
  const result = await response.json();
  let raw;
  if (openai) {
    if (result.status !== 'completed') throw new Error('OpenAI 응답이 완료되지 않았어요. 일정 기간을 줄여 다시 시도해 주세요.');
    const blocks = (result.output || []).flatMap(x => x.content || []);
    if (blocks.some(x => x.type === 'refusal')) throw new Error('OpenAI가 요청을 거절했어요. 요청 내용을 바꿔 주세요.');
    raw = blocks.filter(x => x.type === 'output_text').map(x => x.text).join('');
  } else {
    const candidate = result.candidates?.[0];
    if (candidate?.finishReason !== 'STOP') throw new Error('Gemini 응답이 완료되지 않았어요. 요청 내용이나 일정 기간을 바꿔 주세요.');
    raw = (candidate.content?.parts || []).filter(x => !x.thought).map(x => x.text || '').join('');
  }
  let plan;
  try { plan = JSON.parse(raw); } catch { throw new Error(`${config.label}가 보낸 일정을 읽지 못했어요. 다시 시도해 주세요.`); }
  if (!plan || typeof plan.title !== 'string' || typeof plan.summary !== 'string' || !Array.isArray(plan.tips) || plan.tips.some(x => typeof x !== 'string') || !Array.isArray(plan.days) || !plan.days.length || plan.days.some(d => !d || !Array.isArray(d.items) || d.items.some(i => !i || typeof i.title !== 'string'))) {
    throw new Error(`${config.label}가 보낸 일정 형식이 올바르지 않아요. 다시 시도해 주세요.`);
  }
  onProgress?.({ chars: raw.length, days: plan.days.length });
  return { plan: tidyPlan(plan, req), raw, cost: null, model: result.model || result.modelVersion || model };
}

// 받은 일정을 앱이 다루기 좋게 다듬는다: 빈 값·잘못된 시각·날짜를 바로잡는다
export function tidyPlan(plan, req) {
  const start = parseIso(req.start);
  const days = (plan.days || []).slice(0, Math.max(1, req.days || 30)).map((day, i) => ({
    date: start ? isoOf(addDays(start, i)) : parseIso(day.date) ? day.date : '',
    city: String(day.city || '').trim(),
    theme: String(day.theme || '').trim(),
    items: (day.items || []).map((it) => ({
      start: toMin(it.start) != null ? it.start : '',
      end: toMin(it.end) != null ? it.end : '',
      kind: ['place', 'travel', 'meal', 'stay', 'free'].includes(it.kind) ? it.kind : 'free',
      title: String(it.title || '').trim(),
      place_ko: String(it.place_ko || '').trim(),
      place: String(it.place || '').trim(),
      search: String(it.search || '').trim(),
      mode: String(it.mode || '').trim(),
      memo: String(it.memo || '').trim(),
    })).filter((it) => it.title || it.place),
  }));
  return { title: String(plan.title || '').trim(), summary: String(plan.summary || '').trim(), tips: (plan.tips || []).map(String).filter(Boolean), days };
}

/* ── 구글 지도로 확인 ── */

/**
 * 장소마다 구글 지도에서 찾아 위치를 붙이고, 못 찾은 곳·그날 닫는 곳·엉뚱한 곳을 표시한다
 * item.found = normalizePlace 모양, item.issue = { kind: 'notfound'|'closed'|'far'|'error', text }
 */
export async function verifyPlan(plan, { onProgress, concurrency = 4 } = {}) {
  const jobs = [];
  for (const day of plan.days) {
    for (const item of day.items) {
      if ((item.kind === 'place' || item.kind === 'stay') && (item.search || item.place || item.place_ko)) jobs.push({ day, item });
    }
  }
  let done = 0;
  let fatal = null;
  const queue = [...jobs];
  const worker = async () => {
    while (queue.length && !fatal) {
      const { day, item } = queue.shift();
      const query = item.search || `${item.place || item.place_ko} ${day.city}`.trim();
      try {
        const [top] = await searchText({ query, language: languageFor(query, 'ko'), max: 3 });
        if (!top) item.issue = { kind: 'notfound', text: '구글 지도에서 찾지 못했어요' };
        else if (!sameName(top.name, [item.place, item.place_ko])) item.issue = { kind: 'mismatch', text: `구글에서 찾은 곳의 이름이 달라요: “${top.name}”` };
        else item.found = top;
      } catch (err) {
        if (classifyError(err) !== 'other') {
          fatal = err;
          return;
        }
        item.issue = { kind: 'error', text: `확인하지 못했어요 (${err?.message || err})` };
      }
      onProgress?.({ done: ++done, total: jobs.length });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (fatal) throw fatal;
  for (const day of plan.days) checkDay(day);
  return plan;
}

// 구글이 엉뚱한 곳을 돌려줄 때가 있다(없는 곳을 찾으면 비슷한 아무 곳). 이름이 한쪽에 들어 있거나 꽤 비슷하면 같은 곳으로 본다
function sameName(found, names) {
  const a = normalizeText(found);
  return names.filter(Boolean).some((n) => {
    const b = normalizeText(n);
    return a && b && (a.includes(b) || b.includes(a) || similarity(a, b) >= 0.4);
  });
}

// 그날 영업 여부와, 앞뒤 장소와 둘 다 멀리 떨어진 곳(같은 이름의 다른 곳일 수 있다)
function checkDay(day) {
  const date = parseIso(day.date);
  const found = day.items.filter((it) => it.found);
  found.forEach((item, i) => {
    const near = [found[i - 1], found[i + 1]].filter(Boolean);
    if (near.length && near.every((n) => distanceMeters(n.found, item.found) > 80000)) {
      item.issue = { kind: 'far', text: '그날 다른 곳과 멀리 떨어져 있어요. 같은 이름의 다른 곳일 수 있어요' };
    }
    const start = toMin(item.start);
    if (!date || start == null || item.kind !== 'place' || item.issue) return;
    const end = toMin(item.end);
    const open = openState(item.found, date.getDay(), start, end != null && end > start ? Math.min(end - start, 60) : 30);
    if (open.state === 'closed' || open.state === 'dayoff') item.issue = { kind: 'closed', text: open.text };
  });
}

/** 확인에서 걸린 곳 [{ day, date, item, text }] */
export function planIssues(plan) {
  return plan.days.flatMap((day, i) => day.items.filter((it) => it.issue).map((item) => ({
    day: i, label: dateLabel(parseIso(day.date), i), item, text: item.issue.text,
  })));
}

/* ── AI 없이 구글 지도 데이터만으로 짜기 ── */

// 들르는 곳 종류별 머무는 시간(분)
const STAY_MIN = {
  museum: 90, art_museum: 90, history_museum: 90, art_gallery: 60, aquarium: 120, zoo: 150, amusement_park: 180,
  park: 60, city_park: 60, garden: 60, botanical_garden: 75, national_park: 120, hiking_area: 120, beach: 60,
  shinto_shrine: 45, buddhist_temple: 45, church: 30, castle: 75, historical_landmark: 40, monument: 30,
  observation_deck: 60, market: 60, shopping_mall: 90, scenic_spot: 40, tourist_attraction: 60, spa: 90, public_bath: 90,
};
const durationOf = (p) => STAY_MIN[p.type] ?? STAY_MIN[p.types.find((t) => STAY_MIN[t])] ?? 60;
const NOT_SIGHTS = /restaurant|cafe|coffee|bakery|bar$|food|store$|lodging|hotel|inn$|hostel|station|transit|airport|parking/;

/**
 * 지역의 인기 장소를 구글 평점·리뷰 수로 골라 가까운 곳끼리 날짜별로 묶고, 머무는 시간·이동 시간으로 시각을 매긴다
 * 끼니는 빈 자리("점심 (OO 주변)")로 남겨 앱의 맛집 추천으로 고르게 한다
 */
export async function planWithGoogle(req, { language: fallbackLang = 'ko', onProgress } = {}) {
  onProgress?.({ step: 'area' });
  const [area] = await searchPlaces(req.region, { language: languageFor(req.region, fallbackLang) });
  if (!area) throw new Error(`“${req.region}”을(를) 구글 지도에서 찾지 못했어요. 도시 이름으로 적어 보세요.`);
  const center = { lat: area.lat, lng: area.lng };
  // 명소는 타베로그처럼 현지어 이름이 필요 없으니 읽기 쉬운 한국어 이름으로 받는다
  const language = fallbackLang;
  let stay = null;
  if (req.stay) {
    const [s] = await searchPlaces(`${req.stay} ${req.region}`, { language: languageFor(req.stay, fallbackLang) });
    if (s && distanceMeters(s, center) < 60000) stay = { name: s.name || req.stay, lat: s.lat, lng: s.lng };
  }

  onProgress?.({ step: 'collect' });
  const interestQueries = req.interests.map((k) => INTERESTS[k]?.query).filter(Boolean);
  const queries = [...new Set(['관광 명소', ...interestQueries])];
  const pools = await Promise.all(queries.map((q) => searchText({ query: `${req.region} ${q}`, center, radius: 25000, language })));
  const byId = new Map();
  pools.forEach((list, qi) => list.forEach((p) => {
    if (NOT_SIGHTS.test(p.type) || distanceMeters(center, p) > 40000) return;
    const known = byId.get(p.id);
    if (known) known.hits++;
    else byId.set(p.id, { ...p, hits: 1, interest: qi > 0 });
  }));
  const pool = dropParts([...byId.values()]);
  if (!pool.length) throw new Error(`“${req.region}” 둘레에서 들를 곳을 찾지 못했어요.`);
  const rated = pool.filter((p) => p.rating != null && p.count >= 20);
  const mean = rated.length ? rated.reduce((n, p) => n + p.rating, 0) / rated.length : 4.2;
  for (const p of pool) p.score = bayes(p.rating, p.count, mean, 300) + 0.12 * Math.log10(p.count + 1) + (p.interest ? 0.1 : 0) + 0.05 * (p.hits - 1);
  pool.sort((a, b) => b.score - a.score);

  // 첫날·마지막 날은 오가는 시간이 있어 한 곳씩 덜 넣는다
  const stops = PACE_STOPS[req.pace] || 4;
  const perDay = Array.from({ length: req.days }, (_, i) => Math.max(1, stops - (req.days > 1 && (i === 0 || i === req.days - 1) ? 1 : 0)));
  const picked = pool.slice(0, perDay.reduce((n, v) => n + v, 0));
  onProgress?.({ step: 'arrange' });
  const groups = cluster(picked, req.days, Math.ceil(picked.length / req.days) + 1, Math.floor(picked.length / req.days));

  const start = parseIso(req.start);
  const dates = perDay.map((_, i) => (start ? addDays(start, i) : null));
  const dayPlaces = assignGroups(groups, perDay, dates).map((g) => [...g]);
  fixClosures(dayPlaces, dates, pool.slice(picked.length));
  const days = dayPlaces.map((group, i) => {
    const date = dates[i];
    const from = stay || nearestTo(center, group) || center;
    return { date: date ? isoOf(date) : '', city: req.region, theme: '', items: scheduleDay(orderRoute(group, from), { from, stay, date, req }) };
  });
  const plan = {
    title: `${req.region} ${req.days}일 추천 일정`,
    summary: `${req.region} 둘레에서 구글 평점과 리뷰 수가 높은 곳 ${picked.length}곳을 골라, 가까운 곳끼리 ${req.days}일로 묶었어요. 끼니는 빈 자리로 두었으니 하루 예산의 맛집 추천으로 고르세요.`,
    tips: [
      'AI 제공업체와 API 키를 설정에 넣으면 도시 배분·교통 패스·휴관일까지 고려해 짜요. 지금은 구글 지도 데이터만으로 짰어요.',
      '이동 시간은 거리로 어림했어요. 경로 찾기를 누르면 구글 경로로 다시 확인해요.',
      ...(stay ? [] : ['숙소를 적으면 그곳에서 출발·복귀하도록 짜요.']),
      ...(pool.length < picked.length + 3 ? ['지역이 좁거나 장소가 적어 같은 곳 둘레가 많을 수 있어요.'] : []),
    ],
    days,
  };
  for (const day of plan.days) checkDay(day);
  return plan;
}

const closedOn = (p, date) => !!date && openState(p, date.getDay(), 12 * 60, 30).state === 'dayoff';

// 묶음을 날짜에 놓는다: 그날 쉬는 곳이 적고, 그날 넣을 곳 수와 묶음 크기가 맞는 배치 (7일 이하는 모든 배치를 본다)
export function assignGroups(groups, perDay, dates) {
  const cost = (order) => order.reduce((n, gi, i) => n + 10 * groups[gi].filter((p) => closedOn(p, dates[i])).length + Math.abs(groups[gi].length - perDay[i]), 0);
  const idx = groups.map((_, i) => i);
  if (groups.length > 7) return idx.map((i) => groups[i]);
  let best = idx;
  let bestCost = cost(idx);
  const permute = (rest, chosen) => {
    if (!rest.length) {
      const c = cost(chosen);
      if (c < bestCost) { best = chosen; bestCost = c; }
      return;
    }
    rest.forEach((g, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...chosen, g]));
  };
  permute(idx, []);
  return best.map((i) => groups[i]);
}

const centroid = (list) => (list.length ? { lat: list.reduce((n, p) => n + p.lat, 0) / list.length, lng: list.reduce((n, p) => n + p.lng, 0) / list.length } : null);

// 그날 쉬는 곳은 다른 날의 가까운 곳과 맞바꾸고, 안 되면 그날 여는 다음 후보로 바꾼다. 그래도 안 되면 그대로 두고 '확인 필요'로 표시된다
export function fixClosures(dayPlaces, dates, spare) {
  dayPlaces.forEach((places, i) => {
    places.forEach((p, k) => {
      if (!closedOn(p, dates[i])) return;
      const here = centroid(places.filter((x) => x !== p));
      for (let j = 0; j < dayPlaces.length; j++) {
        if (j === i) continue;
        const there = centroid(dayPlaces[j]);
        const q = dayPlaces[j].find((x) => !closedOn(x, dates[i]) && !closedOn(p, dates[j])
          && (!here || distanceMeters(x, here) < 8000) && (!there || distanceMeters(p, there) < 8000));
        if (q) {
          dayPlaces[j][dayPlaces[j].indexOf(q)] = p;
          places[k] = q;
          return;
        }
      }
      const c = spare.find((x) => !closedOn(x, dates[i]) && (!here || distanceMeters(x, here) < 5000));
      if (c) {
        spare.splice(spare.indexOf(c), 1);
        places[k] = c;
      }
    });
  });
}
const nearestTo = (point, list) => list.reduce((best, p) => (!best || distanceMeters(point, p) < distanceMeters(point, best) ? p : best), null);
const xy = (p) => [p.lat, p.lng * Math.cos((p.lat * Math.PI) / 180)];
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

// 가까운 곳끼리 k묶음 (k-평균). 한 묶음이 cap을 넘으면 가장 먼 곳을 자리가 남는 가까운 묶음으로 옮기고,
// min보다 작은 묶음은 가장 큰 묶음에서 가장 가까운 곳을 데려온다 (하루에 한 곳만 남는 날이 없게)
export function cluster(points, k, cap, min = 1) {
  if (!points.length) return Array.from({ length: k }, () => []);
  if (points.length <= k) return Array.from({ length: k }, (_, i) => (points[i] ? [points[i]] : []));
  const seeds = [points[0]];
  while (seeds.length < k) {
    let best = null;
    let bestD = -1;
    for (const p of points) {
      const d = Math.min(...seeds.map((s) => d2(xy(p), xy(s))));
      if (d > bestD) { best = p; bestD = d; }
    }
    seeds.push(best);
  }
  let centers = seeds.map(xy);
  let groups = [];
  for (let iter = 0; iter < 20; iter++) {
    groups = centers.map(() => []);
    for (const p of points) {
      let at = 0;
      centers.forEach((c, i) => { if (d2(xy(p), c) < d2(xy(p), centers[at])) at = i; });
      groups[at].push(p);
    }
    centers = groups.map((g, i) => (g.length ? [g.reduce((n, p) => n + xy(p)[0], 0) / g.length, g.reduce((n, p) => n + xy(p)[1], 0) / g.length] : centers[i]));
  }
  const floor = Math.max(1, Math.min(min, Math.floor(points.length / k)));
  for (let guard = 0; guard < points.length * 3; guard++) {
    const big = groups.findIndex((g) => g.length > cap);
    if (big >= 0) {
      const g = groups[big];
      const far = g.reduce((m, p) => (d2(xy(p), centers[big]) > d2(xy(m), centers[big]) ? p : m), g[0]);
      const to = groups.map((_, i) => i).filter((i) => i !== big && groups[i].length < cap)
        .sort((a, b) => d2(xy(far), centers[a]) - d2(xy(far), centers[b]))[0];
      if (to == null) break;
      g.splice(g.indexOf(far), 1);
      groups[to].push(far);
      continue;
    }
    const small = groups.findIndex((g) => g.length < floor);
    if (small < 0) break;
    const from = groups.reduce((m, g, i) => (g.length > groups[m].length ? i : m), 0);
    if (groups[from].length <= floor) break;
    const near = groups[from].reduce((m, p) => (d2(xy(p), centers[small]) < d2(xy(m), centers[small]) ? p : m), groups[from][0]);
    groups[from].splice(groups[from].indexOf(near), 1);
    groups[small].push(near);
  }
  return groups;
}

// 출발점에서 가까운 순으로 잇고(최근접 이웃), 길이 엇갈리면 뒤집어 줄인다(2-opt)
export function orderRoute(places, from) {
  const left = [...places];
  const route = [];
  let at = from;
  while (left.length) {
    const next = nearestTo(at, left);
    left.splice(left.indexOf(next), 1);
    route.push(next);
    at = next;
  }
  const dist = (a, b) => distanceMeters(a, b);
  let improved = true;
  for (let pass = 0; improved && pass < 10; pass++) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const a = i === 0 ? from : route[i - 1];
        const b = route[i];
        const c = route[j];
        const d = route[j + 1];
        const before = dist(a, b) + (d ? dist(c, d) : 0);
        const after = dist(a, c) + (d ? dist(b, d) : 0);
        if (after + 1 < before) {
          route.splice(i, j - i + 1, ...route.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return route;
}

const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);

// 두 곳 사이 이동: 가까우면 도보, 멀면 대중교통(또는 차). 300m 안이면 이동 행을 넣지 않는다
function travelBetween(a, b, transport) {
  const meters = distanceMeters(a, b);
  if (meters < 300) return null;
  const walk = walkMinutes(meters);
  if (walk <= 15) return { minutes: round5(walk), mode: `도보 약 ${walk}분` };
  const km = meters / 1000;
  return transport === 'car'
    ? { minutes: round5(5 + km * 2.5), mode: '렌터카' }
    : { minutes: round5(10 + km * 3.5), mode: '대중교통' };
}

const shortName = (p) => String(p.name || '').replace(/\s*[(（].*$/, '');

function scheduleDay(route, { from, stay, date, req }) {
  const items = [];
  let t = PACE_START[req.pace] ?? PACE_START.normal;
  let prev = from;
  let lunch = false;
  const meal = (label, at, place) => {
    items.push({ start: hm(at), end: hm(at + 60), kind: 'meal', title: `${label} (${shortName(place)} 주변)`, place_ko: '', place: '', search: '', mode: '', memo: '' });
    return at + 60;
  };
  const go = (a, b) => {
    const leg = travelBetween(a, b, req.transport);
    if (!leg) return;
    items.push({ start: hm(t), end: hm(t + leg.minutes), kind: 'travel', title: `${shortName(a)} → ${shortName(b)}`, place_ko: '', place: '', search: '', mode: leg.mode, memo: '' });
    t += leg.minutes;
  };
  if (stay) items.push({ start: hm(t - 10), end: hm(t), kind: 'stay', title: '숙소에서 출발', place_ko: '', place: stay.name, search: '', mode: '', memo: '', found: stay });
  for (const p of route) {
    if (!lunch && t >= 11 * 60 + 45) {
      t = meal('점심', t, prev === from && !stay ? p : prev);
      lunch = true;
    }
    go(prev, p);
    // 아직 안 열었으면 여는 시각까지 기다린다 (한 시간 안일 때)
    if (date) {
      const open = openState(p, date.getDay(), t, 30);
      const opens = open.state === 'closed' && open.text.match(/(\d\d):(\d\d)에 열어요/);
      if (opens) {
        const at = Number(opens[1]) * 60 + Number(opens[2]);
        if (at > t && at - t <= 60) t = at;
      }
    }
    const minutes = durationOf(p) + (req.pace === 'relaxed' ? 15 : 0);
    items.push({
      start: hm(t), end: hm(t + minutes), kind: 'place', title: `${shortName(p)} (${typeLabel(p, 'sights')})`,
      place_ko: '', place: p.name, search: '', mode: '', memo: p.rating != null ? `구글 ★${p.rating.toFixed(1)} (${p.count.toLocaleString('en-US')})` : '', found: p,
    });
    t += minutes;
    prev = p;
  }
  if (!lunch) t = meal('점심', Math.max(t, 12 * 60), prev);
  t = meal('저녁', Math.max(t, 18 * 60), prev);
  if (stay && prev !== from) go(prev, stay);
  return items;
}

/* ── 일정표 엑셀 ── */

const HEADERS = ['날짜', '시간', '일정', '장소', '지역', '이동 수단', '메모', '주소', '위도', '경도',
  RESULT_COLUMNS.name, RESULT_COLUMNS.address, RESULT_COLUMNS.url, RESULT_COLUMNS.placeId];
const round7 = (v) => Math.round(v * 1e7) / 1e7;

/** 앱의 일정표 모양(날짜·시간·일정·장소·…·위도·경도) 행들. 찾은 곳은 좌표·구글 정보까지 넣어 다시 검색하지 않게 한다 */
export function planToRows(plan) {
  const rows = [];
  plan.days.forEach((day, i) => {
    const label = dateLabel(parseIso(day.date), i);
    for (const it of day.items) {
      const time = it.start ? (it.end && it.end !== it.start ? `${it.start}–${it.end}` : it.start) : '';
      const hasPlace = (it.kind === 'place' || it.kind === 'stay') && (it.place_ko || it.place);
      const f = hasPlace ? it.found : null;
      const memo = [it.memo, it.issue ? `[확인 필요] ${it.issue.text}` : ''].filter(Boolean).join(' · ');
      rows.push([
        label, time, it.title, hasPlace ? it.place_ko || it.place : '', hasPlace ? day.city : '', it.kind === 'travel' ? it.mode : '', memo,
        f?.address || '', f ? round7(f.lat) : '', f ? round7(f.lng) : '', f?.name || '', f?.address || '', f?.url || '', f?.id || '',
      ]);
    }
  });
  return rows;
}

/** 일정표(첫 시트)와 요약(둘째 시트)이 든 .xlsx */
export function planToWorkbook(plan, req, engine) {
  const by = AI_PROVIDERS[engine] ? `${AI_PROVIDERS[engine].label} 초안 · 구글 지도로 확인` : '구글 지도 평점으로 추천';
  const sheet = XLSX.utils.aoa_to_sheet([[`${plan.title || `${req.region} 여행`} — ${by}`], HEADERS, ...planToRows(plan)]);
  sheet['!cols'] = [12, 13, 34, 26, 12, 22, 40, 36, 11, 11, 24, 36, 30, 28].map((wch) => ({ wch }));
  const issues = planIssues(plan);
  const summary = XLSX.utils.aoa_to_sheet([
    [plan.title], [plan.summary], [],
    ...plan.days.map((d, i) => [`${dateLabel(parseIso(d.date), i)} ${d.city}${d.theme ? ` · ${d.theme}` : ''}`]), [],
    ['알아 둘 점'], ...plan.tips.map((t) => [`· ${t}`]),
    ...(issues.length ? [[], ['확인이 필요한 곳'], ...issues.map((x) => [`· ${x.label} ${x.item.place_ko || x.item.place}: ${x.text}`])] : []),
  ]);
  summary['!cols'] = [{ wch: 100 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '일정표');
  XLSX.utils.book_append_sheet(workbook, summary, '요약');
  const name = `${String(req.region).replace(/[\\/:*?"<>|\s]+/g, '_')}_${req.days}일_추천일정.xlsx`;
  return { buffer: XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }), fileName: name };
}
