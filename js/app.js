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
  // 02 일정
  'planCard', 'planSummary', 'progressBar', 'progressText', 'runAlert', 'planCheck', 'dayTabs', 'statusChips', 'resultList',
  // 03 지도
  'mapPanel', 'mapMode', 'mapScope', 'routeToggle', 'fitMap', 'map', 'mapPlaceholder', 'mapNote', 'pickBanner', 'pickCancel',
  'exportXlsx', 'exportKml',
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
    });
    await mapView.init();
    if (mapState === 'error') return; // 그사이 gm_authFailure가 불린 경우
    mapState = 'ready';
    els.mapPlaceholder.classList.add('hidden');
    setKeyStatus('지도 연결됨', 'ok');
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
  setColumnsOpen(true);
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
  state.mapping = autoMap(headers);
  state.resultCols = Object.fromEntries(Object.entries(RESULT_COLUMNS).map(([k, h]) => [k, headers.indexOf(h)]));
  const kb = Math.max(1, Math.round(state.fileSize / 1024));
  els.fileMeta.textContent = `Excel · ${kb} KB · ${name} 시트 · ${records.length}행`;
  renderMapping();
  updateSummary();
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

// 고침안의 시간 칸을 바꾸고(되돌릴 수 있게 원래 칸을 남긴다) 구간·화면을 다시 만든다
function applyChanges(fix) {
  const col = state.mapping.time;
  for (const change of fix.changes) {
    const rec = state.records[change.index];
    state.planEdits.push({ index: change.index, col, before: rec.cells[col], text: change.text, minutes: change.minutes });
    rec.cells[col] = { v: change.text, w: change.text };
  }
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
  syncItemTimes();
  refreshLegs();
  render();
  showToast('고친 일정을 모두 되돌렸어요');
}

// 고친 칸마다 원래 글자와 마지막 글자 (같은 칸을 여러 번 고쳐도 한 줄)
function editedRows() {
  const rows = new Map();
  for (const e of state.planEdits) {
    const from = rows.get(e.index)?.from ?? cellText(e.before);
    rows.set(e.index, { index: e.index, col: e.col, from, text: e.text, minutes: e.minutes });
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
        <div class="plan-edits-label">고친 시간 ${rows.length}칸 · 저장하면 원래 엑셀에서 이 칸만 바뀌어요</div>
        <ul>${rows.map((r) => `<li><span>${escapeHtml(rowTitle(r.index))}</span><s>${escapeHtml(r.from)}</s><b>${escapeHtml(r.text)}</b></li>`).join('')}</ul>
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
  renderPlanCheck();
  renderChips();
  renderDayTabs();
  renderRouteCard();
  renderMapMeta();
  renderList();
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
  const html = tab(null, all, '') + cats.map((c) => tab(c, dayInfo(c), state.colors.get(c))).join('') + label;
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
      <span class="timeline-arrow" aria-hidden="true">↗</span>
    </div>
    ${selected ? renderDetail(it) : ''}
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
    (group.match(it) || it.idx === state.selected) && catVisible(it.category)
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

els.resultList.addEventListener('click', (e) => {
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
    default:
  }
});

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
  els.keyStatus.textContent = 'config.js에 설정된 키를 쓰고 있어요.';
} else {
  els.apiKeyInput.value = storage.get(KEY_STORAGE) || '';
}
if (typeof XLSX === 'undefined') {
  els.dropTitle.textContent = '엑셀 라이브러리(vendor/xlsx.full.min.js)를 불러오지 못했습니다';
}
updateRunButton();
initMap();
