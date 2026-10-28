// 화면 흐름: API 키 → 엑셀 올리기 → 열 맞추기 → 장소 검색·지도 표시 → 동선 → 결과 확인·내보내기
import { escapeHtml, downloadBlob, storage, PALETTE, STATUS, normalizeText, similarity } from './util.js';
import {
  FIELDS, RESULT_COLUMNS, readWorkbook, parseSheet, pickDefaultSheet, autoMap,
  cellText, cellNumber, downloadTemplate, buildResultWorkbook, placeUrl,
} from './excel.js';
import { loadGoogleMaps, searchPlaces, isCached, classifyError, clearCache, languageFor } from './places.js';
import {
  MODES, modeFromText, distanceMeters, legTiming, parseDay, parseTimeRange, computeLeg, clearRouteCache,
} from './routes.js';
import { MapView } from './mapview.js';
import { buildKml } from './kml.js';
import {
  FIXED_TAG, LUGGAGE_TAG, PACES, paceNote, hasTag, travelPlan, checkTravel, fixOptions, boardingRisks, boardingFix,
} from './plan.js';
import { writeEditedWorkbook } from './xlsxedit.js';
import {
  KINDS, countryAt, findNearby, rankPlaces, dropParts, withoutBars, nowAt, priceOf, levelSigns, typeLabel, ratingSource, googleUrl, scoreOnGoogleScale,
  placeDetails, weekHours, walkUrl,
} from './nearby.js';
import {
  CURRENCIES, COUNTRY_CURRENCY, dayCosts, formatMoney, fareClass, mealOf, mostCommon,
} from './budget.js';
import {
  INTERESTS, AI_PROVIDERS, planWithAI, verifyPlan, planWithGoogle, planIssues, planToWorkbook,
} from './planner.js';

const CFG = {
  googleMapsApiKey: '',
  mapId: 'DEMO_MAP_ID',
  language: 'ko',
  region: 'kr',
  concurrency: 4,
  ...(window.APP_CONFIG || {}),
};
const KEY_STORAGE = 'googleMapsApiKey';
const PACE_STORAGE = 'pace'; // 일정 점검의 여유 정도 (이 브라우저에 기억)
const BUDGET_STORAGE = 'budget.v1'; // 하루 예산 { amount, currency, trip(현지 통화, 비우면 자동) }
const OVERRIDE_STORAGE = 'budgetOverrides.v1'; // 파일·시트별로 직접 고친 금액 { '파일|시트': { 엑셀 행: 금액 } }
const SCORE_STORAGE = 'ratingScores.v1'; // 타베로그·카카오맵에서 보고 직접 적은 점수 { 구글 장소 ID: 점수 }
const FX_STORAGE = 'fxRates.v1'; // 환율 { 'JPY>KRW': { rate, date, t } }
const CLAUDE_KEY_STORAGE = 'anthropicApiKey'; // 일정 추천용 Claude API 키 (이 브라우저에만)
const PLANNER_STORAGE = 'planner.v1'; // 일정 추천 칸에 마지막으로 넣은 값

function loadJson(key, fallback) {
  try { return JSON.parse(storage.get(key)) ?? fallback; } catch { return fallback; }
}

const els = Object.fromEntries([
  // 설정 · 상단
  'settingsDialog', 'helpDialog', 'helpTemplate', 'keySection', 'keyForm', 'apiKeyInput', 'keyStatus', 'clearCache',
  'syncStatus', 'syncText', 'apiCard', 'apiCardTitle', 'crumbTitle', 'tripDates', 'tripPlaces', 'navCount', 'toast',
  // 01 업로드 · 열 맞추기
  'uploadCard', 'uploadDone', 'uploadedFile', 'fileName', 'fileMeta', 'dropzone', 'fileInput', 'dropTitle', 'dropSub', 'templateLink',
  'columnsPanel', 'columnsToggle', 'columnsSummary', 'columnsBody',
  'sheetField', 'sheetSelect', 'mappingFields', 'commonRegion', 'rowSummary', 'runBtn', 'runText',
  // 동선 카드
  'routeCard', 'routeKicker', 'routeTitle', 'routeCopy', 'routeMetrics', 'routeStatus', 'routeAlert', 'routeBtn', 'routeBtnText',
  // 여행 일정 추천
  'plannerCard', 'plannerToggle', 'plannerForm', 'planRegion', 'planStart', 'planDays', 'planStay', 'planTransport', 'planPace',
  'planBudget', 'planBudgetCurrency', 'planInterests', 'planNotes', 'plannerEngine', 'plannerBtn', 'plannerBtnText', 'plannerStatus',
  'claudeKeyForm', 'claudeKeyInput', 'claudeKeyStatus', 'aiProvider', 'aiModel',
  // 주변 추천 · 하루 예산
  'recsCard', 'recsClose', 'recsForm', 'recsQuery', 'recsBody',
  'budgetCard', 'budgetForm', 'budgetAmount', 'budgetCurrency', 'tripCurrency', 'budgetFx', 'budgetDays',
  // 02 일정
  'planCard', 'planSummary', 'progressBar', 'progressText', 'runAlert', 'planCheck', 'dayTabs', 'statusChips', 'resultList',
  // 03 지도
  'mapPanel', 'mapMode', 'mapScope', 'routeToggle', 'fitMap', 'map', 'mapPlaceholder', 'mapNote', 'pickBanner', 'pickCancel',
  'exportXlsx', 'exportKml',
  'placePanel', 'placePanelBody', 'placePanelClose',
].map((id) => [id, document.getElementById(id)]));

const state = {
  workbook: null,
  fileBuffer: null, // 올린 파일 그대로 — 고친 일정을 원래 파일에 써 넣을 때 쓴다
  fileName: '',
  fileBase: '',
  sheetName: '',
  headers: [],
  records: [],
  startCol: 0,
  mapping: {},
  resultCols: {},
  fileSize: 0,
  items: [],
  colors: new Map(),
  day: null, // 날짜 탭에서 고른 분류 값 (null이면 전체)
  filter: 'all',
  selected: null,
  running: false,
  progress: { done: 0, total: 0 },
  alert: '',
  // 동선
  legs: [],
  selectedLeg: null,
  showRoutes: false,
  routesRequested: false, // '경로 찾기'를 누른 뒤에는 바뀐 구간을 자동으로 다시 찾는다
  routeRunning: false,
  routeRerun: false,
  routeAnnounce: false, // 다시 찾기가 밀려 있는 동안 '경로 찾기'를 눌렀으면 끝날 때 알린다
  routeProgress: { done: 0, total: 0 },
  routeAlert: '',
  legModes: new Map(), // 구간별로 사용자가 고른 이동 방법
  // 일정 점검에서 고친 시간 칸: { index(records 번호), col, before(원래 칸), text, minutes }
  planEdits: [],
  pace: PACES[storage.get(PACE_STORAGE)] ? storage.get(PACE_STORAGE) : 'tight', // PACES 키
  openRide: null, // 일정 점검에서 펼친 '놓치면 오래 기다리는 차' (records 번호)
  // 주변 추천: { anchor, kind, keyword, places, list, loading, error, more, focus, at, allowance }
  //   anchor: { name, lat, lng, item(일정 장소)|null, slot(빈 끼니 행 records 번호)|null, at, meal, hints }
  recs: null,
  // 하루 예산 (1인, 숙박·항공 제외)
  budget: { amount: null, currency: 'KRW', trip: '', ...loadJson(BUDGET_STORAGE, {}) },
  budgetOpen: null, // 펼친 날
  editAmount: null, // 금액을 고치는 중인 행 (records 번호)
  overrides: new Map(), // records 번호 → 직접 고친 금액 (그날 통화)
  picks: new Map(), // records 번호 → 추천에서 고른 가게의 1인 가격 (메모 열이 없을 때 셈에 쓴다)
  // 여행 일정 추천: { running, engine, step, progress, error, result: { plan, req, raw, cost, engine, model, buffer, fileName } }
  planner: { running: false, engine: '', step: '', progress: null, error: '', result: null },
};

let mapView = null;
let mapState = 'none'; // none | loading | ready | error

const GROUPS = [
  { key: 'all', label: '전체', match: () => true },
  { key: 'ok', label: '찾음', match: (it) => ['ok', 'given', 'confirmed', 'manual'].includes(it.status) },
  { key: 'check', label: '확인 필요', match: (it) => it.status === 'check' },
  { key: 'fail', label: '못 찾음', match: (it) => ['notfound', 'error'].includes(it.status) },
  { key: 'pending', label: '대기', match: (it) => ['pending', 'searching'].includes(it.status) },
];
const groupOf = (key) => GROUPS.find((g) => g.key === key) || GROUPS[0];
// 좁은 화면에서는 지도가 위, 목록이 아래로 쌓인다
const isNarrow = () => window.matchMedia('(max-width: 860px)').matches;
// 날짜 탭으로 하루만 보고 있으면 다른 날의 장소·구간은 숨긴다
const catVisible = (category) => state.day == null || category === state.day;

let toastTimer = null;
function showToast(message) {
  els.toast.querySelector('strong').textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2600);
}

/* ───────────── 지도 / API 키 ───────────── */

const PLACEHOLDER = {
  nokey: `
    <div class="overlay-card">
      <div class="section-kicker">GOOGLE MAPS</div>
      <h3>구글 지도 API 키가 필요해요</h3>
      <ol>
        <li><a href="https://console.cloud.google.com/google/maps-apis/start" target="_blank" rel="noopener">Google Cloud 콘솔</a>에서 프로젝트를 만들고 결제 계정을 연결</li>
        <li><b>Maps JavaScript API</b>, <b>Places API (New)</b>, <b>Routes API</b> 사용 설정</li>
        <li>API 키를 만들어 설정에 붙여 넣기</li>
      </ol>
      <p class="muted">매달 무료: 지도 표시 10,000회 · 장소 검색 5,000건 · 경로 10,000건</p>
      <button type="button" class="primary-button" data-open="settingsDialog"><span class="button-icon">✦</span>API 키 입력하기<span class="button-arrow">→</span></button>
    </div>`,
  loading: '<div class="overlay-card"><p>지도를 불러오는 중…</p></div>',
  error: `
    <div class="overlay-card">
      <div class="section-kicker">GOOGLE MAPS</div>
      <h3>지도를 불러오지 못했어요</h3>
      <p>API 키가 맞는지, Maps JavaScript API가 켜져 있는지 확인해 주세요.</p>
      <button type="button" class="primary-button" data-open="settingsDialog">설정 열기<span class="button-arrow">→</span></button>
    </div>`,
};

function showPlaceholder(kind) {
  els.mapPlaceholder.innerHTML = PLACEHOLDER[kind];
  els.mapPlaceholder.classList.remove('hidden');
}

function setKeyStatus(text, tone = '') {
  els.keyStatus.textContent = text;
  els.keyStatus.className = `status ${tone}`;
}

// 상단 막대 · 사이드바 카드에 지도 연결 상태를 보여 준다
function setConnection() {
  const view = {
    none: ['warn', 'API 키 필요', 'API 키를 넣으면<br>지도가 열려요.'],
    loading: ['', '지도 불러오는 중', '지도를<br>불러오는 중이에요.'],
    ready: ['ok', '지도 연결됨', '지도가<br>연결되어 있어요.'],
    error: ['warn', 'API 키 확인 필요', 'API 키를<br>확인해 주세요.'],
  }[mapState];
  els.syncStatus.className = `sync-status ${view[0]}`;
  els.syncText.textContent = view[1];
  els.apiCard.classList.toggle('ok', mapState === 'ready');
  els.apiCardTitle.innerHTML = view[2];
}

function apiKey() {
  return CFG.googleMapsApiKey || storage.get(KEY_STORAGE) || '';
}

// 키가 틀렸거나 Maps JavaScript API가 꺼져 있으면 구글 지도가 이 함수를 부른다
window.gm_authFailure = () => {
  mapState = 'error';
  setKeyStatus('API 키를 쓸 수 없습니다. 키가 맞는지, Maps JavaScript API가 사용 설정되어 있는지, 결제 계정이 연결되어 있는지 확인하세요.', 'error');
  setConnection();
  showPlaceholder('error');
  updateRunButton();
};

async function initMap() {
  if (!apiKey()) {
    showPlaceholder('nokey');
    setConnection();
    return;
  }
  mapState = 'loading';
  setConnection();
  showPlaceholder('loading');
  updateRunButton();
  try {
    await loadGoogleMaps({ key: apiKey(), language: CFG.language, region: CFG.region });
    mapView = new MapView(els.map, {
      mapId: CFG.mapId,
      onSelect: (idx, from) => select(idx, from),
      onMove: (idx, lat, lng) => placeManually(idx, lat, lng),
      onSelectLeg: (key) => selectLeg(key, 'map'),
      onSelectRec: (id) => focusRec(id, 'map'),
    });
    await mapView.init();
    if (mapState === 'error') return; // 그사이 gm_authFailure가 불린 경우
    mapState = 'ready';
    els.mapPlaceholder.classList.add('hidden');
    setKeyStatus('지도 연결됨', 'ok');
    renderRecs();
    renderPlanner();
  } catch (err) {
    mapState = 'error';
    setKeyStatus(`지도를 불러오지 못했습니다: ${err?.message || err}`, 'error');
    showPlaceholder('error');
  }
  setConnection();
  updateRunButton();
}

/* ───────────── 엑셀 읽기 / 열 맞추기 ───────────── */

async function handleFile(file) {
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    state.workbook = readWorkbook(buffer, file.name);
    state.fileBuffer = buffer;
  } catch (err) {
    els.dropTitle.textContent = '파일을 읽지 못했습니다';
    els.dropSub.textContent = err?.message || String(err);
    return;
  }
  state.fileName = file.name;
  state.fileBase = file.name.replace(/\.[^.]+$/, '');
  state.fileSize = file.size;
  els.fileName.textContent = file.name;
  els.uploadedFile.classList.remove('hidden');
  els.uploadDone.classList.remove('hidden');
  els.dropTitle.textContent = '새 파일로 바꾸기';
  els.dropSub.innerHTML = '이곳에 끌어놓거나 <u>파일 선택</u>';
  els.crumbTitle.textContent = file.name;
  const names = state.workbook.SheetNames;
  els.sheetSelect.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  els.sheetField.classList.toggle('hidden', names.length < 2);
  loadSheet(pickDefaultSheet(state.workbook));
  els.columnsPanel.classList.remove('hidden');
  setColumnsOpen(state.mapping.name < 0);
  showToast(`일정 파일을 불러왔어요 · ${state.records.length}행`);
}

function setColumnsOpen(open) {
  els.columnsToggle.setAttribute('aria-expanded', String(open));
  els.columnsBody.classList.toggle('hidden', !open);
}

function loadSheet(name) {
  state.sheetName = name;
  els.sheetSelect.value = name;
  const { headers, records, startCol } = parseSheet(state.workbook, name);
  state.headers = headers;
  state.records = records;
  state.startCol = startCol;
  state.planEdits = [];
  state.openRide = null;
  state.picks = new Map();
  state.budgetOpen = null;
  state.editAmount = null;
  state.overrides = loadOverrides();
  state.mapping = autoMap(headers);
  state.resultCols = Object.fromEntries(Object.entries(RESULT_COLUMNS).map(([k, h]) => [k, headers.indexOf(h)]));
  const kb = Math.max(1, Math.round(state.fileSize / 1024));
  els.fileMeta.textContent = `Excel · ${kb} KB · ${name} 시트 · ${records.length}행`;
  renderMapping();
  updateSummary();
  previewItinerary();
}

function previewItinerary() {
  if (state.running || state.mapping.name < 0) return;
  state.items = buildItems().items;
  state.selected = null;
  state.day = null;
  state.filter = "all";
  state.legs = [];
  state.selectedLeg = null;
  state.alert = "";
  assignColors();
  mapView?.clear();
  els.planCard.classList.remove("hidden");
  document.body.classList.add("has-itinerary");
  render();
}

// 접힌 열 맞추기 패널에 보여 줄 한 줄 요약 (예: 장소 ← 장소 · 날짜 ← 날짜)
function columnsSummaryText() {
  const parts = FIELDS
    .filter((f) => state.mapping[f.key] >= 0 && ['name', 'region', 'date', 'time', 'mode'].includes(f.key))
    .map((f) => `${f.label} ← ${state.headers[state.mapping[f.key]]}`);
  return parts.length ? parts.join(' · ') : '열 맞추기';
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function renderMapping() {
  const samples = state.headers.map((_, i) => {
    const rec = state.records.find((r) => cellText(r.cells[i]));
    return rec ? cellText(rec.cells[i]) : '';
  });
  const options = ['<option value="-1">— 없음 —</option>']
    .concat(state.headers.map((h, i) => (
      `<option value="${i}">${escapeHtml(h)}${samples[i] ? ` · 예: ${escapeHtml(truncate(samples[i], 16))}` : ''}</option>`
    )))
    .join('');
  const firstRoute = FIELDS.find((f) => f.group === 'route');
  els.mappingFields.innerHTML = FIELDS.map((f) => `
    ${f === firstRoute ? '<div class="mapping-group">동선 <small>— 날짜별로 장소를 잇고 이동 경로를 찾을 때 씁니다</small></div>' : ''}
    <label for="map-${f.key}">${f.label}${f.required ? '<em>*</em>' : ''}</label>
    <select id="map-${f.key}" data-key="${f.key}">${options}</select>`).join('');
  for (const f of FIELDS) els.mappingFields.querySelector(`[data-key="${f.key}"]`).value = String(state.mapping[f.key]);
  els.columnsSummary.textContent = columnsSummaryText();
}

function readCoords(cells, latIdx, lngIdx) {
  if (latIdx < 0 || lngIdx < 0) return null;
  let lat = cellNumber(cells[latIdx]);
  let lng = cellNumber(cells[lngIdx]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat]; // 위도·경도를 바꿔 적은 경우
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

// 현재 열 맞춤으로 행마다 검색할 항목을 만든다
function buildItems() {
  const m = state.mapping;
  const rc = state.resultCols;
  const get = (cells, i) => (i >= 0 ? cellText(cells[i]) : '');
  const commonRegion = els.commonRegion.value.trim();
  const items = [];
  let skipped = 0;
  // 날짜를 하루의 첫 행에만 적거나 셀을 병합한 일정표도 있으므로, 빈 날짜 칸은 위의 날짜를 이어 쓴다
  let lastDate = null;

  for (const [recordIndex, rec] of state.records.entries()) {
    const { cells } = rec;
    if (m.date >= 0 && cells[m.date]) lastDate = cells[m.date];
    const name = get(cells, m.name);
    const region = get(cells, m.region);
    const address = get(cells, m.address);
    const coords = readCoords(cells, m.lat, m.lng);
    if (!name && !address && !coords) { skipped++; continue; }
    const day = m.date >= 0 && lastDate ? cellText(lastDate) : '';

    const parts = [name, address || region];
    if (commonRegion && !parts.join(' ').includes(commonRegion)) parts.push(commonRegion);
    const item = {
      idx: items.length,
      rowNumber: rec.rowNumber,
      cells,
      name: name || address || '(장소 없음)',
      searchName: name,
      query: parts.filter(Boolean).join(' '),
      language: languageFor(name || address, CFG.language),
      category: get(cells, m.category) || (m.category >= 0 && m.category === m.date ? day : ''),
      memo: get(cells, m.memo),
      recordIndex,
      day,
      dateCell: m.date >= 0 ? lastDate : null,
      timeText: get(cells, m.time),
      status: 'pending',
      place: null,
      candidates: [],
      note: '',
    };
    if (coords) {
      // 이 앱이 저장한 엑셀이면 검색 결과 열에서 이름·주소·링크도 되살린다
      item.status = 'given';
      item.place = {
        ...coords,
        id: get(cells, rc.placeId),
        name: get(cells, rc.name),
        address: get(cells, rc.address),
        url: get(cells, rc.url),
      };
    }
    items.push(item);
  }
  return { items, skipped };
}

function updateSummary() {
  if (!state.records.length) {
    els.rowSummary.textContent = '이 시트에서 데이터 행을 찾지 못했습니다.';
    updateRunButton();
    return;
  }
  const { items, skipped } = buildItems();
  const given = items.filter((it) => it.status === 'given').length;
  const toSearch = items.filter((it) => it.status === 'pending');
  // 같은 장소가 여러 번 나와도(예: 하카타역) 검색은 한 번이므로 검색어 기준으로 센다
  const unique = [...new Map(toSearch.map((it) => [`${it.language}|${it.query}`, it])).values()];
  const cached = unique.filter((it) => isCached(it.query, searchOptions(it.language))).length;
  const parts = [`${items.length}곳`];
  if (given) parts.push(`좌표 있음 ${given}`);
  parts.push(`새로 검색 ${unique.length - cached}건`);
  if (cached) parts.push(`이전 검색 재사용 ${cached}건`);
  if (skipped) parts.push(`장소가 빈 ${skipped}행 제외`);
  const example = toSearch[0]?.query;
  els.rowSummary.innerHTML = escapeHtml(parts.join(' · '))
    + (example ? `<br>검색어 예: <b>${escapeHtml(example)}</b>` : '');
  els.columnsSummary.textContent = columnsSummaryText();
  renderTrip(items);
  updateRunButton();
}

// 머리말 오른쪽 '여행 기간'과 장소 수
function renderTrip(items) {
  const days = [...new Set(items.map((it) => it.day).filter(Boolean))];
  const label = (day) => {
    const cell = items.find((it) => it.day === day)?.dateCell;
    const d = parseDay(cell);
    return d ? `${d.getMonth() + 1}월 ${d.getDate()}일` : day;
  };
  els.tripDates.textContent = !days.length ? (items.length ? '날짜 열 없음' : '일정을 올려 주세요')
    : days.length === 1 ? label(days[0]) : `${label(days[0])} — ${label(days[days.length - 1])}`;
  const placed = items.filter((it) => it.place).length;
  const regions = [...new Set(items.map((it) => (state.mapping.region >= 0 ? cellText(it.cells[state.mapping.region]) : '')).filter(Boolean))];
  const where = regions.length ? ` · ${regions.slice(0, 2).join('·')}${regions.length > 2 ? ` 외 ${regions.length - 2}곳` : ''}` : '';
  const count = placed && placed < items.length ? `${placed}/${items.length}곳 표시` : `${items.length}곳`;
  els.tripPlaces.textContent = `장소 ${count}${days.length ? ` · ${days.length}일` : ''}${where}`;
}

function updateRunButton() {
  const m = state.mapping;
  const hasTarget = m.name >= 0 || m.address >= 0 || (m.lat >= 0 && m.lng >= 0);
  const ready = '지도에 표시하기';
  let label = ready;
  if (mapState === 'loading') label = '지도 불러오는 중…';
  else if (mapState === 'none') label = 'API 키를 먼저 입력하세요';
  else if (mapState === 'error') label = 'API 키를 확인하세요';
  else if (state.running) label = '장소 찾는 중…';
  else if (!hasTarget) label = '장소 열을 골라 주세요';
  els.runText.textContent = label;
  els.runBtn.disabled = label !== ready || !state.records.length;
  els.runBtn.classList.toggle('is-loading', state.running);
}

/* ───────────── 검색 ───────────── */

// 검색 결과 이름이 엑셀의 이름과 얼마나 맞는지 보고 '찾음'인지 '확인 필요'인지 정한다
function judge(name, candidates) {
  if (!candidates.length) {
    return { status: 'notfound', note: '구글 지도에서 찾지 못했어요. 검색어를 고치거나 지도에서 직접 찍어 주세요.' };
  }
  const n = normalizeText(name);
  const top = normalizeText(candidates[0].name);
  if (!n || n === top) return { status: 'ok', note: '' };
  const close = top.includes(n) || n.includes(top) || similarity(name, candidates[0].name) >= 0.5;
  if (!close) return { status: 'check', note: `가장 가까운 결과의 이름이 달라요: “${candidates[0].name}”` };
  const alike = candidates.filter((c) => normalizeText(c.name).includes(n)).length;
  if (alike >= 2) return { status: 'check', note: `이름이 비슷한 곳이 ${alike}곳 있어요. 맞는 곳을 골라 주세요.` };
  return { status: 'ok', note: '' };
}

const searchOptions = (language) => ({ language, region: CFG.region });

function applyCandidates(it, candidates) {
  it.candidates = candidates;
  it.place = candidates[0] || null;
  Object.assign(it, judge(it.searchName, candidates));
}

function fatalMessage({ err, kind }) {
  if (kind === 'rate') {
    return '구글 장소 검색 요청 한도를 넘었습니다. 잠시 뒤 「지도에 표시하기」를 다시 누르면 이미 찾은 곳은 건너뛰고 남은 곳만 검색합니다.';
  }
  return `장소 검색이 거부되었습니다. Google Cloud 콘솔에서 "Places API (New)"가 사용 설정되어 있는지, API 키 제한 목록에 들어 있는지 확인하세요. (${err?.message || err})`;
}

async function run() {
  if (mapState !== 'ready' || state.running) return;
  const { items } = buildItems();
  Object.assign(state, {
    items, selected: null, filter: 'all', alert: '',
    legs: [], selectedLeg: null, routesRequested: false, routeAlert: '', showRoutes: hasRouteColumns(),
  });
  state.legModes.clear();
  state.day = null;
  state.openRide = null;
  closeRecs();
  assignColors();
  cancelPick();
  mapView.clear();
  rendered.clear();
  els.resultList.innerHTML = '';
  items.forEach((it) => { if (it.place) placeMarker(it); });

  const queue = items.filter((it) => it.status === 'pending');
  state.progress = { done: 0, total: queue.length };
  state.running = queue.length > 0;
  setColumnsOpen(false);
  els.planCard.classList.remove('hidden');
  render();
  updateRunButton();
  mapView.fitAll();
  if (!isNarrow()) els.uploadCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let fatal = null;
  const worker = async () => {
    while (queue.length && !fatal) {
      const it = queue.shift();
      it.status = 'searching';
      scheduleRender();
      try {
        applyCandidates(it, await searchPlaces(it.query, searchOptions(it.language)));
      } catch (err) {
        const kind = classifyError(err);
        if (kind !== 'other') {
          // 키·한도 문제는 나머지도 다 실패하므로 여기서 멈춘다
          fatal ??= { err, kind };
          it.status = 'pending';
          return;
        }
        it.status = 'error';
        it.note = `검색 중 오류: ${err?.message || err}`;
      }
      state.progress.done++;
      placeMarker(it);
      scheduleRender();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, CFG.concurrency) }, worker));

  state.running = false;
  if (fatal) state.alert = fatalMessage(fatal);
  buildLegs();
  drawLegs();
  updateSummary();
  render();
  updateRunButton();
  mapView.fitAll();
  const placed = items.filter((it) => it.place).length;
  if (!fatal) showToast(`${items.length}곳 중 ${placed}곳을 지도에 표시했어요`);
}

async function research(it, query) {
  if (!query || it.status === 'searching') return;
  it.query = query;
  it.language = languageFor(query, CFG.language);
  it.status = 'searching';
  it.note = '';
  render();
  try {
    applyCandidates(it, await searchPlaces(query, searchOptions(it.language)));
  } catch (err) {
    const kind = classifyError(err);
    it.status = 'error';
    it.note = kind === 'other' ? `검색 중 오류: ${err?.message || err}` : fatalMessage({ err, kind });
  }
  placeMarker(it);
  refreshLegs();
  select(it.idx, 'list');
}

/* ───────────── 지도 위 핀 ───────────── */

function assignColors() {
  state.colors.clear();
  for (const it of state.items) {
    if (!state.colors.has(it.category)) state.colors.set(it.category, PALETTE[state.colors.size % PALETTE.length]);
  }
}

const colorOf = (it) => state.colors.get(it.category) || PALETTE[0];

function placeMarker(it) {
  mapView?.setMarker(it.idx, {
    position: it.place ? { lat: it.place.lat, lng: it.place.lng } : null,
    color: colorOf(it),
    label: placeNumber(it),
    title: it.name,
    visible: catVisible(it.category),
  });
}

function select(idx, from) {
  state.selected = idx;
  mapView?.highlight(idx);
  if (state.selectedLeg) {
    state.selectedLeg = null;
    mapView?.highlightLeg(null);
  }
  if (idx == null) {
    mapView?.closeInfo();
    render();
    return;
  }
  const it = state.items[idx];
  if (it.place?.id && mapState === "ready") loadDetails(it.place);
  render();
  if (it.place) mapView?.focus(idx, infoHtml(it), from === 'list');
  else mapView?.closeInfo();
  // 좁은 화면에서는 목록으로 스크롤하면 지도가 화면 밖으로 밀려나므로 하지 않는다
  if (from !== 'list' && !isNarrow()) {
    els.resultList.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// 핀을 끌어 옮기거나 지도에서 직접 찍었을 때
function placeManually(idx, lat, lng) {
  const it = state.items[idx];
  it.place = { id: '', name: '', address: '직접 지정한 위치', url: '', lat, lng };
  it.status = 'manual';
  it.note = '';
  placeMarker(it);
  refreshLegs();
  select(idx, 'drag');
}

function startPick(it) {
  if (!mapView) return;
  els.pickBanner.querySelector('span').textContent = `「${it.name}」의 위치를 지도에서 클릭하세요`;
  els.pickBanner.classList.remove('hidden');
  mapView.closeInfo();
  mapView.startPick((lat, lng) => {
    els.pickBanner.classList.add('hidden');
    placeManually(it.idx, lat, lng);
  });
}

function cancelPick() {
  mapView?.stopPick();
  els.pickBanner.classList.add('hidden');
}

// 정보창·KML에 넣을 [열 이름, 값] 목록
function extraFields(it, { includeMapped }) {
  const m = state.mapping;
  const skip = new Set([m.lat, m.lng, ...Object.values(state.resultCols)]);
  if (!includeMapped) [m.name, m.category, m.memo].forEach((i) => skip.add(i));
  return state.headers
    .map((h, i) => [h, cellText(it.cells[i]), i])
    .filter(([, v, i]) => v && !skip.has(i))
    .map(([h, v]) => [h, v]);
}

function linkify(text) {
  return /^https?:\/\/\S+$/i.test(text)
    ? `<a href="${escapeHtml(text)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`
    : escapeHtml(text);
}

function infoHtml(it) {
  const rows = extraFields(it, { includeMapped: false });
  const p = it.place;
  const placeLine = p ? [p.name && p.name !== it.name ? p.name : '', p.address].filter(Boolean).join(' · ') : '';
  return `<div class="info">
    <div class="info-title">${escapeHtml(it.name)}</div>
    ${it.category ? `<span class="info-cat" style="--c:${colorOf(it)}">${escapeHtml(it.category)}</span>` : ''}
    ${it.memo ? `<p class="info-memo">${escapeHtml(it.memo)}</p>` : ''}
    ${rows.length ? `<table>${rows.map(([h, v]) => `<tr><th>${escapeHtml(h)}</th><td>${linkify(v)}</td></tr>`).join('')}</table>` : ''}
    ${p ? `<p class="info-place">${escapeHtml(placeLine)}</p>
    <a class="info-link" href="${escapeHtml(placeUrl(p))}" target="_blank" rel="noopener">구글 지도에서 열기 ↗</a>` : ''}
  </div>`;
}

/* ───────────── 동선 (장소 사이 이동 경로) ───────────── */

const hasRouteColumns = () => ['date', 'time', 'mode'].some((k) => state.mapping[k] >= 0);
const latLng = (p) => ({ lat: p.lat, lng: p.lng });
const legVisible = (leg) => catVisible(leg.from.category) && catVisible(leg.to.category);

// 같은 날짜의 장소를 엑셀 순서대로 잇는다. 양 끝·이동 방법·시각이 그대로인 구간은 찾은 경로를 유지한다
function buildLegs() {
  const m = state.mapping;
  const prev = new Map(state.legs.map((l) => [l.key, l]));
  const placed = state.items.filter((it) => it.place);
  const legs = [];
  for (let i = 1; i < placed.length; i++) {
    const a = placed[i - 1];
    const b = placed[i];
    if (a.day !== b.day) continue;
    const dist = distanceMeters(a.place, b.place);
    if (dist < 50) continue; // 같은 곳 (예: 호텔 체크인 → 호텔 온천)
    // 두 장소 사이의 이동 행(장소가 빈 행)과 도착 행에서 이동 수단·출발 시각을 읽는다
    const between = state.records.slice(a.recordIndex + 1, b.recordIndex + 1);
    const modeText = m.mode >= 0 ? between.map((r) => cellText(r.cells[m.mode])).find(Boolean) || '' : '';
    const key = `${a.idx}>${b.idx}`;
    const auto = modeFromText(modeText) || (dist > 300000 ? 'FLIGHT' : dist <= 1200 ? 'WALKING' : 'TRANSIT');
    const mode = state.legModes.get(key) || auto;
    const plan = travelPlan(state.records, a.recordIndex, b.recordIndex, timeCols());
    const timing = legTiming({
      day: parseDay(a.dateCell),
      // 이동 수단이 적힌 행의 시작 시각에 출발한다 (사이에 낀 짐 찾기·입국 심사 같은 행의 시각은 쓰지 않는다)
      betweenTimes: m.time >= 0 ? plan.travel.map((i) => cellText(state.records[i].cells[m.time])) : [],
      fromTime: a.timeText,
      toTime: b.timeText,
    });
    const sig = [mode, a.place.lat, a.place.lng, b.place.lat, b.place.lng, +timing.departureTime || '', +timing.arrivalTime || ''].join('|');
    const old = prev.get(key);
    const leg = old && old.sig === sig ? old : {
      key, from: a, to: b, dist, modeText, auto, mode, timing, sig, status: 'pending', route: null, note: '', wanted: false,
    };
    leg.plan = plan; // 시각을 고치면 경로는 그대로여도 잡아 둔 이동 시간이 바뀐다
    legs.push(leg);
  }
  state.legs = legs;
  if (state.selectedLeg && !legs.some((l) => l.key === state.selectedLeg)) state.selectedLeg = null;
}

function drawLeg(leg) {
  if (!mapView) return;
  if (!state.showRoutes) {
    mapView.removeLeg(leg.key);
    return;
  }
  const straight = [{ kind: 'straight', path: [[leg.from.place.lat, leg.from.place.lng], [leg.to.place.lat, leg.to.place.lng]] }];
  mapView.setLeg(leg.key, { segments: leg.route?.segments || straight, color: colorOf(leg.from), visible: legVisible(leg) });
}

function drawLegs() {
  if (!mapView) return;
  mapView.clearLegs();
  mapView.highlightLeg(state.selectedLeg);
  state.legs.forEach(drawLeg);
}

// 장소가 바뀌면 구간을 다시 만든다. '경로 찾기'를 이미 눌렀다면 바뀐 구간만 다시 찾는다
function refreshLegs() {
  buildLegs();
  drawLegs();
  computeLegs();
}

function routeFatalMessage({ err, kind }) {
  if (kind === 'rate') return '경로 요청 한도를 넘었습니다. 잠시 뒤 「경로 찾기」를 다시 눌러 주세요.';
  return `이동 경로를 찾을 수 없습니다. Google Cloud 콘솔에서 "Routes API"를 사용 설정하고, API 키 제한 목록에도 넣었는지 확인하세요. (${err?.message || err})`;
}

async function resolveLeg(leg) {
  if (leg.mode === 'FLIGHT') {
    leg.status = 'straight';
    leg.note = '항공·장거리 구간은 경로를 찾지 않고 직선으로 잇습니다.';
    return;
  }
  const base = {
    origin: latLng(leg.from.place), destination: latLng(leg.to.place), language: CFG.language, region: CFG.region, ...leg.timing,
  };
  let route = await computeLeg({ ...base, mode: leg.mode });
  // 대중교통 경로가 없으면 가까운 거리는 걸어서
  if (!route && leg.mode === 'TRANSIT' && leg.dist <= 2500) route = await computeLeg({ ...base, mode: 'WALKING' });
  leg.route = route;
  leg.status = route ? 'ok' : 'none';
  leg.note = route ? ''
    : leg.mode === 'TRANSIT'
      ? '구글이 이 구간의 대중교통 경로를 주지 않았어요. 일본처럼 API로 대중교통을 찾을 수 없는 곳도 있어요. 이동 시간은 일정표에 적은 시각으로 셈하고, 길은 구글 지도 길찾기로 확인해 주세요.'
      : '구글이 이 구간의 경로를 찾지 못했어요. 이동 방법을 바꿔 보거나 구글 지도에서 확인해 주세요.';
}

// announce: '경로 찾기'를 눌렀을 때만 끝나고 찾은 구간 수를 알린다 (시각·이동 방법을 고쳐 몇 구간만 다시 찾을 때는 조용히)
async function computeLegs(announce = false) {
  if (state.routeRunning) {
    state.routeRerun = true;
    state.routeAnnounce ||= announce;
    return;
  }
  announce ||= state.routeAnnounce;
  state.routeAnnounce = false;
  const queue = state.legs.filter((l) => l.status === 'pending' && (state.routesRequested || l.wanted));
  if (!queue.length) return;
  state.routeRunning = true;
  state.routeProgress = { done: 0, total: queue.length };
  state.routeAlert = '';
  render();

  let fatal = null;
  const worker = async () => {
    while (queue.length && !fatal) {
      const leg = queue.shift();
      leg.status = 'searching';
      scheduleRender();
      try {
        await resolveLeg(leg);
      } catch (err) {
        const kind = classifyError(err);
        if (kind !== 'other') {
          fatal ??= { err, kind };
          leg.status = 'pending';
          return;
        }
        leg.status = 'error';
        leg.note = `경로를 찾는 중 오류: ${err?.message || err}`;
      }
      state.routeProgress.done++;
      if (state.legs.includes(leg)) drawLeg(leg); // 그사이 장소가 바뀌어 버려진 구간은 그리지 않는다
      scheduleRender();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, CFG.concurrency) }, worker));

  state.routeRunning = false;
  if (fatal) {
    state.routeAlert = routeFatalMessage(fatal);
    state.routesRequested = false;
    state.legs.forEach((l) => { if (l.status === 'searching') l.status = 'pending'; l.wanted = false; });
  }
  render();
  if (!fatal && !state.routeRerun && announce) {
    const found = state.legs.filter((l) => l.route).length;
    const failed = state.legs.filter((l) => l.status === 'none' || l.status === 'error').length;
    if (found) showToast(`이동 경로 ${found}구간을 찾았어요${failed ? ` · 못 찾음 ${failed}` : ''}`);
  }
  if (state.routeRerun) {
    state.routeRerun = false;
    if (!fatal) computeLegs(announce);
  }
}

function findRoutes() {
  state.routesRequested = true;
  if (!state.showRoutes) {
    state.showRoutes = true;
    drawLegs();
  }
  computeLegs(true);
  render();
}

function selectLeg(key, from) {
  const next = from === 'list' && state.selectedLeg === key ? null : key;
  state.selectedLeg = next;
  if (state.selected != null) {
    state.selected = null;
    mapView?.highlight(null);
  }
  mapView?.closeInfo();
  mapView?.highlightLeg(next);
  if (next) mapView?.fitLeg(next);
  render();
  // 일정 점검에서 누른 구간은 좁은 화면에서도 목록의 그 자리로 옮겨 고침안을 보여 준다
  if (next && (from === 'check' || (from === 'map' && !isNarrow()))) {
    els.resultList.querySelector(`[data-leg="${next}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function setLegMode(key, mode) {
  if (mode) state.legModes.set(key, mode);
  else state.legModes.delete(key);
  buildLegs();
  const leg = state.legs.find((l) => l.key === key);
  if (leg) leg.wanted = true; // 이 구간은 바로 찾는다
  drawLegs();
  computeLegs();
  render();
}

function formatDuration(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  return min >= 60 ? `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ''}` : `${min}분`;
}

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)}km` : `${Math.round(m / 10) * 10}m`;
}

const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (t) => {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
// 노선 색은 구글이 주는 값이지만, style 속성에 넣기 전에 형식을 확인한다
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '');

function lineChip(seg) {
  const bg = safeColor(seg.color);
  const fg = safeColor(seg.textColor);
  const style = bg ? ` style="--lc:${bg}${fg ? `;--lt:${fg}` : ''}"` : '';
  return `<span class="line"${style} title="${escapeHtml(seg.lineName || seg.vehicle)}">${escapeHtml(seg.line || seg.vehicle || '대중교통')}</span>`;
}

// 경로가 있으면 어떻게 가는지 (노선 이름들, 도보, 차)
function routeHow(route) {
  const transit = route.segments.filter((s) => s.kind === 'transit');
  if (transit.length) return { transit, label: '' };
  return { transit, label: route.segments.every((s) => s.kind === 'walk') ? '도보' : MODES[route.mode] };
}

function legSummaryHtml(leg) {
  return legSummaryBody(leg) + (leg.status === 'searching' ? '' : rideFlag(leg));
}

function legSummaryBody(leg) {
  if (leg.status === 'searching') return '<span class="leg-mode">경로 찾는 중…</span>';
  const r = leg.route;
  if (r) {
    const { transit, label } = routeHow(r);
    const how = transit.length ? transit.map(lineChip).join('<span class="leg-arrow">→</span>') : `<span class="leg-mode">${label}</span>`;
    const check = legCheck(leg);
    const flag = check ? `<span class="leg-flag${check.fixed ? ' fixed' : ''}">${checkLabel(check)}</span>` : '';
    return `${how}<span class="leg-meta">${escapeHtml(r.durationText || formatDuration(r.duration))} · ${escapeHtml(r.distanceText || formatDistance(r.distance))}</span>${flag}`;
  }
  const straight = `직선 ${formatDistance(leg.dist)}`;
  const planned = plannedMinutes(leg);
  if (leg.status === 'straight') {
    return `<span class="leg-mode">${MODES[leg.mode]}</span><span class="leg-meta">${planned != null ? `일정표 기준 ${formatDuration(planned * 60000)}` : straight}</span>`;
  }
  if (leg.status === 'none' || leg.status === 'error') {
    // 경로가 없어도 일정표에 이동 시각을 적어 두었으면 그 시간으로 보여 준다 (일본 대중교통 등)
    if (planned != null) {
      return `<span class="leg-mode">${escapeHtml(leg.modeText || MODES[leg.mode])}</span><span class="leg-meta">일정표 기준 ${formatDuration(planned * 60000)} · 구글 경로 없음</span>`;
    }
    return `<span class="leg-mode warn">경로 없음</span><span class="leg-meta">${escapeHtml(leg.modeText || MODES[leg.mode])} · ${straight}</span>`;
  }
  return `<span class="leg-mode">${escapeHtml(leg.modeText || MODES[leg.mode])}</span><span class="leg-meta">${straight} · 경로 찾기 전</span>`;
}

// 엑셀 '다음 장소까지' 칸과 KML 설명에 넣는 글
function legSummaryText(leg) {
  const r = leg.route;
  if (r) {
    const { transit, label } = routeHow(r);
    const how = transit.length ? transit.map((s) => s.line || s.vehicle).join(' → ') : label;
    return `${leg.to.name}까지 ${how} · ${r.durationText || formatDuration(r.duration)} · ${r.distanceText || formatDistance(r.distance)}`;
  }
  const planned = plannedMinutes(leg);
  return `${leg.to.name}까지 ${leg.modeText || MODES[leg.mode]} · ${planned != null ? `일정표 기준 ${formatDuration(planned * 60000)}` : `직선 ${formatDistance(leg.dist)}`}`;
}

function directionsUrl(leg) {
  const travel = { TRANSIT: 'transit', WALKING: 'walking', DRIVING: 'driving', BICYCLING: 'bicycling' }[leg.route?.mode || leg.mode];
  const params = new URLSearchParams({
    api: '1',
    origin: `${leg.from.place.lat},${leg.from.place.lng}`,
    destination: `${leg.to.place.lat},${leg.to.place.lng}`,
  });
  if (leg.from.place.id) params.set('origin_place_id', leg.from.place.id);
  if (leg.to.place.id) params.set('destination_place_id', leg.to.place.id);
  if (travel) params.set('travelmode', travel);
  return `https://www.google.com/maps/dir/?${params}`;
}

function timingLine(leg) {
  if ((leg.route?.mode || leg.mode) !== 'TRANSIT') return '';
  const { departureTime, arrivalTime } = leg.timing;
  const t = departureTime || arrivalTime;
  if (!t) return '';
  return `<p class="meta">${t.getMonth() + 1}/${t.getDate()} ${hhmm(t)} ${departureTime ? '출발' : '도착'} 기준 시간표</p>`;
}

function renderLeg(leg) {
  const selected = state.selectedLeg === leg.key;
  // 대중교통 구간은 출발 시각을 시각 칸에 보여 준다
  const dep = (leg.route?.mode || leg.mode) === 'TRANSIT' && leg.timing.departureTime ? hhmm(leg.timing.departureTime) : '';
  return `<li class="leg leg-${leg.status}${selected ? ' selected' : ''}" data-leg="${leg.key}" style="--c:${colorOf(leg.from)}">
    <div class="tl-row">
      <span class="timeline-time">${dep}</span>
      <span class="timeline-rail"></span>
      <div class="leg-sum">${legSummaryHtml(leg)}</div>
    </div>
    ${selected ? renderLegDetail(leg) : ''}
  </li>`;
}

function renderLegDetail(leg) {
  const r = leg.route;
  const steps = r ? `<ol class="segs">${r.segments.map((s) => {
    if (s.kind === 'transit') {
      const parts = [`${escapeHtml(s.from)} → ${escapeHtml(s.to)}`];
      if (s.stops) parts.push(`${s.stops}정거장`);
      if (s.dep && s.arr) parts.push(`${hhmm(s.dep)}–${hhmm(s.arr)}`);
      return `<li>${lineChip(s)}<span>${parts.join(' · ')}${s.headsign ? ` <small>(${escapeHtml(s.headsign)} 방면)</small>` : ''}</span></li>`;
    }
    const name = { walk: '도보', drive: '차', bike: '자전거' }[s.kind] || '';
    const meta = [s.duration ? formatDuration(s.duration) : '', s.distance ? formatDistance(s.distance) : ''].filter(Boolean).join(' · ');
    return `<li><span class="seg-kind">${name}</span><span>${meta}</span></li>`;
  }).join('')}</ol>` : '';
  const chosen = state.legModes.get(leg.key) || '';
  const options = [['', `자동 (${MODES[leg.auto]})`], ['TRANSIT', '대중교통'], ['WALKING', '도보'], ['DRIVING', '차'], ['BICYCLING', '자전거']]
    .map(([value, label]) => `<option value="${value}"${chosen === value ? ' selected' : ''}>${label}</option>`)
    .join('');
  return `<div class="leg-detail">
    <div class="leg-ends">${escapeHtml(leg.from.name)} → ${escapeHtml(leg.to.name)}</div>
    ${leg.note ? `<p class="note">${escapeHtml(leg.note)}</p>` : ''}
    ${renderPlanFix(leg)}
    ${rideRisks.filter((r) => leg.plan?.travel.includes(r.index)).map(renderRideDetail).join('')}
    ${steps}
    <div class="detail-actions">
      <label class="leg-select">이동 방법 <select data-action="leg-mode">${options}</select></label>
      <a class="secondary-button" href="${escapeHtml(directionsUrl(leg))}" target="_blank" rel="noopener">구글 지도 길찾기 ↗</a>
    </div>
    ${timingLine(leg)}
  </div>`;
}

// 지금 보고 있는 날(전체면 모든 날)의 구간
const shownLegs = () => state.legs.filter(legVisible);

function metricHtml(label, value, unit = '') {
  return `<div class="metric"><span>${label}</span><strong>${value}${unit ? `<small>${unit}</small>` : ''}</strong></div>`;
}

function durationParts(ms) {
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)}<small>시간</small> ${min % 60}` : `${min}`;
}

// 어두운 동선 카드: 경로 찾기 전 → 찾는 중 → 준비됨
function renderRouteCard() {
  const legs = state.legs;
  els.routeCard.classList.toggle('hidden', state.running || !state.items.some((it) => it.place));
  els.routeToggle.checked = state.showRoutes;
  const pending = legs.filter((l) => l.status === 'pending').length;
  const found = legs.filter((l) => l.route);
  const failed = legs.filter((l) => l.status === 'none' || l.status === 'error').length;
  const total = travelOf(legs);
  const short = legs.filter((l) => legCheck(l)).length;

  let kicker = 'SMART ROUTING';
  let title = '이제 이동 경로를 찾아볼까요?';
  let copy = '일정표의 이동 수단과 시간에 맞춰, 구간마다 구글이 추천하는 경로와 소요 시간을 찾아요. 일정표에 잡은 이동 시간이 모자란 구간도 알려 드려요.';
  let status = '';
  if (!legs.length) {
    title = '이을 구간이 아직 없어요';
    copy = '같은 날짜에 장소가 두 곳 이상 있으면 순서대로 이어 드려요.';
    status = '이을 구간이 없습니다';
  } else if (state.routeRunning) {
    kicker = 'ROUTING';
    title = '이동 경로를 찾고 있어요';
    copy = '';
    status = `경로 찾는 중… ${state.routeProgress.done} / ${state.routeProgress.total}`;
  } else if (found.length) {
    kicker = 'ROUTE READY';
    title = pending ? '바뀐 구간이 있어요' : '이동 경로가 준비됐어요';
    copy = pending ? '장소나 이동 방법을 바꾼 구간을 다시 찾아 주세요.'
      : short || rideRisks.length ? `아래 일정 점검에 고칠 곳이 ${short + rideRisks.length}곳 있어요. 눌러서 시각을 고칠 수 있어요.`
        : '구간을 누르면 노선·정거장·출발 시각과 구글 지도 길찾기가 나와요.';
    status = `${legs.length}구간 · 이동 ${formatDuration(total)}${failed ? ` · 구글 경로 없음 ${failed}` : ''}`
      + `${short ? ` · 시간 부족 ${short}` : ''}${rideRisks.length ? ` · 탑승 여유 부족 ${rideRisks.length}` : ''}`;
  } else {
    status = `${legs.length}구간`;
  }
  els.routeKicker.textContent = kicker;
  els.routeTitle.textContent = title;
  els.routeCopy.textContent = copy;
  els.routeCopy.classList.toggle('hidden', !copy);
  els.routeStatus.textContent = status;

  els.routeMetrics.classList.toggle('hidden', !found.length || state.routeRunning);
  if (found.length) {
    els.routeMetrics.innerHTML = metricHtml('이동 시간', durationParts(total), '분')
      + metricHtml('구간', String(legs.length).padStart(2, '0'), '개')
      + metricHtml('방문 장소', String(state.items.filter((it) => it.place).length).padStart(2, '0'), '곳');
  }

  els.routeBtn.classList.toggle('hidden', !pending && !state.routeRunning);
  els.routeBtn.disabled = state.routeRunning;
  els.routeBtn.classList.toggle('is-loading', state.routeRunning);
  els.routeBtnText.textContent = state.routeRunning
    ? `경로 계산 중… ${state.routeProgress.done}/${state.routeProgress.total}`
    : `경로 찾기 · ${pending}구간`;
  els.routeAlert.textContent = state.routeAlert;
  els.routeAlert.classList.toggle('hidden', !state.routeAlert);
}

/* ───────────── 일정 점검 (이동 시간이 모자란 구간 고치기) ───────────── */

function timeCols() {
  const m = state.mapping;
  return { time: m.time, mode: m.mode, name: m.name, date: m.date };
}

// 놓치면 오래 기다리는 차를 타기 전 여유가 모자란 곳. 구글 경로 없이 일정표만으로 정하므로 render 때마다 다시 센다
let rideRisks = [];

const hm = (minutes) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

// 이동 행에 적어 둔 이동 시간(분). 구글 경로가 없을 때 대신 쓴다
function plannedMinutes(leg) {
  return leg.plan?.explicit && leg.plan.planned != null ? leg.plan.planned : null;
}

function legMillis(leg) {
  if (leg.route) return leg.route.duration;
  const planned = plannedMinutes(leg);
  return planned != null ? planned * 60000 : 0;
}

function checkLabel(check) {
  const text = check.kind === 'tight' ? `${check.short}분 부족` : `이동 ${check.need}분 없음`;
  return check.fixed ? `고정 · ${text}` : text;
}

// 경로를 찾은 구간에서 일정표에 잡은 이동 시간이 (여유를 더한) 구글 시간보다 모자란지 (fixed: 도착지가 [고정] 일정)
function legCheck(leg) {
  if (leg.status !== 'ok' || !leg.plan) return null;
  const m = state.mapping.mode;
  const modeTexts = m >= 0 ? leg.plan.travel.map((i) => cellText(state.records[i].cells[m])) : [];
  const fixed = hasTag(state.records[leg.to.recordIndex]);
  // 짐은 이동 행의 표시로만 본다 (출발 행의 "코인로커에 짐 보관 [짐]"은 짐을 맡기고 빈손으로 걷는 경우다)
  const luggage = leg.plan.travel.some((i) => hasTag(state.records[i], LUGGAGE_TAG));
  const check = checkTravel(leg.plan, leg.route, modeTexts, { strict: fixed, pace: PACES[state.pace], luggage });
  return check && { ...check, fixed };
}

function setPace(pace) {
  if (!PACES[pace] || pace === state.pace) return;
  state.pace = pace;
  storage.set(PACE_STORAGE, pace);
  render();
  const short = state.legs.filter((l) => legCheck(l)).length + rideRisks.length;
  showToast(`여유 정도: ${PACES[pace].label} · 고칠 곳 ${short}곳`);
}

// 그 행의 시각을 고칠 수 없는 까닭
function lockOf(index) {
  const rec = state.records[index];
  if (hasTag(rec)) return `${FIXED_TAG} 일정이라 바꾸지 않아요`;
  if (rec.cells[state.mapping.time]?.f) return '시간 칸이 수식이라 바꾸지 않아요';
  return '';
}

function legFixes(leg, check) {
  return fixOptions(state.records, leg.plan, leg.from.recordIndex, leg.to.recordIndex, check.step, timeCols(), lockOf);
}

// 고침안·고친 칸 목록에 보여 줄 행 이름: 일정 칸처럼 연결하지 않은 글자 칸, 없으면 장소 이름
function rowTitle(index) {
  const m = state.mapping;
  const skip = new Set([m.name, m.date, m.time, m.mode, m.region, m.address, m.lat, m.lng, m.category, m.memo, ...Object.values(state.resultCols)]);
  const { cells, rowNumber } = state.records[index];
  const free = state.headers.findIndex((_, i) => !skip.has(i) && cellText(cells[i]));
  return cellText(cells[free >= 0 ? free : m.name]) || `엑셀 ${rowNumber}행`;
}

function renderPlanFix(leg) {
  const check = legCheck(leg);
  const { plan } = leg;
  if (!check) {
    return plan?.explicit && plan.planned != null
      ? `<p class="meta">일정표에 잡은 이동 ${formatDuration(plan.planned * 60000)} (${hm(plan.start)}–${hm(plan.end)})</p>`
      : '';
  }
  const { transit, label } = routeHow(leg.route);
  const via = transit.length ? '대중교통' : label;
  const buffer = check.need - check.base;
  const google = buffer ? `구글 ${via} ${check.base}분에 여유 ${buffer}분을 더하면 ${check.need}분이에요` : `구글 ${via}로 ${check.need}분 걸려요`;
  const head = check.kind === 'tight'
    ? `일정표엔 이동 ${check.planned}분(${hm(plan.start)}–${hm(plan.end)})인데 ${google}`
    : `일정에 이동 시간이 없어요 · ${google}`;
  const fixes = legFixes(leg, check);
  const options = fixes.map((f, i) => `
    <button type="button" class="fix-option" data-action="plan-fix" data-fix="${i}"${f.blocked ? ' disabled' : ''}>
      <b>${escapeHtml(f.label)}</b>
      <span>${escapeHtml(rowTitle(f.row))} · ${escapeHtml(f.before)} → ${escapeHtml(f.after)}</span>
      ${f.blocked ? `<small>${escapeHtml(f.blocked)}</small>` : ''}
    </button>`).join('');
  return `<div class="plan-fix">
    <p class="plan-fix-head">${escapeHtml(head)}${check.fixed ? ' · 도착지가 고정 일정이에요' : ''}</p>
    ${options ? `<div class="fix-options">${options}</div>` : '<p class="meta">시각을 고칠 수 있는 앞뒤 일정이 없어요.</p>'}
  </div>`;
}

// 장소 목록의 시각은 buildItems 때 복사해 두므로, 시간 칸을 고치면 다시 읽어 온다
function syncItemTimes() {
  const col = state.mapping.time;
  for (const it of state.items) it.timeText = col >= 0 ? cellText(state.records[it.recordIndex].cells[col]) : '';
}

// 칸을 바꾼다. 되돌릴 수 있게 원래 칸을 남기고, 엑셀로 저장할 때 이 목록의 칸만 원래 파일에 써 넣는다
// changes: [{ index(records 번호), col, text } | { index, col, number }(위도·경도) | { index, col, text, minutes }(시각)]
function applyCellEdits(changes) {
  for (const c of changes) {
    const rec = state.records[c.index];
    const text = c.number != null ? String(c.number) : c.text;
    state.planEdits.push({ index: c.index, col: c.col, before: rec.cells[c.col], text, minutes: c.minutes ?? null, number: c.number ?? null });
    rec.cells[c.col] = c.number != null ? { v: c.number, w: text } : { v: text, w: text };
  }
}

// 고침안의 시간 칸을 바꾸고 구간·화면을 다시 만든다
function applyChanges(fix) {
  const col = state.mapping.time;
  applyCellEdits(fix.changes.map((change) => ({ index: change.index, col, text: change.text, minutes: change.minutes })));
  syncItemTimes();
  refreshLegs();
  render();
  showToast(`${rowTitle(fix.row)} → ${fix.after} · 엑셀 저장은 일정 점검에서`);
}

function applyFix(key, fixIndex) {
  const leg = state.legs.find((l) => l.key === key);
  const check = leg && legCheck(leg);
  const fix = check && legFixes(leg, check)[fixIndex];
  if (fix && !fix.blocked) applyChanges(fix);
}

/* ── 놓치면 오래 기다리는 차 ── */

const rideName = (risk) => cellText(state.records[risk.index].cells[state.mapping.mode]);
const rideDay = (risk) => (state.mapping.date >= 0 ? cellText(state.records[risk.dayStart].cells[state.mapping.date]) : '');
const marginLabel = (risk) => (risk.margin < 0 ? `앞 일정과 ${-risk.margin}분 겹침` : `타기 전 여유 ${risk.margin}분`);

function applyRideFix(index) {
  const risk = rideRisks.find((r) => r.index === index);
  const fix = risk && boardingFix(state.records, risk, timeCols(), lockOf);
  if (!fix || fix.blocked) return;
  state.openRide = null;
  applyChanges(fix);
}

function renderRideDetail(risk) {
  const fix = boardingFix(state.records, risk, timeCols(), lockOf);
  const h = risk.headway;
  const prev = `${rowTitle(risk.prev)} ${cellText(state.records[risk.prev].cells[state.mapping.time])}`;
  const why = [
    h.edge ? `${h.edge} · 놓치면 다음 차가 한참 뒤거나 없을 수 있어요` : '',
    h.source === 'memo' ? `메모(“${h.note}”) 기준 배차 최대 ${formatDuration(h.minutes * 60000)}`
      : `이동 수단(“${h.note}”)으로 짐작한 배차 약 ${formatDuration(h.minutes * 60000)}`,
    risk.fixed ? `${FIXED_TAG} 일정` : '',
  ].filter(Boolean).join(' · ');
  const gap = risk.margin < 0 ? `${-risk.margin}분 겹쳐요` : `여유 ${risk.margin}분`;
  return `<div class="plan-fix ride-detail">
    <p class="plan-fix-head">${escapeHtml(`${rideName(risk)} ${hm(risk.start)} 출발 · 앞 일정(${prev})과 ${gap} · ${PACES[state.pace].label} 기준 ${risk.need}분`)}</p>
    <p class="meta">${escapeHtml(why)}</p>
    <div class="fix-options">
      <button type="button" class="fix-option" data-ride-fix="${risk.index}"${fix.blocked ? ' disabled' : ''}>
        <b>${escapeHtml(fix.label)}</b>
        ${fix.row != null ? `<span>${escapeHtml(rowTitle(fix.row))} · ${escapeHtml(fix.before)} → ${escapeHtml(fix.after)}</span>` : ''}
        ${fix.blocked ? `<small>${escapeHtml(fix.blocked)}</small>` : ''}
      </button>
    </div>
    ${fix.blocked ? '<p class="meta">차 시간표를 미리 확인하고, 놓쳤을 때의 대안(다음 차·택시·코인로커 등)을 메모해 두세요.</p>' : ''}
  </div>`;
}

// 구간 안에 타기 전 여유가 모자란 차가 있으면 목록의 구간 줄에도 표시한다
function rideFlag(leg) {
  const risk = rideRisks.find((r) => leg.plan?.travel.includes(r.index));
  return risk ? `<span class="leg-flag">${escapeHtml(marginLabel(risk))}</span>` : '';
}

function undoEdits() {
  for (const e of [...state.planEdits].reverse()) state.records[e.index].cells[e.col] = e.before;
  state.planEdits = [];
  state.picks.clear();
  // 추천에서 고른 가게로 채웠던 끼니 행은 다시 빈 행이 되므로 지도에서도 뺀다
  const keep = new Set(buildItems().items.map((it) => it.recordIndex));
  if (state.items.some((it) => !keep.has(it.recordIndex))) {
    const selected = state.items[state.selected];
    state.items = state.items.filter((it) => keep.has(it.recordIndex));
    renumberItems(selected);
  }
  syncItemTimes();
  refreshLegs();
  render();
  showToast('고친 일정을 모두 되돌렸어요');
}

// 고친 칸마다 원래 글자와 마지막 글자 (같은 칸을 여러 번 고쳐도 한 줄)
function editedRows() {
  const rows = new Map();
  for (const e of state.planEdits) {
    const key = `${e.index}:${e.col}`;
    const from = rows.get(key)?.from ?? cellText(e.before);
    rows.set(key, { index: e.index, col: e.col, from, text: e.text, minutes: e.minutes, number: e.number });
  }
  return [...rows.values()].filter((r) => r.text !== r.from);
}

// 원래 파일에 고친 칸만 바꿔 쓴 사본을 내려받는다 (.xlsx는 서식 그대로)
function saveEditedPlan() {
  const rows = editedRows();
  if (!rows.length || !state.fileBuffer) return;
  const out = writeEditedWorkbook({
    buffer: state.fileBuffer,
    fileName: state.fileName,
    workbook: state.workbook,
    sheetName: state.sheetName,
    edits: rows.map((r) => ({
      ref: XLSX.utils.encode_cell({ r: state.records[r.index].rowNumber - 1, c: state.startCol + r.col }),
      text: r.text,
      minutes: r.minutes,
      number: r.number,
    })),
  });
  downloadBlob(new Blob([out.data], { type: out.type }), out.fileName);
  showToast(out.keptFormat ? `고친 일정을 저장했어요 · ${out.fileName}` : '고친 일정을 저장했어요 · 이 형식은 서식이 남지 않아요');
}

let lastPlanCheckHtml = '';
function renderPlanCheck() {
  const flagged = state.legs.map((leg) => [leg, legCheck(leg)]).filter(([, check]) => check);
  const rows = editedRows();
  let html = '';
  // 경로를 찾은 뒤에는 모자란 곳이 없어도 보여 준다 (여유 정도를 바꿔 볼 수 있게).
  // 타기 전 여유는 일정표만으로 정하므로 경로를 찾기 전에도 보여 준다
  if (state.items.length && (state.legs.some((l) => l.route) || rows.length || rideRisks.length)) {
    const pace = `<div class="pace-row">
        <span class="pace-label">여유</span>
        <div class="pace-switch" role="group" aria-label="여유 정도">${Object.entries(PACES).map(([key, p]) => (
          `<button type="button" data-pace="${key}" aria-pressed="${state.pace === key}"${state.pace === key ? ' class="active"' : ''}>${p.label}</button>`
        )).join('')}</div>
        <span class="pace-note">${escapeHtml(paceNote(PACES[state.pace]))}</span>
      </div>`;
    const manyDays = state.colors.size > 1;
    const legs = flagged.map(([leg, check]) => `<button type="button" class="plan-check-leg${check.fixed ? ' fixed' : ''}" data-goto-leg="${leg.key}">`
      + `${manyDays ? `<small>${escapeHtml(dayInfo(leg.from.category).label)}</small>` : ''}${escapeHtml(leg.from.name)} → ${escapeHtml(leg.to.name)}`
      + ` <b>${checkLabel(check)}</b></button>`).join('');
    const edits = rows.length ? `<div class="plan-edits">
        <div class="plan-edits-label">고친 칸 ${rows.length}개 · 저장하면 원래 엑셀에서 이 칸만 바뀌어요</div>
        <ul>${rows.map((r) => `<li><span>${escapeHtml(rowTitle(r.index))}${r.col !== state.mapping.time ? ` <small>${escapeHtml(state.headers[r.col])}</small>` : ''}</span>`
          + `<s>${escapeHtml(r.from || '(빈 칸)')}</s><b>${escapeHtml(r.text)}</b></li>`).join('')}</ul>
        <div class="detail-actions">
          <button type="button" class="primary-button small" data-plan="save">고친 일정 엑셀로 저장</button>
          <button type="button" class="secondary-button" data-plan="undo">모두 되돌리기</button>
        </div>
      </div>` : '';
    const rides = rideRisks.map((r) => {
      const open = state.openRide === r.index;
      return `<button type="button" class="plan-check-leg ride${open ? ' open' : ''}" data-ride="${r.index}" aria-expanded="${open}">`
        + `${rideDay(r) ? `<small>${escapeHtml(rideDay(r))}</small>` : ''}${escapeHtml(rideName(r))} ${hm(r.start)} <b>${escapeHtml(marginLabel(r))}</b></button>`;
    }).join('');
    const openRisk = rideRisks.find((r) => r.index === state.openRide);
    const group = (label, chips, extra = '') => (chips
      ? `<div class="plan-check-group"><div class="plan-check-label">${label}</div><div class="plan-check-legs">${chips}</div>${extra}</div>` : '');
    const total = flagged.length + rideRisks.length;
    const head = total ? `고칠 곳 <b>${total}곳</b> · 눌러서 고칠 수 있어요` : '모자란 곳이 없어요';
    html = `<div class="plan-check-head"><span class="section-kicker">PLAN CHECK</span><span>${head}</span></div>${pace}`
      + group('이동 시간이 모자란 구간', legs)
      + group('놓치면 오래 기다리는 차 · 타기 전 여유가 모자라요', rides, openRisk ? renderRideDetail(openRisk) : '')
      + edits;
  }
  els.planCheck.classList.toggle('hidden', !html);
  // 버튼을 누르는 도중 다시 그려 클릭이 사라지지 않도록, 바뀐 경우에만 다시 그린다
  if (html !== lastPlanCheckHtml) {
    els.planCheck.innerHTML = html;
    lastPlanCheckHtml = html;
  }
}

// 일정 점검에서 구간을 누르면 목록에서 그 구간을 펼치고 지도를 맞춘다
function goToLeg(key) {
  const leg = state.legs.find((l) => l.key === key);
  if (!leg) return;
  state.filter = 'all';
  if (!state.showRoutes) {
    state.showRoutes = true;
    drawLegs();
  }
  if (!legVisible(leg)) setDay(leg.from.category);
  selectLeg(key, 'check');
}

/* ───────────── 여행 일정 추천 ───────────── */

function aiSettings(provider = storage.get('plannerProvider') || (storage.get(CLAUDE_KEY_STORAGE) ? 'claude' : 'google')) {
  const config = AI_PROVIDERS[provider];
  return { provider: config ? provider : 'google', key: config ? storage.get(config.keyStorage) || '' : '', model: config ? storage.get(`plannerModel.${provider}`) || config.model : '' };
}
function fillAISettings() {
  const selected = aiSettings(els.aiProvider.value);
  els.aiModel.value = selected.model;
  els.claudeKeyInput.value = selected.key;
  els.aiModel.disabled = els.claudeKeyInput.disabled = selected.provider === 'google';
}
const PLAN_CURRENCIES = ['KRW', 'JPY', 'USD', 'EUR'];

function setupPlanner() {
  const saved = loadJson(PLANNER_STORAGE, {});
  els.planPace.innerHTML = Object.entries(PACES).map(([key, p]) => `<option value="${key}">${p.label}</option>`).join('');
  els.planBudgetCurrency.innerHTML = PLAN_CURRENCIES.map((c) => `<option value="${c}">${CURRENCIES[c].label}</option>`).join('');
  const chosen = new Set(saved.interests || ['sights', 'food']);
  els.planInterests.innerHTML = Object.entries(INTERESTS).map(([key, v]) => (
    `<label class="interest-chip"><input type="checkbox" value="${key}"${chosen.has(key) ? ' checked' : ''}><span>${escapeHtml(v.label)}</span></label>`
  )).join('');
  els.planRegion.value = saved.region || '';
  els.planDays.value = saved.days || 3;
  els.planStay.value = saved.stay || '';
  els.planTransport.value = saved.transport || 'transit';
  els.planPace.value = PACES[saved.pace] ? saved.pace : 'normal';
  els.planNotes.value = saved.notes || '';
  els.planBudget.value = state.budget.amount ?? '';
  els.planBudgetCurrency.value = PLAN_CURRENCIES.includes(state.budget.currency) ? state.budget.currency : 'KRW';
  els.aiProvider.value = aiSettings().provider;
  fillAISettings();
}

function readPlanner() {
  const amount = parseFloat(els.planBudget.value.replace(/[^\d.]/g, ''));
  return {
    region: els.planRegion.value.trim(),
    start: els.planStart.value,
    days: Math.min(14, Math.max(1, parseInt(els.planDays.value, 10) || 3)),
    stay: els.planStay.value.trim(),
    transport: els.planTransport.value,
    pace: els.planPace.value,
    interests: [...els.planInterests.querySelectorAll('input:checked')].map((i) => i.value),
    budget: Number.isFinite(amount) && amount > 0 ? { amount, currency: els.planBudgetCurrency.value } : null,
    notes: els.planNotes.value.trim(),
  };
}

function setPlannerOpen(open) {
  els.plannerForm.classList.toggle('hidden', !open);
  els.plannerToggle.setAttribute('aria-expanded', String(open));
  els.plannerToggle.textContent = open ? '접기' : '열기';
}

// 일정 짜기: 선택한 AI 키가 있으면 AI 초안 → 구글 지도로 확인, 없으면 구글 지도 데이터만으로. 다 되면 엑셀을 올린 것처럼 지도에 올린다
// revise: 지난 결과에서 확인에 걸린 곳만 AI에게 고쳐 달라고 한다
async function generateTrip({ revise = false } = {}) {
  if (state.planner.running || mapState !== 'ready') return;
  const previous = state.planner.result;
  const req = revise && previous ? previous.req : readPlanner();
  if (!req.region) {
    setPlannerOpen(true);
    els.planRegion.focus();
    return;
  }
  if (!revise) {
    const { region, days, stay, transport, pace, interests, notes } = req;
    storage.set(PLANNER_STORAGE, JSON.stringify({ region, days, stay, transport, pace, interests, notes }));
    if (req.budget) {
      state.budget = { ...state.budget, ...req.budget };
      storage.set(BUDGET_STORAGE, JSON.stringify(state.budget));
    }
  }
  const selected = aiSettings(revise && previous ? previous.engine : undefined);
  const { key, provider: engine } = selected;
  const model = revise && previous?.model ? previous.model : selected.model;
  if (engine !== 'google' && !key) {
    showToast(`${AI_PROVIDERS[engine].label} API 키를 설정에서 저장해 주세요.`);
    if (!els.settingsDialog.open) els.settingsDialog.showModal();
    return;
  }
  state.planner = { running: true, engine, step: engine !== 'google' ? 'draft' : 'area', progress: null, error: '', result: revise ? previous : null };
  renderPlanner();
  const onProgress = (p) => {
    state.planner.progress = p;
    if (p.step) state.planner.step = p.step;
    renderPlanner();
  };
  let stage = engine !== 'google' ? 'ai' : 'google';
  try {
    let plan;
    let raw = '';
    let cost = null;
    if (engine !== 'google') {
      const issues = revise ? planIssues(previous.plan).map((x) => `${x.label} ${x.item.place_ko || x.item.place}: ${x.text}`) : [];
      const out = await planWithAI(req, { provider: engine, model, apiKey: key, onProgress, previous: revise ? previous.raw : null, issues });
      ({ plan, raw } = out);
      cost = out.cost == null ? null : (revise ? previous.cost || 0 : 0) + out.cost;
      stage = 'google';
      Object.assign(state.planner, { step: 'verify', progress: null });
      renderPlanner();
      await verifyPlan(plan, { onProgress });
    } else {
      plan = await planWithGoogle(req, { language: CFG.language, onProgress });
    }
    stage = 'load';
    Object.assign(state.planner, { step: 'load', progress: null });
    renderPlanner();
    const { buffer, fileName } = planToWorkbook(plan, req, engine);
    state.planner = { running: false, engine, step: '', progress: null, error: '', result: { plan, req, raw, cost, engine, model, buffer, fileName } };
    setPlannerOpen(false);
    renderPlanner();
    await handleFile(new File([buffer], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    await run();
    const issues = planIssues(plan).length;
    showToast(`${plan.days.length}일 일정을 지도에 올렸어요${issues ? ` · 확인할 곳 ${issues}곳` : ''}`);
  } catch (err) {
    const why = stage === 'google' ? classifyError(err) : 'other';
    const message = why === 'fatal' ? `구글 장소 검색이 거부되었어요. "Places API (New)"가 켜져 있는지 확인하세요. (${err?.message || err})`
      : why === 'rate' ? '구글 장소 검색 한도를 넘었어요. 잠시 뒤 다시 눌러 주세요.' : err?.message || String(err);
    state.planner = { ...state.planner, running: false, error: message };
    renderPlanner();
  }
}

const PLANNER_STEPS = {
  claude: [['draft', 'Claude가 일정을 짜는 중'], ['verify', '장소를 구글 지도에서 확인하는 중'], ['load', '지도에 올리는 중']],
  google: [['area', '지역 찾는 중'], ['collect', '인기 장소 모으는 중'], ['arrange', '가까운 곳끼리 날짜별로 묶는 중'], ['load', '지도에 올리는 중']],
};

function plannerProgressHtml(p) {
  const steps = PLANNER_STEPS[p.engine] || [['draft', `${AI_PROVIDERS[p.engine]?.label || 'AI'}가 일정을 짜는 중`], ['verify', '장소를 구글 지도에서 확인하는 중'], ['load', '지도에 올리는 중']];
  const at = steps.findIndex(([key]) => key === p.step);
  const detail = (key) => {
    if (key !== p.step || !p.progress) {
      return key === 'draft' && key === p.step ? '보통 30초~2분 걸려요' : '';
    }
    if (key === 'draft') return p.progress.days ? `${p.progress.days}일차를 쓰는 중 · ${p.progress.chars.toLocaleString('en-US')}자` : '생각을 정리하는 중';
    if (key === 'verify') return `${p.progress.done} / ${p.progress.total}`;
    return '';
  };
  return `<ol class="planner-steps">${steps.map(([key, label], i) => {
    const cls = i < at ? 'done' : i === at ? 'now' : '';
    const extra = detail(key);
    return `<li class="${cls}"><span>${label}${i === at ? '…' : ''}</span>${extra ? `<small>${escapeHtml(extra)}</small>` : ''}</li>`;
  }).join('')}</ol>`;
}

function plannerResultHtml(result) {
  const { plan, engine, cost } = result;
  const issues = planIssues(plan);
  const days = plan.days.map((d, i) => {
    const label = d.date ? (() => {
      const [y, m, dd] = d.date.split('-').map(Number);
      const date = new Date(y, m - 1, dd);
      return `${m}/${dd} (${WEEKDAYS[date.getDay()]})`;
    })() : `${i + 1}일차`;
    const stops = d.items.filter((it) => it.kind === 'place').length;
    return `<li><b>${escapeHtml(label)}</b><span>${escapeHtml([d.city, d.theme].filter(Boolean).join(' · '))}</span><small>${stops}곳</small></li>`;
  }).join('');
  const by = engine !== 'google' ? `${AI_PROVIDERS[engine]?.label || 'AI'} 초안 · 구글 지도로 확인${cost != null ? ` · 사용료 약 $${cost.toFixed(2)}` : ''}` : '구글 지도 평점으로 추천';
  return `<div class="planner-result">
    <div class="planner-title"><b>${escapeHtml(plan.title)}</b><small>${escapeHtml(by)}</small></div>
    ${plan.summary ? `<p class="planner-summary">${escapeHtml(plan.summary)}</p>` : ''}
    <ol class="planner-days">${days}</ol>
    ${issues.length ? `<div class="planner-issues"><div class="rd-label">확인이 필요한 곳 ${issues.length}</div><ul>${issues.map((x) => (
      `<li><b>${escapeHtml(x.label)}</b> ${escapeHtml(x.item.place_ko || x.item.place)} <span>${escapeHtml(x.text)}</span></li>`
    )).join('')}</ul></div>` : ''}
    ${plan.tips.length ? `<div class="planner-tips"><div class="rd-label">알아 둘 점</div><ul>${plan.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul></div>` : ''}
    <div class="detail-actions">
      <button type="button" class="secondary-button" data-planner="download">추천 일정 엑셀 내려받기</button>
      ${engine !== 'google' && issues.length && aiSettings(engine).key ? `<button type="button" class="secondary-button" data-planner="revise">AI에게 고쳐 달라고 하기 (${issues.length}곳)</button>` : ''}
    </div>
    <p class="meta">일정 점검·하루 예산·빈 끼니의 맛집 추천은 아래에서 그대로 쓸 수 있어요.</p>
  </div>`;
}

let lastPlannerHtml = '';
function renderPlanner() {
  els.plannerCard.classList.toggle('hidden', mapState !== 'ready');
  const p = state.planner;
  const selected = aiSettings();
  els.plannerEngine.innerHTML = selected.provider !== 'google'
    ? `<b>${AI_PROVIDERS[selected.provider].label}</b> (${escapeHtml(selected.model)})로 짜고 구글 지도로 확인해요${selected.key ? '' : ' · 설정에서 API 키를 저장해 주세요'}`
    : '구글 지도 평점으로 짜요 · <button type="button" class="link-button" data-open="settingsDialog">AI 설정</button>';

  els.plannerBtn.disabled = p.running;
  els.plannerBtn.classList.toggle('is-loading', p.running);
  els.plannerBtnText.textContent = p.running ? '짜는 중…' : p.result ? '새로 짜기' : '일정 짜기';
  let html = '';
  if (p.running) html = plannerProgressHtml(p);
  else if (p.result) html = plannerResultHtml(p.result);
  if (p.error) html = `<p class="alert">${escapeHtml(p.error)}</p>${p.running ? '' : html}`;
  els.plannerStatus.classList.toggle('hidden', !html);
  if (html !== lastPlannerHtml) {
    els.plannerStatus.innerHTML = html;
    lastPlannerHtml = html;
  }
}

/* ───────────── 주변 명소·맛집 ───────────── */

const REC_COLORS = { food: '#e8710a', cafe: '#8d6e63', sights: '#00897b' };
const REC_SHOWN = 10; // 처음 보여 줄 곳 수 (더 보기로 20곳까지)
const ratingScores = loadJson(SCORE_STORAGE, {});

function atOf(dateCell, minutes) {
  const d = parseDay(dateCell);
  if (!d || minutes == null) return null;
  return { weekday: d.getDay(), minutes, label: `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]}) ${hm(minutes)} 기준` };
}

// 일정의 장소를 기준으로: 그곳을 다 본 뒤(끝 시각)에 갈 곳을 찾는다
function itemAnchor(it) {
  const { start, end } = parseTimeRange(it.timeText);
  return { name: it.name, ...latLng(it.place), item: it, slot: null, at: atOf(it.dateCell, end ?? start), hints: [] };
}

function openRecs(anchor, { kind = 'food', keyword = '' } = {}) {
  state.recs = { anchor, kind, keyword, places: null, list: null, loading: false, error: '', more: false, focus: null, open: null };
  els.recsQuery.value = anchor.item || anchor.slot != null ? '' : anchor.name;
  loadRecs();
  els.recsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeRecs() {
  state.recs = null;
  mapView?.clearRecs();
  mapView?.closeInfo();
  render();
}

async function loadRecs() {
  const recs = state.recs;
  if (!recs) return;
  const { anchor, kind, keyword } = recs;
  Object.assign(recs, { loading: true, error: '', places: null, list: null, focus: null, open: null, more: false });
  mapView?.clearRecs();
  render();
  const country = countryAt(anchor);
  // 일본 가게는 일본어 이름이라야 타베로그에서 찾을 수 있고 간판과도 맞는다
  const language = country === 'JP' ? 'ja' : country === 'KR' ? 'ko' : CFG.language;
  try {
    const places = await findNearby({ center: latLng(anchor), kind, keyword, language, region: CFG.region });
    if (state.recs !== recs || recs.kind !== kind || recs.keyword !== keyword) return; // 그사이 다른 것을 골랐다
    recs.places = kind === 'sights' ? dropParts(places) : ['breakfast', 'lunch'].includes(anchor.meal) ? withoutBars(places) : places;
  } catch (err) {
    if (state.recs !== recs || recs.kind !== kind || recs.keyword !== keyword) return;
    const why = classifyError(err);
    recs.error = why === 'fatal'
      ? `주변 검색이 거부되었습니다. Google Cloud 콘솔에서 "Places API (New)"가 켜져 있는지, API 키 제한 목록에 있는지 확인하세요. (${err?.message || err})`
      : why === 'rate' ? '요청 한도를 넘었어요. 잠시 뒤 다시 골라 주세요.' : `주변을 찾지 못했어요: ${err?.message || err}`;
    recs.places = [];
  }
  recs.loading = false;
  rankRecs();
  render();
  showRecPins(true);
}

// 그 장소가 일정에 이미 있는지 (구글 장소 ID가 같거나 거의 같은 자리)
function plannedItem(p) {
  return state.items.find((it) => it.place && ((p.id && it.place.id === p.id) || distanceMeters(it.place, p) < 15));
}

function recCurrency(recs) {
  const day = recs.anchor.slot != null ? budgetDays.find((d) => d.lines.some((l) => l.index === recs.anchor.slot)) : null;
  return day?.currency || COUNTRY_CURRENCY[countryAt(recs.anchor)] || mostCommon((recs.places || []).map((p) => p.price?.currency)) || '';
}

function rankRecs() {
  const recs = state.recs;
  if (!recs?.places) return;
  const { anchor, kind } = recs;
  recs.at = anchor.at || (recs.places[0] ? nowAt(recs.places[0]) : null);
  recs.allowance = kind === 'sights' ? null : slotAllowance(anchor.slot);
  const currency = recCurrency(recs);
  const ranked = rankPlaces(recs.places, {
    center: latLng(anchor),
    kind,
    at: recs.at,
    allowance: recs.allowance?.over != null ? null : recs.allowance,
    costOf: (p) => priceOf(p, currency),
    extraScore: (p) => {
      const src = ratingSource(p, kind);
      return src && ratingScores[p.id] != null ? scoreOnGoogleScale(src.key, ratingScores[p.id]) : null;
    },
  }).map((p) => ({ ...p, planned: plannedItem(p) || null }));
  // 일정에 이미 있는 곳은 맨 뒤로
  recs.list = [...ranked.filter((p) => !p.planned), ...ranked.filter((p) => p.planned)];
}

function shownRecs(recs) {
  return (recs?.list || []).slice(0, recs.more ? 20 : REC_SHOWN);
}

function showRecPins(fit) {
  if (!mapView) return;
  const recs = state.recs;
  const shown = shownRecs(recs);
  if (!shown.length) {
    mapView.clearRecs();
    return;
  }
  mapView.setRecs(shown.map((p, i) => ({ key: p.id, lat: p.lat, lng: p.lng, label: String(i + 1), color: REC_COLORS[recs.kind], title: p.name })));
  if (!recs.anchor.item) mapView.setAnchor(recs.anchor);
  if (fit) mapView.fitPoints([latLng(recs.anchor), ...shown.slice(0, 6).map(latLng)]);
}

// 추천을 누르면 그 칸을 펼쳐 사진·리뷰·영업시간을 보여 주고 지도에서도 가리킨다. 펼친 칸을 다시 누르면 접는다
function focusRec(id, from) {
  const recs = state.recs;
  const p = recs?.list?.find((x) => x.id === id);
  if (!p) return;
  recs.open = recs.open === id && from === 'list' ? null : id;
  recs.focus = id;
  if (recs.open) loadDetails(p);
  render();
  mapView?.focusRec(id, recInfoHtml(p, recs));
  if (from === 'map') els.recsBody.querySelector(`[data-rec="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// 장소 ID → { loading } | { data } | { error } (구글 약관상 이 페이지를 연 동안만 기억한다)
const recDetails = new Map();

async function loadDetails(p) {
  const known = recDetails.get(p.id);
  if (known && !known.error) return;
  recDetails.set(p.id, { loading: true });
  try {
    recDetails.set(p.id, { data: await placeDetails(p.id, CFG.language) });
  } catch (err) {
    const why = classifyError(err);
    recDetails.set(p.id, {
      error: why === 'fatal' ? '자세한 정보를 받을 수 없어요. API 키 제한에 Places API (New)가 들어 있는지 확인하세요.'
        : why === 'rate' ? '요청 한도를 넘었어요. 잠시 뒤 다시 눌러 주세요.' : `자세한 정보를 불러오지 못했어요: ${err?.message || err}`,
    });
  }
  render();
  // 지도 말풍선에도 사진을 넣는다 (그 가게를 아직 보고 있을 때만)
  if (state.recs?.focus === p.id) mapView?.focusRec(p.id, recInfoHtml(p, state.recs), false);
}

const stars = (n) => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));

function recDetailHtml(p, recs) {
  const { data, loading, error } = recDetails.get(p.id) || {};
  const hours = weekHours(p);
  const today = recs.at?.weekday;
  const hoursHtml = hours.length ? `<div class="rd-block"><div class="rd-label">영업시간${recs.at ? ` <small>${recs.at.now ? '오늘' : `${WEEKDAYS[today]}요일`} 굵게</small>` : ''}</div>
    <ul class="rd-hours">${hours.map((h) => `<li${h.day === today ? ' class="today"' : ''}><b>${h.label}</b>${escapeHtml(h.text)}</li>`).join('')}</ul></div>` : '';
  const links = [
    `<a href="${escapeHtml(walkUrl(recs.anchor, p))}" target="_blank" rel="noopener">${escapeHtml(recs.anchor.name)}에서 걸어가기 ↗</a>`,
    data?.phone ? `<a href="tel:${escapeHtml(data.phone.replace(/[^\d+]/g, ''))}">${escapeHtml(data.phone)}</a>` : '',
    data?.website ? `<a href="${escapeHtml(data.website)}" target="_blank" rel="noopener">웹사이트 ↗</a>` : '',
  ].filter(Boolean).join('');
  let more = '';
  if (loading) more = '<p class="rd-status">사진·리뷰를 불러오는 중…</p>';
  else if (error) more = `<p class="rd-status warn">${escapeHtml(error)}</p>`;
  else if (data) {
    const photos = data.photos.filter((ph) => ph.url);
    const authors = [...new Map(photos.flatMap((ph) => ph.authors).filter((a) => a.name).map((a) => [a.name, a])).values()];
    const credit = (a) => (a.uri ? `<a href="${escapeHtml(a.uri)}" target="_blank" rel="noopener">${escapeHtml(a.name)}</a>` : escapeHtml(a.name));
    more = [
      photos.length ? `<div class="rd-photos">${photos.map((ph) => `<a href="${escapeHtml(ph.link || googleUrl(p))}" target="_blank" rel="noopener"><img src="${escapeHtml(ph.url)}" alt="${escapeHtml(p.name)} 사진" loading="lazy"></a>`).join('')}</div>` : '',
      data.about ? `<p class="rd-about">${escapeHtml(data.about)}</p>` : '',
      data.features.length ? `<div class="rd-features">${data.features.map((f) => `<span>${escapeHtml(f)}</span>`).join('')}</div>` : '',
      data.reviewSummary?.text ? `<div class="rd-block"><div class="rd-label">리뷰 요약 <small>${escapeHtml(data.reviewSummary.disclosure)}</small></div><p class="rd-summary">${escapeHtml(data.reviewSummary.text)}</p></div>` : '',
      data.reviews.length ? `<div class="rd-block"><div class="rd-label">리뷰</div><ul class="rd-reviews">${data.reviews.map((r) => `<li>
          <div class="rd-review-head"><span class="rd-stars" aria-label="별 ${r.rating}개">${stars(r.rating || 0)}</span>${r.authorUri ? credit({ name: r.author, uri: r.authorUri }) : escapeHtml(r.author)}<small>${escapeHtml(r.when)}</small></div>
          <p class="rd-review" data-review title="눌러서 펼치기">${escapeHtml(r.text)}</p>
        </li>`).join('')}</ul><a class="rd-more" href="${escapeHtml(data.reviewSummary?.uri || googleUrl(p))}" target="_blank" rel="noopener">구글 지도에서 리뷰 더 보기 ↗</a></div>` : '',
      `<p class="rd-credit">${authors.length ? `사진: ${authors.slice(0, 3).map(credit).join(', ')} · ` : ''}정보: Google 지도</p>`,
    ].join('');
  }
  return `<div class="rec-detail">
    ${more}
    ${hoursHtml}
    <div class="rd-block"><div class="rd-label">주소</div><p class="rd-address">${escapeHtml(p.address || '')}</p><div class="rd-links">${links}</div></div>
  </div>`;
}

function priceText(p) {
  const c = p.cost;
  if (!c) return '';
  if (c.from === 'level') return levelSigns(p.priceLevel, c.currency);
  if (c.max == null) return `${formatMoney(c.min, c.currency)}~`;
  return c.min ? `${formatMoney(c.min, c.currency).replace(/[^\d,.]+$/, '')}–${formatMoney(c.max, c.currency)}` : `~${formatMoney(c.max, c.currency)}`;
}

function recMeta(p, kind) {
  return [
    p.rating != null ? `★${p.rating.toFixed(1)}` : '평점 없음',
    p.count ? `리뷰 ${p.count.toLocaleString('en-US')}` : '',
    priceText(p) || (kind === 'sights' ? '' : '가격 정보 없음'),
    `걸어서 ${p.walk}분`,
  ].filter(Boolean).join(' · ');
}

function openText(p) {
  if (!p.open || p.open.state === 'unknown') return '';
  return `<span class="rec-open ${p.open.state}">${escapeHtml(p.open.text)}</span>`;
}

function recInfoHtml(p, recs) {
  const src = ratingSource(p, recs.kind);
  return `<div class="info">
    <div class="info-title">${escapeHtml(p.name)}</div>
    <span class="info-cat" style="--c:${REC_COLORS[recs.kind]}">${escapeHtml(typeLabel(p, recs.kind))}</span>
    ${recDetails.get(p.id)?.data?.photos[0]?.url ? `<img class="info-photo" src="${escapeHtml(recDetails.get(p.id).data.photos[0].url)}" alt="">` : ''}
    <p class="info-memo">${escapeHtml(recMeta(p, recs.kind))}</p>
    ${openText(p)}
    <div class="info-links">
      <a class="info-link" href="${escapeHtml(googleUrl(p))}" target="_blank" rel="noopener">구글 지도에서 열기 ↗</a>
      ${src ? `<a class="info-link" href="${escapeHtml(src.url)}" target="_blank" rel="noopener">${src.label}에서 보기 ↗</a>` : ''}
    </div>
  </div>`;
}

function recCardHtml(p, i, recs) {
  const { kind } = recs;
  const src = ratingSource(p, kind);
  const score = ratingScores[p.id];
  const fit = { over: '<span class="rec-fit over">예산 초과</span>', tight: '<span class="rec-fit tight">빠듯해요</span>' }[p.fit] || '';
  const canPick = recs.anchor.slot != null && kind !== 'sights' && state.mapping.name >= 0;
  const open = recs.open === p.id;
  return `<li class="rec${recs.focus === p.id ? ' active' : ''}${open ? ' open' : ''}${p.planned ? ' planned' : ''}" data-rec="${escapeHtml(p.id)}" style="--c:${REC_COLORS[kind]}" aria-expanded="${open}">
    <span class="rec-num">${i + 1}</span>
    <div class="rec-main">
      <div class="rec-title"><b>${escapeHtml(p.name)}</b><span class="rec-type">${escapeHtml(typeLabel(p, kind))}</span>${fit}${p.planned ? '<span class="rec-fit planned">일정에 있음</span>' : ''}</div>
      <div class="rec-meta">${escapeHtml(recMeta(p, kind))}${src && score != null ? ` · <b>${src.label} ${escapeHtml(String(score))}</b>` : ''}</div>
      ${openText(p)}
      <div class="rec-actions">
        ${src ? `<a class="rec-link" href="${escapeHtml(src.url)}" target="_blank" rel="noopener">${src.label} ↗</a>
        <input class="rec-score" inputmode="decimal" data-rec-score="${escapeHtml(p.id)}" value="${score ?? ''}" placeholder="점수 적기" aria-label="${src.label} 점수" title="${src.label}에서 본 점수를 적으면 순위에 반영해요 (${escapeHtml(src.hint)})">` : ''}
        <a class="rec-link" href="${escapeHtml(googleUrl(p))}" target="_blank" rel="noopener">구글 지도 ↗</a>
        ${canPick ? `<button type="button" class="secondary-button rec-pick" data-rec-pick="${i}">이 가게로 정하기</button>` : ''}
      </div>
      ${open ? recDetailHtml(p, recs) : ''}
    </div>
    <span class="rec-chev" aria-hidden="true">⌄</span>
  </li>`;
}

function recsHtml(recs) {
  const { anchor, kind, keyword } = recs;
  const facts = [
    anchor.at?.label,
    recs.allowance?.over != null ? `이 끼니를 빼도 그날 예산을 ${formatMoney(recs.allowance.over, recs.allowance.currency)} 넘어요`
      : recs.allowance ? `이 끼니에 쓸 수 있는 돈 약 ${formatMoney(recs.allowance.amount, recs.allowance.currency)}` : '',
  ].filter(Boolean);
  const head = `<div class="recs-anchor"><span><b>${escapeHtml(anchor.name)}</b> 주변</span>`
    + `${anchor.slot != null ? `<span class="recs-slot">${escapeHtml(rowTitle(anchor.slot))}</span>` : ''}`
    + `${facts.length ? `<small>${facts.map(escapeHtml).join(' · ')}</small>` : ''}</div>`;
  const tabs = `<div class="pace-switch recs-tabs" role="group" aria-label="추천 종류">${Object.entries(KINDS).map(([key, k]) => (
    `<button type="button" data-rec-kind="${key}" aria-pressed="${kind === key}"${kind === key ? ' class="active"' : ''}>${k.label}</button>`
  )).join('')}</div>`;
  const chips = kind === 'sights' ? '' : ['', ...new Set([...(anchor.hints || []), keyword].filter(Boolean))].map((w) => (
    `<button type="button" class="chip${w === keyword ? ' active' : ''}" data-rec-keyword="${escapeHtml(w)}">${w ? escapeHtml(w) : '인기 있는 곳'}</button>`
  )).join('');
  const search = `<div class="recs-keywords">${chips}
    <form class="recs-keyword" data-rec-keyword-form><input name="keyword" placeholder="${kind === 'sights' ? '찾을 것 (예: 전망대)' : '음식 (예: 우동)'}" aria-label="찾을 말" spellcheck="false" autocomplete="off"><button type="submit" class="secondary-button">찾기</button></form>
  </div>`;
  let body;
  if (recs.loading) body = '<p class="recs-status">주변을 찾는 중…</p>';
  else if (recs.error) body = `<p class="alert">${escapeHtml(recs.error)}</p>`;
  else if (!recs.list?.length) body = `<p class="recs-status">걸어갈 만한 곳에서 ${keyword ? `“${escapeHtml(keyword)}”을(를) ` : ''}찾지 못했어요.</p>`;
  else {
    const shown = shownRecs(recs);
    const more = recs.list.length > shown.length ? `<button type="button" class="secondary-button" data-rec-more>${recs.list.length - shown.length}곳 더 보기</button>` : '';
    const source = recs.list.some((p) => ratingSource(p, kind)?.key === 'tabelog') ? '일본 가게는 타베로그 링크에서 점수를 보고 적어 두면 순위에 반영돼요(타베로그는 점수를 가져다 쓸 수 없어요).'
      : recs.list.some((p) => ratingSource(p, kind)?.key === 'kakao') ? '카카오맵 링크에서 평점을 보고 적어 두면 순위에 반영돼요(카카오는 평점을 API로 주지 않아요).' : '';
    body = `<p class="recs-status">구글 평점을 리뷰 수로 보정하고, 가깝고${recs.at ? ' 그 시각에 여는' : ''} 곳을 위로 올렸어요. 가게를 누르면 사진·리뷰·영업시간이 나와요. ${source}</p>
      <ol class="recs-list">${shown.map((p, i) => recCardHtml(p, i, recs)).join('')}</ol>${more}`;
  }
  return head + tabs + search + body;
}

let lastRecsHtml = '';
function renderRecs() {
  els.recsCard.classList.toggle('hidden', mapState !== 'ready');
  els.recsClose.classList.toggle('hidden', !state.recs);
  const html = state.recs ? recsHtml(state.recs)
    : '<p class="recs-empty">대표 장소를 적거나, 일정에서 장소를 눌러 <b>주변 맛집</b>·<b>주변 명소</b>를 고르세요. 빈 끼니는 아래 <b>하루 예산</b>에서 바로 찾을 수 있어요.</p>';
  if (html !== lastRecsHtml) {
    els.recsBody.innerHTML = html;
    lastRecsHtml = html;
  }
}

function setRecKind(kind) {
  const recs = state.recs;
  if (!recs || !KINDS[kind] || recs.kind === kind) return;
  recs.kind = kind;
  recs.keyword = kind === 'sights' ? '' : recs.anchor.hints?.[0] && recs.anchor.slot != null ? recs.anchor.hints[0] : '';
  if (recs.anchor.lat == null) {
    render(); // 대표 장소를 아직 찾는 중이면 찾은 뒤 이 종류로 찾는다
    return;
  }
  loadRecs();
}

function setRecKeyword(keyword) {
  const recs = state.recs;
  if (!recs || recs.keyword === keyword) return;
  recs.keyword = keyword;
  loadRecs();
}

// 직접 검색한 대표 장소. 일정에 같은 이름이 있으면 그 장소(시각 포함)를 쓴다
async function searchAnchor(query) {
  if (!query || mapState !== 'ready') return;
  const n = normalizeText(query);
  const item = state.items.find((it) => it.place && normalizeText(it.name) === n);
  if (item) {
    openRecs(itemAnchor(item), { kind: state.recs?.kind || 'food' });
    return;
  }
  const kind = state.recs?.kind || 'food';
  state.recs = { anchor: { name: query }, kind, keyword: '', loading: true, error: '', list: null };
  mapView?.clearRecs();
  render();
  try {
    const [top] = await searchPlaces(query, searchOptions(languageFor(query, CFG.language)));
    if (!top) {
      Object.assign(state.recs, { loading: false, error: `“${query}”을(를) 구글 지도에서 찾지 못했어요. 현지어 이름으로도 찾아보세요.` });
      render();
      return;
    }
    openRecs({ name: top.name || query, lat: top.lat, lng: top.lng, item: null, slot: null, at: null, hints: [] }, { kind });
  } catch (err) {
    Object.assign(state.recs, { loading: false, error: `대표 장소를 찾지 못했어요: ${err?.message || err}` });
    render();
  }
}

/* ── 빈 끼니에 맞는 가게 찾기 ── */

// "점심 (하카타 라멘·모츠나베)" → 음식 ['하카타 라멘', '모츠나베'] / "아침 (하카타역 주변)" → 장소 ['하카타역']
const NEAR_WORD = /\s*(주변|근처|부근|일대|쪽)\s*$/;
function slotHints(title) {
  const inner = [...String(title).matchAll(/[(（]([^)）]+)[)）]/g)].map((m) => m[1].trim());
  const split = (s) => s.replace(NEAR_WORD, '').split(/[·,/、]+/).map((w) => w.trim()).filter((w) => w.length >= 2);
  return {
    areas: inner.filter((s) => NEAR_WORD.test(s)).flatMap(split),
    foods: inner.filter((s) => !NEAR_WORD.test(s)).flatMap(split),
  };
}

// 그 끼니 때 있을 곳: 1) 괄호 속 장소 이름 2) 바로 앞 장소(그 사이에 이동했으면 다음 장소)
async function slotPlace(index, rows) {
  const row = rows[index];
  const placed = state.items.filter((it) => it.place);
  const near = (it) => ({ name: it.name, ...latLng(it.place), item: it });
  const { areas } = slotHints(row.title);
  for (const word of areas) {
    const n = normalizeText(word);
    const match = placed.filter((it) => {
      const name = normalizeText(it.name);
      return name.includes(n) || n.includes(name);
    }).sort((a, b) => (b.day === row.day) - (a.day === row.day) || Math.abs(a.recordIndex - index) - Math.abs(b.recordIndex - index))[0];
    if (match) return near(match);
  }
  if (areas.length) {
    const ref = placed.find((it) => it.day === row.day);
    const region = [ref && state.mapping.region >= 0 ? cellText(ref.cells[state.mapping.region]) : '', els.commonRegion.value.trim()].filter(Boolean).join(' ');
    const [top] = await searchPlaces(`${areas[0]} ${region}`.trim(), searchOptions(languageFor(areas[0], CFG.language))).catch(() => []);
    if (top) return { name: top.name || areas[0], lat: top.lat, lng: top.lng, item: null };
  }
  for (let i = index - 1; i >= 0 && rows[i].day === row.day; i--) {
    const it = placed.find((x) => x.recordIndex === i);
    if (it) return near(it);
    if (rows[i].travel) break; // 이미 다음 장소로 옮겨 갔다
  }
  const next = placed.find((it) => it.recordIndex > index && it.day === row.day);
  if (next) return near(next);
  const prev = [...placed].reverse().find((it) => it.recordIndex < index);
  return prev ? near(prev) : null;
}

async function openSlotRecs(index) {
  const rows = budgetRows();
  const row = rows[index];
  if (!row || mapState !== 'ready') return;
  const near = await slotPlace(index, rows);
  if (!near) {
    showToast('이 끼니 근처의 장소를 몰라요 · 대표 장소를 직접 적어 주세요');
    return;
  }
  const meal = mealOf(row.title, row.time);
  // 아침은 인기 있는 식당 대부분이 아직 닫혀 있으니, 음식을 적지 않았으면 '아침 식사'로 찾는다
  const foods = slotHints(row.title).foods;
  const hints = foods.length || meal !== 'breakfast' ? foods : ['아침 식사'];
  const at = atOf(dayCellOf(index), parseTimeRange(row.time).start);
  openRecs({ ...near, slot: index, at, meal, hints }, { kind: meal === 'cafe' ? 'cafe' : 'food', keyword: hints[0] || '' });
}

// 이 끼니에 쓸 수 있는 돈 = 하루 예산 − 이 끼니를 뺀 그날 지출
function slotAllowance(slot) {
  if (slot == null || !state.budget.amount) return null;
  const day = budgetDays.find((d) => d.lines.some((l) => l.index === slot));
  if (!day) return null;
  const limit = convert(state.budget.amount, state.budget.currency, day.currency);
  if (limit == null) return null;
  const line = day.lines.find((l) => l.index === slot);
  const amount = limit - (day.total - (line.value ?? 0));
  // 이 끼니를 빼고도 이미 예산을 넘었으면 가게마다 '예산 초과'를 붙여 봐야 쓸모가 없다
  return amount > 0 ? { amount: Math.round(amount), currency: day.currency } : { amount: 0, over: Math.round(-amount), currency: day.currency };
}

// 고른 가게를 빈 끼니 행에 넣는다: 장소(·주소·위도·경도) 칸을 채우고 메모에 가격대를 적어, 엑셀로 저장할 수 있게 한다
function pickRec(i) {
  const recs = state.recs;
  const p = recs?.list?.[i];
  const index = recs?.anchor.slot;
  const m = state.mapping;
  if (!p || index == null || m.name < 0) return;
  const round7 = (v) => Math.round(v * 1e7) / 1e7;
  const changes = [{ index, col: m.name, text: p.name }];
  if (m.address >= 0 && p.address) changes.push({ index, col: m.address, text: p.address });
  if (m.lat >= 0 && m.lng >= 0) changes.push({ index, col: m.lat, number: round7(p.lat) }, { index, col: m.lng, number: round7(p.lng) });
  const src = ratingSource(p, recs.kind);
  const score = ratingScores[p.id];
  const note = [p.cost?.from === 'range' ? `가격대 ${priceText(p)}` : '', src && score != null ? `${src.label} ${score}` : ''].filter(Boolean).join(' · ');
  if (m.memo >= 0 && note) {
    const memo = cellText(state.records[index].cells[m.memo]);
    changes.push({ index, col: m.memo, text: memo ? `${memo} · ${note}` : note });
  }
  if (p.cost) state.picks.set(index, { ...p.cost, note: `고른 가게 · ${priceText(p)}` });
  applyCellEdits(changes);
  addPickedItem(index, p);
  const title = rowTitle(index);
  closeRecs();
  showToast(`${title} → ${p.name} · 엑셀 저장은 일정 점검에서`);
}

// 채운 행을 장소 목록에 끼운다. 다른 장소의 검색 결과·찾은 경로는 그대로 둔다
function addPickedItem(index, p) {
  const fresh = buildItems().items.find((it) => it.recordIndex === index);
  if (!fresh) return;
  Object.assign(fresh, {
    status: 'confirmed', note: '주변 추천에서 고른 곳', candidates: [],
    place: { id: p.id, name: p.name, address: p.address, url: p.url, lat: p.lat, lng: p.lng },
  });
  const selected = state.items[state.selected];
  const at = state.items.findIndex((it) => it.recordIndex > index);
  state.items.splice(at < 0 ? state.items.length : at, 0, fresh);
  if (!state.colors.has(fresh.category)) state.colors.set(fresh.category, PALETTE[state.colors.size % PALETTE.length]);
  renumberItems(selected);
}

// 장소가 끼거나 빠지면 번호(idx)를 엑셀 순서대로 다시 매긴다. 구간 키·핀·목록도 새 번호로
function renumberItems(selected) {
  const legs = state.legs.map((leg) => [leg, state.legModes.get(leg.key), state.selectedLeg === leg.key]);
  state.items.forEach((it, i) => { it.idx = i; });
  state.legModes.clear();
  state.selectedLeg = null;
  state.legs = [];
  for (const [leg, mode, wasSelected] of legs) {
    if (!state.items.includes(leg.from) || !state.items.includes(leg.to)) continue;
    leg.key = `${leg.from.idx}>${leg.to.idx}`;
    if (mode) state.legModes.set(leg.key, mode);
    if (wasSelected) state.selectedLeg = leg.key;
    state.legs.push(leg);
  }
  state.selected = selected && state.items.includes(selected) ? selected.idx : null;
  if (state.recs?.anchor.item && !state.items.includes(state.recs.anchor.item)) state.recs.anchor.item = null;
  rendered.clear();
  els.resultList.innerHTML = '';
  if (mapView) {
    mapView.clear();
    state.items.forEach((it) => { if (it.place) placeMarker(it); });
    mapView.highlight(state.selected);
  }
  refreshLegs();
  render();
}

/* ───────────── 하루 예산 ───────────── */

const FX_TTL = 12 * 60 * 60 * 1000;
const fxRates = loadJson(FX_STORAGE, {});
const fxTried = new Set();
let budgetDays = []; // 마지막으로 셈한 날짜별 지출 (추천의 '쓸 수 있는 돈'에도 쓴다)

// 환율: 같은 통화면 그대로, 아니면 바로 가는 환율이나 예산 통화를 거쳐서
function convert(amount, from, to) {
  if (amount == null || !from || !to) return null;
  if (from === to) return amount;
  const direct = fxRates[`${from}>${to}`];
  if (direct) return amount * direct.rate;
  const pivot = state.budget.currency;
  const a = fxRates[`${from}>${pivot}`];
  const b = fxRates[`${pivot}>${to}`];
  return a && b ? amount * a.rate * b.rate : null;
}

// 무료 환율 API(frankfurter.dev, 유럽중앙은행 기준). 같은 조합은 12시간 동안 다시 묻지 않는다
async function ensureRates(currencies, base) {
  const fresh = (c) => fxRates[`${c}>${base}`] && Date.now() - fxRates[`${c}>${base}`].t < FX_TTL;
  const need = [...new Set(currencies)].filter((c) => c && c !== base && CURRENCIES[c] && !fresh(c)).sort();
  const key = `${base}:${need.join(',')}`;
  if (!need.length || fxTried.has(key)) return;
  fxTried.add(key);
  try {
    const res = await fetch(`https://api.frankfurter.dev/v2/rates?base=${base}&quotes=${need.join(',')}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for (const { quote, rate, date } of await res.json()) {
      if (!(rate > 0)) continue;
      fxRates[`${base}>${quote}`] = { rate, date, t: Date.now() };
      fxRates[`${quote}>${base}`] = { rate: 1 / rate, date, t: Date.now() };
    }
    storage.set(FX_STORAGE, JSON.stringify(fxRates));
  } catch (err) {
    console.warn('환율을 가져오지 못했습니다:', err);
  }
  rankRecs();
  render();
}

const overrideKey = () => `${state.fileName}|${state.sheetName}`;

function loadOverrides() {
  const saved = loadJson(OVERRIDE_STORAGE, {})[overrideKey()] || {};
  const byRow = new Map(state.records.map((r, i) => [String(r.rowNumber), i]));
  return new Map(Object.entries(saved).filter(([row]) => byRow.has(row)).map(([row, amount]) => [byRow.get(row), amount]));
}

function setOverride(index, value, original) {
  state.editAmount = null;
  if (String(value).trim() === String(original ?? '').trim()) {
    render(); // 고치지 않고 나갔다
    return;
  }
  const amount = parseFloat(String(value).replace(/[^\d.]/g, ''));
  if (Number.isFinite(amount)) state.overrides.set(index, amount);
  else state.overrides.delete(index);
  const all = loadJson(OVERRIDE_STORAGE, {});
  all[overrideKey()] = Object.fromEntries([...state.overrides].map(([i, a]) => [state.records[i].rowNumber, a]));
  storage.set(OVERRIDE_STORAGE, JSON.stringify(all));
  rankRecs();
  render();
}

function saveBudget() {
  const amount = parseFloat(els.budgetAmount.value.replace(/[^\d.]/g, ''));
  state.budget = {
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: els.budgetCurrency.value || 'KRW',
    trip: els.tripCurrency.value,
  };
  storage.set(BUDGET_STORAGE, JSON.stringify(state.budget));
  rankRecs();
  render();
}

// 날짜 열이 비어 있으면 위의 날짜를 이어 쓴다 (buildItems와 같은 규칙)
function budgetRows() {
  const m = state.mapping;
  const get = (cells, i) => (i >= 0 ? cellText(cells[i]) : '');
  let lastDate = null;
  return state.records.map((rec, index) => {
    if (m.date >= 0 && rec.cells[m.date]) lastDate = rec.cells[m.date];
    const place = get(rec.cells, m.name) || get(rec.cells, m.address);
    const mode = get(rec.cells, m.mode);
    return {
      index,
      day: m.date >= 0 && lastDate ? cellText(lastDate) : '',
      dateCell: m.date >= 0 ? lastDate : null,
      title: rowTitle(index),
      memo: get(rec.cells, m.memo),
      mode,
      place,
      time: get(rec.cells, m.time),
      travel: !!mode && !place,
      fixed: hasTag(rec),
    };
  });
}

function dayCellOf(index) {
  const m = state.mapping;
  if (m.date < 0) return null;
  for (let i = index; i >= 0; i--) if (state.records[i].cells[m.date]) return state.records[i].cells[m.date];
  return null;
}

// 그날 장소들의 나라로 현지 통화를 짐작한다 (메모에 금액이 있으면 그 통화가 먼저)
function dayCurrency(day) {
  const country = (list) => mostCommon(list.filter((it) => it.place).map((it) => countryAt(it.place)));
  return COUNTRY_CURRENCY[country(state.items.filter((it) => it.day === day))] || COUNTRY_CURRENCY[country(state.items)] || '';
}

const PAID = (cls) => cls && !['walk', 'free', 'flight'].includes(cls);

// 이동 행이 그 구간의 유일한 유료 이동이면 구간 거리·구글 요금을 그 행에 쓴다
function soleLeg(index) {
  const leg = state.legs.find((l) => l.plan?.travel.includes(index));
  if (!leg) return null;
  const paid = leg.plan.travel.filter((i) => PAID(fareClass(cellText(state.records[i].cells[state.mapping.mode]))));
  return paid.length === 1 && paid[0] === index ? leg : null;
}
const legKm = (index) => {
  const leg = soleLeg(index);
  return leg ? (leg.route?.distance || leg.dist * 1.2) / 1000 : null;
};
const googleFare = (index) => soleLeg(index)?.route?.fare || null;

const SOURCE_LABELS = {
  memo: '메모', manual: '직접 고침', google: '구글 요금', pick: '고른 가게', estimate: '어림', pass: '1일권', free: '무료', unknown: '미정',
};
const KIND_LABELS = { food: '식비', transport: '교통', locker: '코인로커', ticket: '입장·기타', lodging: '숙박', flight: '항공' };

function dayLabelOf(cell, day) {
  const d = parseDay(cell);
  return d ? `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})` : day || '날짜 없음';
}

function budgetLineHtml(line, row) {
  const start = parseTimeRange(row.time).start;
  const editing = state.editAmount === line.index;
  const money = line.amount == null ? '미정' : line.min != null && line.max != null && line.min !== line.max && line.source !== 'manual'
    ? `${formatMoney(line.min, line.currency).replace(/[^\d,.]+$/, '')}–${formatMoney(line.max, line.currency)}`
    : formatMoney(line.amount, line.currency);
  const amount = editing
    ? `<input class="bl-input" data-amount-input="${line.index}" data-original="${line.amount ?? ''}" inputmode="decimal" value="${line.amount ?? ''}" aria-label="금액">`
    : `<button type="button" class="bl-amount" data-amount="${line.index}" title="눌러서 금액 고치기"${line.excluded ? ' disabled' : ''}>${escapeHtml(money)}</button>`;
  const what = [SOURCE_LABELS[line.source], line.note && line.note !== SOURCE_LABELS[line.source] ? line.note : ''].filter(Boolean).join(' · ');
  return `<li class="budget-line src-${line.source}${line.excluded ? ' excluded' : ''}">
    <span class="bl-time">${start != null ? hm(start) : ''}</span>
    <span class="bl-title"><span class="bl-kind">${KIND_LABELS[line.kind] || ''}</span>${escapeHtml(row.title)}<small>${escapeHtml(what)}</small></span>
    ${amount}
    ${line.slot && mapState === 'ready' ? `<button type="button" class="secondary-button small" data-slot-recs="${line.index}">${line.meal === 'cafe' ? '카페 추천' : '맛집 추천'}</button>` : ''}
  </li>`;
}

let lastBudgetHtml = '';
function renderBudget() {
  const show = state.items.length > 0 && !state.running;
  els.budgetCard.classList.toggle('hidden', !show);
  if (!show) {
    budgetDays = [];
    return;
  }
  const rows = budgetRows();
  const base = state.budget.currency;
  budgetDays = dayCosts(rows, {
    currencyOf: dayCurrency, fixedCurrency: state.budget.trip, legKm, googleFare, picks: state.picks, overrides: state.overrides, convert,
  });
  ensureRates(budgetDays.flatMap((d) => [d.currency, ...d.lines.map((l) => l.currency)]), base);

  // 예산 칸: 다른 칸을 고치는 동안 지워지지 않도록 바뀐 경우에만 채운다
  const currencies = [...new Set(['KRW', 'JPY', 'USD', 'EUR', base, ...budgetDays.map((d) => d.currency)].filter((c) => CURRENCIES[c]))];
  const options = currencies.map((c) => `<option value="${c}">${CURRENCIES[c].label}</option>`).join('');
  if (els.budgetCurrency.innerHTML !== options) els.budgetCurrency.innerHTML = options;
  els.budgetCurrency.value = base;
  const tripOptions = `<option value="">자동</option>${Object.entries(CURRENCIES).map(([c, v]) => `<option value="${c}">${v.label}</option>`).join('')}`;
  if (els.tripCurrency.innerHTML !== tripOptions) els.tripCurrency.innerHTML = tripOptions;
  els.tripCurrency.value = state.budget.trip || '';
  if (document.activeElement !== els.budgetAmount) els.budgetAmount.value = state.budget.amount ?? '';

  const foreign = [...new Set(budgetDays.map((d) => d.currency))].filter((c) => c && c !== base);
  els.budgetFx.innerHTML = foreign.map((c) => {
    const r = fxRates[`${c}>${base}`];
    return r ? `1${escapeHtml(CURRENCIES[c]?.label || c)} = ${escapeHtml(formatMoney(r.rate, base, r.rate < 100 ? 2 : 0))} <small>${escapeHtml(r.date || '')} 기준 · 유럽중앙은행</small>`
      : `${escapeHtml(CURRENCIES[c]?.label || c)} 환율을 가져오지 못했어요 <small>예산을 현지 통화로 적으면 그대로 견줘요</small>`;
  }).join(' · ');
  els.budgetFx.classList.toggle('hidden', !foreign.length);

  const totals = budgetDays.map((d) => convert(d.total, d.currency, base) ?? 0);
  const limit = state.budget.amount;
  const scale = Math.max(limit || 0, ...totals) || 1;
  const html = budgetDays.map((d, i) => {
    const open = state.budgetOpen === d.day || (state.day != null && dayOfCategory(state.day) === d.day);
    const local = limit != null ? convert(limit, base, d.currency) : null;
    const left = local != null ? local - d.total : null;
    const fixedPct = ((convert(d.fixed, d.currency, base) ?? 0) / scale) * 100;
    const estPct = ((convert(d.estimated, d.currency, base) ?? 0) / scale) * 100;
    const inBase = d.currency && d.currency !== base && convert(d.total, d.currency, base) != null ? ` <small>약 ${formatMoney(Math.round(convert(d.total, d.currency, base) / 100) * 100, base)}</small>` : '';
    const status = left == null ? '' : left >= 0 ? `<span class="budget-left ok">남음 ${formatMoney(Math.round(left), d.currency)}</span>`
      : `<span class="budget-left over">${formatMoney(Math.round(-left), d.currency)} 넘음</span>`;
    const label = dayLabelOf(rows.find((r) => r.day === d.day)?.dateCell, d.day);
    const color = state.colors.get(state.items.find((it) => it.day === d.day)?.category) || PALETTE[i % PALETTE.length];
    const lines = open ? `<ul class="budget-lines">${d.lines.map((l) => budgetLineHtml(l, rows[l.index])).join('')}</ul>
      <p class="budget-note">${[
        Object.entries(KIND_LABELS).map(([k, name]) => {
          const v = d.lines.filter((l) => l.kind === k && !l.excluded && l.value != null).reduce((n, l) => n + l.value, 0);
          return v ? `${name} ${formatMoney(Math.round(v), d.currency)}` : '';
        }).filter(Boolean).join(' · '),
        d.excluded.length ? `${d.excluded.map((l) => KIND_LABELS[l.kind]).filter((v, j, a) => a.indexOf(v) === j).join('·')}은 뺐어요` : '',
        '입장료는 메모에 적은 것만 더해요',
      ].filter(Boolean).map(escapeHtml).join(' · ')}</p>` : '';
    return `<div class="budget-day${open ? ' open' : ''}" style="--c:${color}">
      <button type="button" class="budget-day-head" data-budget-day="${escapeHtml(d.day)}" aria-expanded="${open}">
        <span class="budget-day-name">${escapeHtml(label)}</span>
        <span class="budget-bar" aria-hidden="true"><i class="fixed" style="width:${fixedPct.toFixed(1)}%"></i><i class="est" style="width:${estPct.toFixed(1)}%"></i>${limit ? `<b style="left:${Math.min(100, (limit / scale) * 100).toFixed(1)}%"></b>` : ''}</span>
        <span class="budget-day-sum"><strong>${d.currency ? formatMoney(Math.round(d.total), d.currency) : '통화 모름'}</strong>${local != null ? ` / ${formatMoney(Math.round(local), d.currency)}` : ''}${inBase}</span>
        <span class="budget-day-meta">${status}${d.unknown ? `<span class="budget-unknown">미정 ${d.unknown}건</span>` : ''}</span>
      </button>
      ${lines}
    </div>`;
  }).join('');
  const legend = '<div class="budget-legend"><span><i class="fixed"></i>메모·확정</span><span><i class="est"></i>어림</span>'
    + `${limit ? '<span><i class="limit"></i>하루 예산</span>' : '<span class="muted">하루 예산을 적으면 남은 돈을 알려 줘요</span>'}</div>`;
  const all = legend + html;
  if (all !== lastBudgetHtml) {
    els.budgetDays.innerHTML = all;
    lastBudgetHtml = all;
    els.budgetDays.querySelector('[data-amount-input]')?.focus();
  }
}

// 날짜 탭의 분류 값 → 예산의 날짜 (분류 열이 날짜 열과 같을 때만 이어진다)
function dayOfCategory(category) {
  return state.items.find((it) => it.category === category)?.day ?? null;
}

/* ───────────── 결과 목록 ───────────── */

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  rideRisks = state.items.length ? boardingRisks(state.records, timeCols(), PACES[state.pace]) : [];
  const { done, total } = state.progress;
  els.progressBar.style.width = total ? `${(done / total) * 100}%` : '100%';
  const placed = state.items.filter((it) => it.place).length;
  els.progressText.textContent = state.running
    ? `장소 검색 중… ${done} / ${total}`
    : `${state.items.length}곳 중 ${placed}곳을 지도에 표시했습니다.`;
  els.runAlert.textContent = state.alert;
  els.runAlert.classList.toggle('hidden', !state.alert);
  els.exportXlsx.disabled = state.running || !state.items.length;
  els.exportKml.disabled = state.running || !placed;
  els.navCount.textContent = state.items.length ? String(placed).padStart(2, '0') : '';
  els.planSummary.textContent = planSummaryText();
  if (state.items.length) renderTrip(state.items);
  renderBudget();
  renderRecs();
  renderPlanCheck();
  renderChips();
  renderDayTabs();
  renderRouteCard();
  renderMapMeta();
  renderList();
  renderPlacePanel();
  renderWorkspaceChrome();
}

function renderPlacePanel() {
  const it = state.selected == null ? null : state.items[state.selected];
  els.placePanel.classList.toggle('hidden', !it);
  document.body.classList.toggle('place-open', !!it);
  if (!it) return;
  const place = it.place;
  const detail = recDetails.get(place?.id);
  const data = detail?.data;
  const photos = data?.photos || [];
  const hero = photos[0];
  const photoHtml = (photo) => `<figure><img src="${escapeHtml(photo.url)}" alt="${escapeHtml(it.name)} 사진"><figcaption>${photo.authors.map(a => escapeHtml(a.name)).join(' · ')}</figcaption></figure>`;
  const html = `<div class="place-hero">${hero ? photoHtml(hero) : `<div class="place-no-photo"><span>⌖</span><small>${detail?.loading ? '장소 사진을 불러오는 중' : '사진 정보가 없습니다'}</small></div>`}</div>
    <div class="place-content item" data-idx="${it.idx}">
    <div class="place-panel-kicker">${escapeHtml(it.category || '전체 일정')} · ${Number(it.idx) + 1}번째 장소</div>
    <h2>${escapeHtml(place?.name || it.name)}</h2>
    <p class="place-address">⌖ ${escapeHtml(place?.address || it.query)}</p>
    <p class="place-hours">◷ ${escapeHtml(it.timeText || '일정 시간 미정')}</p>
    ${data?.rating != null ? `<p class="place-rating">★ ${data.rating} <small>(${Number(data.ratingCount || 0).toLocaleString()}개 평가)</small></p>` : ''}
    ${data?.hours?.length ? `<details class="place-hours"><summary>영업시간 보기</summary>${data.hours.map(h => `<div>${escapeHtml(h)}</div>`).join('')}</details>` : ''}
    <div class="place-link-row"><span class="badge">${escapeHtml(STATUS[it.status].label)}</span>${place ? `<a href="${escapeHtml(placeUrl(place))}" target="_blank" rel="noopener">구글 지도에서 보기 ↗</a>` : ''}</div>
    <div class="place-section-heading">장소 정보</div>
    <p class="place-description">${escapeHtml(data?.about || it.memo || '선택한 장소의 검색 결과를 확인하고 일정을 수정하세요.')}</p>
    ${photos.length > 1 ? `<div class="place-gallery">${photos.slice(1).map(photoHtml).join('')}</div>` : ''}
    ${detail?.error ? `<p class="note">${escapeHtml(detail.error)}</p>` : ''}
    ${data?.features?.length ? `<p class="place-features">${data.features.map(escapeHtml).join(' · ')}</p>` : ''}
    <div class="place-section-heading">장소 수정 · 주변 추천</div>
    ${renderDetail(it)}
    </div>`;
  if (els.placePanelBody.dataset.content !== html) {
    els.placePanelBody.innerHTML = html;
    els.placePanelBody.dataset.content = html;
  }
}

// 분류 열이 날짜 열과 같으면 '날짜별' 화면(요일 탭, 날짜 구분선)으로 보여 준다
const byDate = () => state.mapping.category >= 0 && state.mapping.category === state.mapping.date;
const WEEKDAYS = '일월화수목금토';

function dayInfo(category) {
  if (byDate()) {
    const d = parseDay(state.items.find((it) => it.category === category)?.dateCell);
    if (d) {
      const w = WEEKDAYS[d.getDay()];
      return { top: w, main: String(d.getDate()), text: false, label: `${d.getMonth() + 1}/${d.getDate()} (${w})` };
    }
  }
  return { top: '', main: category || '분류 없음', text: true, label: category || '분류 없음' };
}

function travelOf(legs) {
  return legs.reduce((sum, l) => sum + legMillis(l), 0);
}

function planSummaryText() {
  if (!state.items.length) return '';
  const cats = [...state.colors.keys()].filter(Boolean);
  const shown = state.items.filter((it) => catVisible(it.category) && it.place).length;
  if (state.day != null) return `${dayInfo(state.day).label} · ${shown}곳`;
  return `${shown}곳${byDate() && cats.length ? ` · ${cats.length}일 일정` : ''}`;
}

let lastTabsHtml = '';
function renderDayTabs() {
  const cats = [...state.colors.keys()];
  if (cats.length < 2) {
    els.dayTabs.classList.add('hidden');
    lastTabsHtml = '';
    return;
  }
  const tab = (key, info, color) => `<button type="button" class="day-tab${info.text ? ' day-tab--text' : ''}${state.day === key ? ' active' : ''}"`
    + `${key == null ? ' data-all' : ` data-day="${escapeHtml(key)}"`} role="tab" aria-selected="${state.day === key}" title="${escapeHtml(info.label)}"`
    + `${color ? ` style="--c:${color}"` : ''}>${info.text ? '' : `<span>${info.top}</span>`}<strong>${escapeHtml(info.main)}</strong><i></i></button>`;
  const all = { top: '전체', main: byDate() ? `${cats.length}일` : 'ALL', text: false, label: '전체 일정' };
  const legs = shownLegs();
  const travel = travelOf(legs);
  const count = state.items.filter((it) => catVisible(it.category) && it.place).length;
  const label = `<div class="day-label"><strong>${count}곳</strong>${travel ? ` · 이동 ${formatDuration(travel)}` : ''}</div>`;
  const html = tab(null, all, '') + cats.map((c, i) => tab(c, { ...dayInfo(c), top: `Day ${i + 1}`, main: dayInfo(c).label, text: false }, state.colors.get(c))).join('') + label;
  els.dayTabs.classList.remove('hidden');
  // 탭을 누르는 도중 다시 그려 클릭이 사라지지 않도록, 바뀐 경우에만 다시 그린다
  if (html !== lastTabsHtml) {
    els.dayTabs.innerHTML = html;
    lastTabsHtml = html;
  }
}

function setDay(day) {
  state.day = day;
  for (const it of state.items) mapView?.setVisible(it.idx, catVisible(it.category));
  for (const leg of state.legs) mapView?.setLegVisible(leg.key, legVisible(leg));
  if (state.selected != null && !catVisible(state.items[state.selected]?.category)) select(null);
  const leg = state.legs.find((l) => l.key === state.selectedLeg);
  if (leg && !legVisible(leg)) selectLeg(leg.key, 'list');
  mapView?.fitAll();
  render();
}

function renderMapMeta() {
  els.mapScope.textContent = state.day == null ? '전체 일정' : `${dayInfo(state.day).label} 일정`;
  const legs = shownLegs();
  const travel = travelOf(legs);
  const placed = state.items.filter((it) => it.place && catVisible(it.category)).length;
  els.mapNote.textContent = !state.items.length ? ''
    : travel ? `${legs.length}구간 · 이동 ${formatDuration(travel)}` : `장소 ${placed}곳`;
}

function renderChips() {
  // 문제가 있을 때만 상태 필터를 보여 준다
  const issues = state.items.some((it) => !groupOf('ok').match(it));
  if (!issues && state.filter === 'all') {
    els.statusChips.innerHTML = '';
    return;
  }
  els.statusChips.innerHTML = GROUPS.map((g) => {
    const n = state.items.filter(g.match).length;
    if (!n && g.key !== 'all' && g.key !== state.filter) return '';
    return `<button type="button" class="chip chip-${g.key}${state.filter === g.key ? ' active' : ''}" data-filter="${g.key}">${g.label} <b>${n}</b></button>`;
  }).join('');
}

function itemSubline(it) {
  if (it.status === 'searching') return `“${it.query}” 검색 중…`;
  if (it.status === 'error') return it.note;
  if (it.place) {
    const p = it.place;
    return [p.name && p.name !== it.name ? p.name : '', p.address].filter(Boolean).join(' · ') || '좌표로 표시';
  }
  return `검색어: ${it.query}`;
}

const placeNumber = (it) => String(it.idx + 1).padStart(2, '0');

function renderItem(it) {
  const st = STATUS[it.status];
  const selected = state.selected === it.idx;
  const start = parseTimeRange(it.timeText).start;
  const time = start != null ? `${pad2(Math.floor(start / 60))}:${pad2(start % 60)}` : '';
  return `<li class="item${selected ? ' selected' : ''}" data-idx="${it.idx}">
    <div class="tl-row">
      <span class="timeline-time">${time}</span>
      <span class="timeline-rail"><span class="num timeline-node" style="--c:${colorOf(it)}">${placeNumber(it)}</span></span>
      <span class="timeline-copy">
        <strong class="item-name">${escapeHtml(it.name)}</strong>
        <span class="item-meta"><span class="badge ${st.cls}">${st.label}</span><span class="item-sub">${escapeHtml(itemSubline(it))}</span></span>
      </span>
      <span class="timeline-thumb" aria-hidden="true">${recDetails.get(it.place?.id)?.data?.photos?.[0]?.url ? `<img src="${escapeHtml(recDetails.get(it.place.id).data.photos[0].url)}" alt="">` : '⌖'}</span>
    </div>

  </li>`;
}

function renderDivider(category) {
  const info = dayInfo(category);
  const count = state.items.filter((it) => it.category === category).length;
  const travel = travelOf(state.legs.filter((l) => l.from.category === category));
  return `<li class="day-divider" style="--c:${colorOf({ category })}"><i></i>${escapeHtml(info.label)}`
    + ` <small>${count}곳${travel ? ` · 이동 ${formatDuration(travel)}` : ''}</small></li>`;
}

function samePlace(a, b) {
  if (!a || !b) return false;
  return a.id ? a.id === b.id : a.lat === b.lat && a.lng === b.lng;
}

function renderDetail(it) {
  // 후보가 하나뿐이고 이미 그곳에 핀이 있으면 고를 것이 없으므로 숨긴다
  const showCandidates = it.candidates.length > 1
    || (it.candidates.length === 1 && !samePlace(it.place, it.candidates[0]));
  const candidates = showCandidates
    ? `<div class="cands">
        <div class="cands-label">검색 결과 ${it.candidates.length}곳 — 맞는 곳을 누르세요</div>
        ${it.candidates.map((c, i) => `
          <button type="button" class="cand${samePlace(it.place, c) ? ' active' : ''}" data-action="candidate" data-ci="${i}">
            <b>${escapeHtml(c.name)}</b><span>${escapeHtml(c.address)}</span>
          </button>`).join('')}
      </div>`
    : '';
  return `<div class="detail">
    ${it.note && it.status !== 'error' ? `<p class="note">${escapeHtml(it.note)}</p>` : ''}
    ${candidates}
    <div class="research">
      <input class="query" value="${escapeHtml(it.query)}" aria-label="검색어" spellcheck="false">
      <button type="button" class="secondary-button" data-action="research">다시 검색</button>
    </div>
    <div class="detail-actions">
      ${it.status === 'check' ? '<button type="button" class="secondary-button" data-action="confirm">이 위치가 맞아요</button>' : ''}
      <button type="button" class="secondary-button" data-action="pick">지도에서 직접 찍기</button>
      ${it.place ? `<a class="secondary-button" href="${escapeHtml(placeUrl(it.place))}" target="_blank" rel="noopener">구글 지도 ↗</a>` : ''}
    </div>
    ${it.place && mapState === 'ready' ? `<div class="detail-actions recs-actions">
      <button type="button" class="secondary-button" data-action="recs" data-kind="food">주변 맛집</button>
      <button type="button" class="secondary-button" data-action="recs" data-kind="cafe">카페</button>
      <button type="button" class="secondary-button" data-action="recs" data-kind="sights">주변 명소</button>
    </div>` : ''}
    <p class="meta">엑셀 ${it.rowNumber}행${it.place ? ' · 핀을 끌어서 위치를 고칠 수도 있어요' : ''}</p>
  </div>`;
}

// 바뀐 항목만 다시 그린다 — 검색이 진행되는 동안에도 입력 중인 검색어가 지워지지 않도록
const rendered = new Map(); // 'i3'(장소) · 'l3>4'(구간) · 'd0'(날짜 구분선) → { html, el }

function htmlToElement(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function renderList() {
  const list = els.resultList;
  const group = groupOf(state.filter);
  // 선택한 항목은 상태가 바뀌어 필터에서 벗어나도 계속 보여 준다 (예: '확인 필요'에서 후보를 고른 직후)
  const visible = state.items.filter((it) => (
    (group.match(it) || it.idx === state.selected) && catVisible(it.category) && (!document.getElementById('workspaceSearch').value.trim() || `${it.name} ${it.query} ${it.place?.address || ''}`.toLowerCase().includes(document.getElementById('workspaceSearch').value.trim().toLowerCase()))
  ));
  if (!visible.length) {
    list.innerHTML = `<li class="empty">${state.items.length ? '해당하는 곳이 없습니다' : '표시할 행이 없습니다'}</li>`;
    rendered.clear();
    return;
  }
  const whole = state.filter === 'all';
  // 동선을 켜면 각 장소 앞에 그곳으로 오는 구간을 끼워 넣는다 (필터 없이 볼 때만)
  const legTo = new Map(state.showRoutes && whole ? state.legs.filter(legVisible).map((l) => [l.to.idx, l]) : []);
  const dividers = whole && state.day == null && byDate();
  const rows = [];
  let lastCategory;
  let dividerCount = 0;
  for (const it of visible) {
    if (dividers && it.category !== lastCategory) {
      rows.push([`d${dividerCount++}`, renderDivider(it.category)]);
      lastCategory = it.category;
    }
    const leg = legTo.get(it.idx);
    if (leg) rows.push([`l${leg.key}`, renderLeg(leg)]);
    rows.push([`i${it.idx}`, renderItem(it)]);
  }
  const nodes = rows.map(([key, html]) => {
    const prev = rendered.get(key);
    if (prev && prev.html === html) return prev.el;
    const el = htmlToElement(html);
    if (prev?.el.isConnected) prev.el.replaceWith(el);
    rendered.set(key, { html, el });
    return el;
  });
  const keep = new Set(nodes);
  for (const child of [...list.children]) if (!keep.has(child)) child.remove();
  nodes.forEach((node, i) => {
    if (list.children[i] !== node) list.insertBefore(node, list.children[i] || null);
  });
}

/* ───────────── 내보내기 ───────────── */

function exportXlsx() {
  const wb = buildResultWorkbook({
    headers: state.headers,
    mapping: state.mapping,
    items: state.items,
    sheetName: state.sheetName,
    nextLegText: (it) => {
      const leg = state.legs.find((l) => l.from === it);
      return leg ? legSummaryText(leg) : '';
    },
  });
  XLSX.writeFile(wb, `${state.fileBase || '지도'}_좌표.xlsx`);
  showToast('좌표가 담긴 엑셀을 저장했어요');
}

function exportKml() {
  const items = state.items.filter((it) => it.place);
  const kml = buildKml({
    title: state.fileBase || '내 지도',
    items,
    colorOf: (category) => state.colors.get(category) || PALETTE[0],
    fieldsOf: (it) => {
      const fields = extraFields(it, { includeMapped: true });
      if (it.place.address) fields.push([RESULT_COLUMNS.address, it.place.address]);
      fields.push([RESULT_COLUMNS.url, placeUrl(it.place)]);
      return fields;
    },
    // 동선을 켜 두었으면 구간 선도 함께 (경로를 찾은 구간은 실제 길, 아니면 직선)
    lines: state.showRoutes ? state.legs.map((l) => ({
      category: l.from.category,
      name: `${l.from.name} → ${l.to.name}`,
      description: legSummaryText(l),
      path: l.route
        ? l.route.segments.flatMap((s) => s.path)
        : [[l.from.place.lat, l.from.place.lng], [l.to.place.lat, l.to.place.lng]],
    })) : [],
  });
  downloadBlob(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), `${state.fileBase || '지도'}.kml`);
  showToast('KML을 저장했어요 · 구글 내 지도에서 가져오기 하세요');
}

/* ───────────── 이벤트 연결 ───────────── */

// data-open="대화상자 id"가 붙은 버튼은 설정·도움말 창을 연다 (지도 안내 카드처럼 나중에 그려지는 버튼 포함)
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-open]');
  if (!opener) return;
  const dialog = document.getElementById(opener.dataset.open);
  if (!dialog?.showModal || dialog.open) return;
  dialog.showModal();
  if (dialog === els.settingsDialog && !CFG.googleMapsApiKey) els.apiKeyInput.focus();
});
// 창 바깥(어두운 배경)을 누르면 닫는다
for (const dialog of [els.settingsDialog, els.helpDialog]) {
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}
els.helpTemplate.addEventListener('click', () => downloadTemplate());

document.querySelectorAll('.primary-nav a.nav-item').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n === link));
  });
});

els.columnsToggle.addEventListener('click', () => {
  setColumnsOpen(els.columnsToggle.getAttribute('aria-expanded') !== 'true');
});

els.mapMode.addEventListener('click', (e) => {
  const button = e.target.closest('[data-type]');
  if (!button || !mapView) return;
  els.mapMode.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === button));
  mapView.setMapType(button.dataset.type);
});

els.fitMap.addEventListener('click', () => mapView?.fitAll());
els.placePanelClose.addEventListener('click', () => select(null, 'panel'));
els.placePanelBody.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.matches('.query') && state.selected != null) research(state.items[state.selected], event.target.value.trim());
});

els.dayTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.day-tab');
  if (!tab) return;
  setDay(tab.hasAttribute('data-all') ? null : tab.dataset.day);
});

els.keyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const key = els.apiKeyInput.value.trim();
  if (!key) {
    // 빈 칸으로 저장하면 이 브라우저에 저장된 키를 지운다 (공용 PC용)
    if (!storage.get(KEY_STORAGE)) return;
    storage.remove(KEY_STORAGE);
    location.reload();
    return;
  }
  storage.set(KEY_STORAGE, key);
  if (mapState === 'none') {
    els.settingsDialog.close();
    initMap();
  } else {
    location.reload(); // 구글 지도 스크립트는 한 페이지에서 한 번만 불러올 수 있다
  }
});

els.fileInput.addEventListener('change', async (e) => {
  await handleFile(e.target.files[0]);
  e.target.value = ''; // 같은 파일을 다시 골라도 change가 일어나도록
});

els.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.dropzone.classList.add('over');
});
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('over'));
els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  els.dropzone.classList.remove('over');
  handleFile(e.dataTransfer.files[0]);
});
// 상자 밖에 떨어뜨려도 브라우저가 파일을 열어 버리지 않도록
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

els.templateLink.addEventListener('click', (e) => {
  e.preventDefault();
  downloadTemplate();
});

els.sheetSelect.addEventListener('change', () => loadSheet(els.sheetSelect.value));

els.mappingFields.addEventListener('change', (e) => {
  const { key } = e.target.dataset;
  if (!key) return;
  state.mapping[key] = Number(e.target.value);
  updateSummary();
  previewItinerary();
});

els.commonRegion.addEventListener('input', updateSummary);
els.runBtn.addEventListener('click', run);

els.statusChips.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filter]');
  if (!chip) return;
  state.filter = chip.dataset.filter;
  const selected = state.items[state.selected];
  if (selected && !groupOf(state.filter).match(selected)) select(null);
  else render();
});

function handleItineraryClick(e) {
  const legEl = e.target.closest('.leg');
  if (legEl) {
    const rideFixButton = e.target.closest('[data-ride-fix]');
    if (rideFixButton) {
      applyRideFix(Number(rideFixButton.dataset.rideFix));
      return;
    }
    const fixButton = e.target.closest('[data-action="plan-fix"]');
    if (fixButton) applyFix(legEl.dataset.leg, Number(fixButton.dataset.fix));
    else if (!e.target.closest('.leg-detail')) selectLeg(legEl.dataset.leg, 'list');
    return;
  }
  const li = e.target.closest('.item');
  if (!li) return;
  const it = state.items[Number(li.dataset.idx)];
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) {
    if (!e.target.closest('.detail')) select(state.selected === it.idx ? null : it.idx, 'list');
    return;
  }
  switch (actionEl.dataset.action) {
    case 'candidate':
      it.place = it.candidates[Number(actionEl.dataset.ci)];
      it.status = 'confirmed';
      it.note = '';
      placeMarker(it);
      refreshLegs();
      select(it.idx, 'list');
      break;
    case 'confirm':
      it.status = 'confirmed';
      it.note = '';
      render();
      break;
    case 'research':
      research(it, li.querySelector('.query').value.trim());
      break;
    case 'pick':
      startPick(it);
      break;
    case 'recs':
      openRecs(itemAnchor(it), { kind: actionEl.dataset.kind });
      break;
    default:
  }
}
els.resultList.addEventListener('click', handleItineraryClick);
els.placePanelBody.addEventListener('click', handleItineraryClick);

els.resultList.addEventListener('change', (e) => {
  if (!e.target.matches('[data-action="leg-mode"]')) return;
  setLegMode(e.target.closest('.leg').dataset.leg, e.target.value);
});

els.routeToggle.addEventListener('change', () => {
  state.showRoutes = els.routeToggle.checked;
  if (!state.showRoutes && state.selectedLeg) state.selectedLeg = null;
  drawLegs();
  render();
});
els.routeBtn.addEventListener('click', findRoutes);

els.planCheck.addEventListener('click', (e) => {
  const legButton = e.target.closest('[data-goto-leg]');
  if (legButton) {
    goToLeg(legButton.dataset.gotoLeg);
    return;
  }
  const paceButton = e.target.closest('[data-pace]');
  if (paceButton) {
    setPace(paceButton.dataset.pace);
    return;
  }
  const rideFixButton = e.target.closest('[data-ride-fix]');
  if (rideFixButton) {
    applyRideFix(Number(rideFixButton.dataset.rideFix));
    return;
  }
  const rideButton = e.target.closest('[data-ride]');
  if (rideButton) {
    const index = Number(rideButton.dataset.ride);
    state.openRide = state.openRide === index ? null : index;
    render();
    return;
  }
  const action = e.target.closest('[data-plan]')?.dataset.plan;
  if (action === 'save') saveEditedPlan();
  else if (action === 'undo') undoEdits();
});

/* 여행 일정 추천 */
els.plannerToggle.addEventListener('click', () => setPlannerOpen(els.plannerForm.classList.contains('hidden')));
els.plannerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  generateTrip();
});
els.plannerStatus.addEventListener('click', (e) => {
  const action = e.target.closest('[data-planner]')?.dataset.planner;
  const result = state.planner.result;
  if (!action || !result) return;
  if (action === 'download') {
    downloadBlob(new Blob([result.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), result.fileName);
  } else if (action === 'revise') {
    generateTrip({ revise: true });
  }
});
els.aiProvider.addEventListener('change', fillAISettings);
els.claudeKeyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const provider = els.aiProvider.value;
  const config = AI_PROVIDERS[provider];
  const key = els.claudeKeyInput.value.trim();
  let saved = storage.set('plannerProvider', provider);
  if (config) {
    if (key) saved = storage.set(config.keyStorage, key) && saved;
    else storage.remove(config.keyStorage);
    saved = storage.set(`plannerModel.${provider}`, els.aiModel.value.trim() || config.model) && saved;
  }
  els.claudeKeyStatus.textContent = !saved ? '브라우저 저장소에 저장하지 못했어요. 저장소 접근 설정을 확인해 주세요.'
    : !config ? 'AI 없이 구글 지도 데이터로 일정을 추천합니다.'
    : key ? `${config.label} 설정을 저장했어요.` : `${config.label} 키를 지웠어요. 사용하려면 키를 다시 입력해 주세요.`;
  els.claudeKeyStatus.className = `status ${saved ? 'ok' : 'error'}`;
  renderPlanner();
});

/* 주변 추천 */
els.recsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  searchAnchor(els.recsQuery.value.trim());
});
els.recsClose.addEventListener('click', closeRecs);

els.recsBody.addEventListener('click', (e) => {
  const kindButton = e.target.closest('[data-rec-kind]');
  if (kindButton) {
    setRecKind(kindButton.dataset.recKind);
    return;
  }
  const chip = e.target.closest('[data-rec-keyword]');
  if (chip) {
    setRecKeyword(chip.dataset.recKeyword);
    return;
  }
  const pickButton = e.target.closest('[data-rec-pick]');
  if (pickButton) {
    pickRec(Number(pickButton.dataset.recPick));
    return;
  }
  if (e.target.closest('[data-rec-more]')) {
    state.recs.more = true;
    render();
    showRecPins(false);
    return;
  }
  // 긴 리뷰는 눌러서 펼친다 (다시 그리면 접힌다)
  const review = e.target.closest('[data-review]');
  if (review) {
    review.classList.toggle('full');
    return;
  }
  const card = e.target.closest('.rec');
  if (card && !e.target.closest('a, input, button, .rec-detail')) focusRec(card.dataset.rec, 'list');
});

els.recsBody.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-rec-keyword-form]')) return;
  e.preventDefault();
  setRecKeyword(e.target.elements.keyword.value.trim());
});

// 타베로그·카카오맵에서 보고 적은 점수 (비우면 지운다)
els.recsBody.addEventListener('change', (e) => {
  const id = e.target.dataset.recScore;
  if (!id) return;
  const score = parseFloat(e.target.value);
  if (Number.isFinite(score) && score > 0 && score <= 5) ratingScores[id] = Math.round(score * 100) / 100;
  else delete ratingScores[id];
  storage.set(SCORE_STORAGE, JSON.stringify(ratingScores));
  rankRecs();
  render();
  showRecPins(false);
});

/* 하루 예산 */
els.budgetForm.addEventListener('submit', (e) => {
  e.preventDefault();
  saveBudget();
});
els.budgetForm.addEventListener('change', saveBudget);

els.budgetDays.addEventListener('click', (e) => {
  const slot = e.target.closest('[data-slot-recs]');
  if (slot) {
    openSlotRecs(Number(slot.dataset.slotRecs));
    return;
  }
  const amount = e.target.closest('[data-amount]');
  if (amount) {
    state.editAmount = Number(amount.dataset.amount);
    render();
    return;
  }
  const head = e.target.closest('[data-budget-day]');
  if (head) {
    const { budgetDay } = head.dataset;
    const open = head.getAttribute('aria-expanded') === 'true';
    state.budgetOpen = open ? null : budgetDay;
    // 날짜 탭으로 그날을 보고 있으면 탭을 풀어야 접힌다
    if (open && state.day != null && dayOfCategory(state.day) === budgetDay) setDay(null);
    else render();
  }
});

els.budgetDays.addEventListener('keydown', (e) => {
  if (!e.target.matches('[data-amount-input]')) return;
  if (e.key === 'Enter') setOverride(Number(e.target.dataset.amountInput), e.target.value, e.target.dataset.original);
  if (e.key === 'Escape') {
    state.editAmount = null;
    render();
  }
});
els.budgetDays.addEventListener('focusout', (e) => {
  if (e.target.matches('[data-amount-input]') && state.editAmount === Number(e.target.dataset.amountInput)) {
    setOverride(state.editAmount, e.target.value, e.target.dataset.original);
  }
});

els.resultList.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.matches('.query')) return;
  const it = state.items[Number(e.target.closest('.item').dataset.idx)];
  research(it, e.target.value.trim());
});

els.pickCancel.addEventListener('click', cancelPick);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cancelPick();
});

els.exportXlsx.addEventListener('click', exportXlsx);
els.exportKml.addEventListener('click', exportKml);

els.clearCache.addEventListener('click', (e) => {
  e.preventDefault();
  if (!confirm('저장해 둔 검색·경로 결과를 모두 지울까요? 다음에 같은 장소를 다시 찾으면 요금이 다시 듭니다.')) return;
  clearCache();
  clearRouteCache();
  if (state.records.length) updateSummary();
  showToast('저장된 검색·경로 결과를 지웠어요');
});

/* ───────────── 시작 ───────────── */

if (CFG.googleMapsApiKey) {
  // config.js에 키가 있으면 입력칸 대신 안내만
  els.keyForm.classList.add('hidden');
  els.keyStatus.textContent = '서버 또는 config.js에 설정된 키를 쓰고 있어요.';
} else {
  els.apiKeyInput.value = storage.get(KEY_STORAGE) || '';
}
if (typeof XLSX === 'undefined') {
  els.dropTitle.textContent = '엑셀 라이브러리(vendor/xlsx.full.min.js)를 불러오지 못했습니다';
}
updateRunButton();
setupPlanner();
initMap();

// 지도 작업 화면: 보조 기능은 도구 창에 모으고 일정 목록에 공간을 준다.
const toolBody = document.getElementById('workspaceToolBody');
for (const card of [els.plannerCard, els.recsCard, els.budgetCard]) toolBody.append(card);
els.planCard.before(els.uploadCard);
els.columnsPanel.after(els.runBtn);
const routeSummary = document.getElementById('journeySummary');
routeSummary.after(els.routeCard);
document.getElementById('workspaceSearch').addEventListener('input', renderList);
document.getElementById('mapDays').addEventListener('click', (event) => {
  const button = event.target.closest('[data-workspace-day]');
  if (button) setDay(button.dataset.workspaceDay || null);
});
els.placePanelBody.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="recs"]')) document.getElementById('workspaceTools').showModal();
});
function renderWorkspaceChrome() {
  const cats = [...state.colors.keys()];
  const days = document.getElementById('mapDays');
  days.classList.toggle('hidden', !state.items.length);
  days.innerHTML = [['', '전체'], ...cats.map((c, i) => [c, `Day ${i + 1}`])].map(([key, label]) => `<button data-workspace-day="${escapeHtml(key)}" class="${(state.day || '') === key ? 'active' : ''}">${label}</button>`).join('');
  const summary = document.getElementById('journeySummary');
  summary.classList.toggle('hidden', !state.items.length);
  const legs = shownLegs();
  const distance = legs.reduce((n, leg) => n + (leg.route?.distance || 0), 0);
  const duration = travelOf(legs);
  summary.innerHTML = `<strong>${state.day ? escapeHtml(dayInfo(state.day).label) : '전체 일정'} 이동 경로</strong><div class="journey-metrics"><div><small>총 이동 거리</small><b>${distance ? formatDistance(distance) : '경로 검색 전'}</b></div><div><small>이동 시간</small><b>${duration ? formatDuration(duration) : '미정'}</b></div><div><small>방문 장소</small><b>${state.items.filter(it => catVisible(it.category)).length}곳</b></div></div>`;
  const done = state.items.length && state.items.every(it => it.place);
  document.querySelectorAll('#importSteps > span').forEach((step, i) => step.classList.toggle('done', i < 2 ? !!state.records.length : i === 2 ? !!state.items.length && !state.running && done : !!done));
  document.body.classList.toggle('has-itinerary', !!state.items.length);
}
