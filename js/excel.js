/* global XLSX */
// 엑셀 읽기/쓰기 — SheetJS(vendor/xlsx.full.min.js)를 전역 XLSX로 사용
import { normalizeText, STATUS, safeUrl } from './util.js';
import { checkFileSize, zipEntries } from './file-limits.js';

// 앱이 이해하는 열. synonyms에 있는 머리글은 자동으로 연결되며, 앞에 있는 낱말일수록 우선한다
export const FIELDS = [
  {
    key: 'name', label: '장소', required: true,
    synonyms: ['장소', '장소명', '이름', '상호', '상호명', '업체', '업체명', '가게', '가게명', '지점', '지점명',
      '명칭', '시설명', '매장명', 'place', 'placename', 'name', 'title'],
  },
  { key: 'region', label: '지역', synonyms: ['지역', '지역명', '도시', '시군구', '동네', 'region', 'city', 'area'] },
  { key: 'address', label: '주소', synonyms: ['주소', '도로명주소', '지번주소', '소재지', 'address', 'addr'] },
  {
    // 여행 일정표라면 날짜별로 핀 색을 나누는 것이 가장 쓸모 있다. '구분'은 고정/예상처럼 다른 뜻으로도 많이 쓰여 뒤로 둔다
    key: 'category', label: '분류',
    synonyms: ['분류', '카테고리', 'category', '날짜', '일자', '일차', 'date', 'day', '구분', '종류', '유형', '그룹', 'type', 'group', 'kind'],
  },
  { key: 'memo', label: '메모', synonyms: ['메모', '설명', '비고', '내용', '노트', 'note', 'notes', 'memo', 'description', 'desc'] },
  { key: 'lat', label: '위도', synonyms: ['위도', 'lat', 'latitude', 'y'] },
  { key: 'lng', label: '경도', synonyms: ['경도', 'lng', 'lon', 'long', 'longitude', 'x'] },
  // 동선용: 날짜가 같은 장소끼리 순서대로 잇고, 시간·이동 수단으로 경로를 찾는다
  // 날짜는 분류(핀 색)와 같은 열을 함께 쓸 수 있다
  { key: 'date', label: '날짜', group: 'route', shared: true, synonyms: ['날짜', '일자', '일차', 'date', 'day'] },
  { key: 'time', label: '시간', group: 'route', synonyms: ['시간', '시각', 'time'] },
  { key: 'mode', label: '이동', group: 'route', synonyms: ['이동수단', '교통수단', '이동방법', '교통', '이동', 'transport', 'transportation', 'mode'] },
];

// 결과 엑셀에 덧붙이는 열. 다시 올리면 이 값으로 검색 없이 복원한다
export const RESULT_COLUMNS = {
  name: '검색된 이름',
  address: '검색된 주소',
  url: '구글지도 링크',
  placeId: '구글 장소 ID',
  status: '검색 상태',
  nextLeg: '다음 장소까지',
};

const MAX_ROWS = 20000;
const MAX_COLS = 200;
const HEADER_SCAN_ROWS = 20;

export function cellText(cell) {
  if (!cell) return '';
  if (cell.w != null && cell.w !== '') return String(cell.w).trim();
  if (cell.v instanceof Date) return cell.v.toLocaleDateString('ko-KR');
  return String(cell.v ?? '').trim();
}

export function cellNumber(cell) {
  if (!cell) return NaN;
  if (typeof cell.v === 'number') return cell.v;
  return parseFloat(String(cell.v).trim());
}

// 올린 파일 그대로(buffer)도 앱이 들고 있다가, 고친 일정을 저장할 때 원래 파일에 써 넣는다
export function readWorkbook(buffer, fileName) {
  checkFileSize(buffer.byteLength);
  if (/\.(xlsx|xlsm)$/i.test(fileName)) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw new Error('올바른 XLSX 파일이 아닙니다. CSV 파일은 .csv 확장자로 선택해 주세요.');
    const zip = zipEntries(buffer);
    if (!zip.some(entry => entry.name === 'xl/workbook.xml')) throw new Error('엑셀 통합 문서가 없는 ZIP 파일입니다.');
  }
  if (/\.csv$/i.test(fileName)) {
    // 한국어 엑셀이 저장한 CSV는 대개 EUC-KR(CP949)이라 인코딩을 직접 판별한다
    return XLSX.read(decodeText(buffer), { type: 'string', raw: true });
  }
  return XLSX.read(buffer, { type: 'array', cellDates: true });
}

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('euc-kr').decode(buffer);
  }
}

// 시트를 [행][열] = {v: 원래 값, w: 화면에 보이는 글자} 배열로 바꾼다
function sheetToRows(sheet) {
  if (!sheet || !sheet['!ref']) return { rows: [], startRow: 0, startCol: 0 };
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const lastRow = Math.min(range.e.r, range.s.r + MAX_ROWS);
  const lastCol = Math.min(range.e.c, range.s.c + MAX_COLS - 1);
  const rows = [];
  for (let r = range.s.r; r <= lastRow; r++) {
    const row = [];
    for (let c = range.s.c; c <= lastCol; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      // f: 수식 칸 표시 — 일정 점검이 시각을 고쳐 쓰지 않는다
      row.push(cell && cell.v != null && cell.v !== '' ? { v: cell.v, w: cell.w, ...(cell.f ? { f: cell.f } : {}) } : null);
    }
    rows.push(row);
  }
  return { rows, startRow: range.s.r, startCol: range.s.c };
}

function normHeader(text) {
  // "이름(필수)", "[주소]" 같은 꾸밈은 떼고 비교
  return normalizeText(String(text ?? '').replace(/\(.*?\)|\[.*?\]/g, ''));
}

const ALL_SYNONYMS = new Set(FIELDS.flatMap((f) => f.synonyms.map(normalizeText)));

// 표 위에 제목 줄이 있어도 되도록, 알려진 머리글이 가장 많은 줄을 머리글로 본다
function detectHeaderRow(rows) {
  let best = -1;
  let bestScore = 0;
  for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
    const score = rows[r].filter((cell) => cell && ALL_SYNONYMS.has(normHeader(cellText(cell)))).length;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  if (best >= 0) return best;
  const filled = rows.findIndex((row) => row.filter(Boolean).length >= 2);
  if (filled >= 0) return filled;
  return Math.max(0, rows.findIndex((row) => row.some(Boolean)));
}

function uniqueHeaders(names, startCol) {
  const seen = new Map();
  return names.map((raw, i) => {
    const name = raw || `${XLSX.utils.encode_col(startCol + i)}열`;
    const count = seen.get(name) || 0;
    seen.set(name, count + 1);
    return count ? `${name} (${count + 1})` : name;
  });
}

// rowNumber는 엑셀 행 번호(1부터), startCol은 첫 열의 위치(0 = A열)라 둘로 칸 주소를 되짚을 수 있다
export function parseSheet(workbook, sheetName) {
  const { rows, startRow, startCol } = sheetToRows(workbook.Sheets[sheetName]);
  if (!rows.length) return { headers: [], records: [], startCol };
  const h = detectHeaderRow(rows);
  const body = rows.slice(h + 1);
  const lastFilled = (row) => {
    for (let i = row.length - 1; i >= 0; i--) if (row[i]) return i;
    return -1;
  };
  const width = Math.max(lastFilled(rows[h]), ...body.map(lastFilled)) + 1;
  const headers = uniqueHeaders(rows[h].slice(0, width).map(cellText), startCol);
  const records = [];
  body.forEach((cells, i) => {
    if (cells.some(Boolean)) records.push({ rowNumber: startRow + h + 2 + i, cells: cells.slice(0, width) });
  });
  return { headers, records, startCol };
}

export function autoMap(headers) {
  const norm = headers.map(normHeader);
  const resultHeaders = new Set(Object.values(RESULT_COLUMNS).map(normHeader));
  const mapping = Object.fromEntries(FIELDS.map((f) => [f.key, -1]));
  const used = new Set();
  const take = (f, i) => {
    if (i < 0) return;
    mapping[f.key] = i;
    if (!f.shared) used.add(i);
  };

  // 낱말 우선순위대로 맞는 열을 찾는다 (예: '날짜'와 '구분'이 다 있으면 '날짜'가 분류)
  const find = (f, synonyms, matches) => {
    for (const s of synonyms) {
      const i = norm.findIndex((h, idx) => (f.shared || !used.has(idx)) && !resultHeaders.has(h) && matches(h, s));
      if (i >= 0) return i;
    }
    return -1;
  };
  // 1차: 머리글이 정확히 같은 열
  for (const f of FIELDS) {
    take(f, find(f, f.synonyms.map(normalizeText), (h, s) => h === s));
  }
  // 2차: 머리글에 낱말이 들어 있는 열 (예: "방문 장소")
  for (const f of FIELDS) {
    if (mapping[f.key] >= 0) continue;
    take(f, find(f, f.synonyms.map(normalizeText).filter((s) => s.length >= 2), (h, s) => h.includes(s)));
  }
  return mapping;
}

// 이름 열을 찾을 수 있는 첫 시트(없으면 데이터가 있는 첫 시트)
export function pickDefaultSheet(workbook) {
  let fallback = null;
  for (const name of workbook.SheetNames) {
    const { headers, records } = parseSheet(workbook, name);
    if (!records.length) continue;
    if (autoMap(headers).name >= 0) return name;
    fallback ??= name;
  }
  return fallback ?? workbook.SheetNames[0];
}

export function buildTemplateWorkbook() {
  const wb = XLSX.utils.book_new();
  // 여행 일정표 모양. '장소'가 빈 행(이동·휴식 등)은 지도에 나오지 않는다
  const plan = XLSX.utils.aoa_to_sheet([
    ['부산 1박 2일 일정표'],
    [],
    ['날짜', '시간', '일정', '장소', '지역', '이동 수단', '메모'],
    ['12/5 (토)', '10:00', '부산역 도착', '부산역', '부산 동구', 'KTX', ''],
    ['12/5 (토)', '10:00–10:40', '부산역 → 해운대', '', '', '지하철 2호선', '장소를 비우면 지도에 나오지 않습니다'],
    ['12/5 (토)', '10:40–12:00', '해변 산책', '해운대해수욕장', '부산 해운대구', '도보', ''],
    ['12/5 (토)', '12:00–13:00', '점심, 시장 구경', '해운대시장', '부산 해운대구', '도보', ''],
    ['12/5 (토)', '13:00–14:00', '누리마루 APEC하우스', '동백섬', '부산 해운대구', '도보', ''],
    ['12/5 (토)', '14:00–15:00', '휴식', '', '', '', ''],
    ['12/5 (토)', '19:00–21:00', '광안대교 야경', '광안리해수욕장', '부산 수영구', '지하철', ''],
    ['12/6 (일)', '10:00–12:00', '골목 구경, 어린왕자 포토존', '감천문화마을', '부산 사하구', '버스', ''],
    ['12/6 (일)', '12:30–13:30', '점심 (회)', '자갈치시장', '부산 중구', '버스', ''],
    ['12/6 (일)', '13:30–14:30', '시장 구경', '국제시장', '부산 중구', '도보', '한 칸에 한 곳만. 두 곳이면 행을 나눕니다'],
    ['12/6 (일)', '14:30–15:00', '씨앗호떡', 'BIFF광장', '부산 중구', '도보', ''],
    ['12/6 (일)', '17:00', 'KTX 출발', '부산역', '부산 동구', 'KTX', ''],
  ]);
  plan['!cols'] = [{ wch: 11 }, { wch: 12 }, { wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, plan, '일정표');

  const guide = XLSX.utils.aoa_to_sheet([
    ['열', '필수', '설명'],
    ['장소', '필수', '지도에 찍을 곳의 이름. 구글 지도 검색창에 쳐서 나오는 이름이면 됩니다. 비워 둔 행은 지도에 나오지 않습니다'],
    ['지역', '선택', '같은 이름이 여러 곳에 있을 때 구분용 (예: 부산 해운대구, 후쿠오카)'],
    ['날짜', '선택', '날짜마다 핀 색이 달라지고, 지도에서 날짜별로 켜고 끌 수 있습니다'],
    ['시간 · 일정 · 이동 수단 · 메모', '선택', '자유롭게. 핀을 누르면 정보창에 함께 보입니다'],
    ['주소', '선택', '알면 열을 추가해 적으세요. 장소 이름과 함께 검색합니다'],
    ['위도 / 경도', '선택', '두 열을 추가해 좌표를 적으면 검색하지 않고 그 위치에 표시합니다'],
    [],
    ['작성 요령'],
    ['· 장소 칸에는 이름만 적습니다. "쿠시다 신사 참배"가 아니라 "쿠시다 신사"'],
    ['· "호텔", "숙소" 대신 실제 이름을 적습니다 (예: 루트인 그란티아 다자이후)'],
    ['· 한 칸에 한 곳만. 두 곳을 들르면 행을 나눕니다'],
    ['· 해외 장소를 한국어로 못 찾으면 현지어 이름으로 적습니다 (예: 櫛田神社)'],
    ['· 머리글 이름이 달라도 됩니다. 파일을 올린 뒤 화면에서 어떤 열이 무엇인지 고를 수 있습니다'],
  ]);
  guide['!cols'] = [{ wch: 26 }, { wch: 6 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, guide, '작성법');
  return wb;
}

export function downloadTemplate() {
  XLSX.writeFile(buildTemplateWorkbook(), '지도_양식.xlsx');
}

// 원래 열은 그대로 두고 위도·경도와 검색 결과 열을 채운 통합 문서
export function buildResultWorkbook({ headers, mapping, items, sheetName, nextLegText = () => '' }) {
  const out = [...headers];
  const column = (title, existing = -1) => {
    if (existing >= 0) return existing;
    let i = out.indexOf(title);
    if (i < 0) { i = out.length; out.push(title); }
    return i;
  };
  const col = {
    lat: column('위도', mapping.lat),
    lng: column('경도', mapping.lng),
    name: column(RESULT_COLUMNS.name),
    address: column(RESULT_COLUMNS.address),
    url: column(RESULT_COLUMNS.url),
    placeId: column(RESULT_COLUMNS.placeId),
    status: column(RESULT_COLUMNS.status),
    nextLeg: column(RESULT_COLUMNS.nextLeg),
  };
  const round = (n) => Math.round(n * 1e7) / 1e7;

  const aoa = [out];
  for (const it of items) {
    const row = out.map((_, i) => (it.cells[i] ? it.cells[i].v : ''));
    const p = it.place;
    row[col.lat] = p ? round(p.lat) : '';
    row[col.lng] = p ? round(p.lng) : '';
    row[col.name] = p?.name || '';
    row[col.address] = p?.address || '';
    row[col.url] = p ? placeUrl(p) : '';
    row[col.placeId] = p?.id || '';
    row[col.status] = STATUS[it.status]?.label || '';
    row[col.nextLeg] = nextLegText(it);
    aoa.push(row);
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  // 링크 열은 눌러서 열 수 있게
  for (let r = 1; r < aoa.length; r++) {
    const url = aoa[r][col.url];
    const cell = sheet[XLSX.utils.encode_cell({ r, c: col.url })];
    if (url && cell) cell.l = { Target: url };
  }
  sheet['!cols'] = out.map((h) => ({ wch: Math.min(40, Math.max(10, String(h).length * 2 + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, (sheetName || '장소목록').slice(0, 31));
  return wb;
}

export function placeUrl(place) {
  if (safeUrl(place.url)) return safeUrl(place.url);
  return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
}
