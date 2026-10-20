// 하루 예산: 일정표 메모에 적은 금액을 먼저 쓰고, 금액이 없는 끼니·이동·코인로커는 어림해 날짜별로 더한다.
// 숙박·항공은 보통 미리 결제하므로 하루 예산에서 뺀다
import { parseTimeRange } from './routes.js';

// 화면에 보여 줄 통화. digits는 소수 자릿수, step은 어림값을 반올림하는 단위
export const CURRENCIES = {
  KRW: { label: '원', digits: 0, step: 100, format: (n) => `${n}원` },
  JPY: { label: '엔', digits: 0, step: 10, format: (n) => `${n}엔` },
  USD: { label: '달러', digits: 2, step: 1, format: (n) => `$${n}` },
  EUR: { label: '유로', digits: 2, step: 1, format: (n) => `€${n}` },
  GBP: { label: '파운드', digits: 2, step: 1, format: (n) => `£${n}` },
  CNY: { label: '위안', digits: 0, step: 1, format: (n) => `${n}위안` },
  TWD: { label: '대만 달러', digits: 0, step: 10, format: (n) => `NT$${n}` },
  HKD: { label: '홍콩 달러', digits: 0, step: 1, format: (n) => `HK$${n}` },
  THB: { label: '바트', digits: 0, step: 10, format: (n) => `${n}바트` },
  VND: { label: '동', digits: 0, step: 1000, format: (n) => `${n}동` },
  SGD: { label: '싱가포르 달러', digits: 2, step: 1, format: (n) => `S$${n}` },
};

// 나라 → 통화 (장소 좌표로 나라를 짐작했을 때)
export const COUNTRY_CURRENCY = { JP: 'JPY', KR: 'KRW', US: 'USD', GB: 'GBP', CN: 'CNY', TW: 'TWD', HK: 'HKD', TH: 'THB', VN: 'VND', SG: 'SGD' };

// digits를 주면 그 자릿수로 (환율처럼 원 단위 아래도 보여야 할 때)
export function formatMoney(amount, currency, digits = null) {
  const c = CURRENCIES[currency];
  if (amount == null || !Number.isFinite(amount)) return '';
  if (!c) return `${Math.round(amount).toLocaleString('en-US')} ${currency}`;
  digits ??= Number.isInteger(amount) ? 0 : c.digits;
  return c.format(amount.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
}

export const roundMoney = (amount, currency) => {
  const step = CURRENCIES[currency]?.step || 1;
  return Math.max(step, Math.round(amount / step) * step);
};

/* ── 글자 속 금액 읽기 ── */

// 1,800 · 1.5 · 1만 · 1만 5천 · 3천 · 2万
const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*([만万])(?:\s*(\d+)\s*[천千])?|\s*([천千]))?`;
const RANGE = String.raw`\s*[-–~〜]\s*`;
// [통화, 앞에 붙는 기호, 뒤에 붙는 단위]
const UNITS = [
  ['TWD', String.raw`NT\$\s?|TWD\s?`, String.raw`대만\s?달러|TWD`],
  ['HKD', String.raw`HK\$\s?|HKD\s?`, String.raw`홍콩\s?달러|HKD`],
  ['SGD', String.raw`S\$\s?|SGD\s?`, String.raw`싱가포르\s?달러|SGD`],
  ['KRW', String.raw`₩\s?|KRW\s?`, String.raw`원|KRW`],
  ['JPY', String.raw`[¥￥]\s?|JPY\s?`, String.raw`엔|円|JPY|yen`],
  ['USD', String.raw`(?<![A-Za-z])\$\s?|US\$\s?|USD\s?`, String.raw`달러|불|USD|dollars?`],
  ['EUR', String.raw`€\s?|EUR\s?`, String.raw`유로|EUR|euros?`],
  ['GBP', String.raw`£\s?|GBP\s?`, String.raw`파운드|GBP`],
  ['CNY', String.raw`CN¥\s?|RMB\s?|CNY\s?`, String.raw`위안|元|RMB|CNY`],
  ['THB', String.raw`฿\s?|THB\s?`, String.raw`바트|THB|baht`],
  ['VND', String.raw`₫\s?|VND\s?`, String.raw`₫|VND`],
];

function numberValue(num, man, thousands, cheon) {
  const base = parseFloat(num.replace(/,/g, ''));
  if (man) return base * 10000 + (thousands ? Number(thousands) * 1000 : 0);
  if (cheon) return base * 1000;
  return base;
}

/**
 * 글자 속 금액들. [{ amount, min, max, currency, start, end, text, optional, alternative, range }]
 *  optional: "+2,200엔", "별도 2,200엔"처럼 더 낼 수도 있는 돈
 *  alternative: "대안: … 3,500엔"처럼 다른 선택지의 돈
 */
export function parseMoney(text) {
  const s = String(text ?? '');
  const found = [];
  for (const [currency, prefix, suffix] of UNITS) {
    const patterns = [
      new RegExp(String.raw`(?:${prefix})${NUM}(?:${RANGE}(?:${prefix})?${NUM})?`, 'g'),
      new RegExp(String.raw`(?<![\d.,:])${NUM}(?:${RANGE}${NUM})?\s*(?:${suffix})(?![A-Za-z])`, 'g'),
    ];
    for (const re of patterns) {
      for (const m of s.matchAll(re)) {
        const start = m.index;
        const end = start + m[0].length;
        if (found.some((f) => start < f.end && end > f.start)) continue; // 다른 통화로 이미 읽은 자리
        const a = numberValue(m[1], m[2], m[3], m[4]);
        const b = m[5] != null ? numberValue(m[5], m[6], m[7], m[8]) : null;
        if (!Number.isFinite(a)) continue;
        const min = b != null ? Math.min(a, b) : a;
        const max = b != null ? Math.max(a, b) : a;
        found.push({ currency, start, end, text: m[0].trim(), min, max, range: b != null, amount: b != null ? midpoint(min, max) : a });
      }
    }
  }
  found.sort((x, y) => x.start - y.start);
  const altAt = s.search(/대안|대신|또는|아니면|alternative|\bor\b/i);
  for (const f of found) {
    const before = s.slice(Math.max(0, f.start - 8), f.start);
    f.optional = /\+\s*$|별도|추가/.test(before);
    f.alternative = altAt >= 0 && f.start > altAt;
  }
  return found;
}

// "1–1,000엔"처럼 아래 끝이 사실상 0이면 위 끝 가까이를 쓴다
function midpoint(min, max) {
  return min <= max * 0.05 ? max * 0.7 : (min + max) / 2;
}

/* ── 행 나누기 ── */

const LODGING = /숙박비|숙박료|숙박|1박|객실료|숙소비|호텔비|宿泊|lodging|accommodation|room charge/i;
const FLIGHT_WORD = /항공권|비행기표|airfare|flight ticket/i;
const BREAKFAST = /아침|조식|모닝|breakfast/i;
const LUNCH = /점심|런치|브런치|lunch|brunch/i;
const DINNER = /저녁|석식|디너|야식|dinner|supper/i;
const CAFE = /카페|디저트|커피|티타임|cafe|café|coffee|dessert/i;
const FOOD = /식사|맛집|라멘|라면|스시|초밥|오마카세|야키니쿠|고기|모츠나베|우동|소바|돈카츠|카레|야타이|이자카야|뷔페|레스토랑|식당|restaurant|lunch|dinner/i;
const LOCKER = /코인\s?로커|물품\s?보관함|コインロッカー|locker/i;
const STORE = /보관|맡기|맡김|넣기|store/i;
const PASS = /1일권|일일권|1일\s?승차권|1일\s?패스|프리\s?패스|자유\s?이용권|一日乗車券|1日乗車券|フリーパス|day\s?pass|free\s?pass/i;

export const MEALS = {
  breakfast: { label: '아침' },
  lunch: { label: '점심' },
  dinner: { label: '저녁' },
  cafe: { label: '카페' },
};

/** 끼니 행이면 'breakfast' | 'lunch' | 'dinner' | 'cafe', 아니면 null */
export function mealOf(title, timeText) {
  const s = String(title ?? '');
  if (BREAKFAST.test(s)) return 'breakfast';
  if (LUNCH.test(s)) return 'lunch';
  if (DINNER.test(s)) return 'dinner';
  const { start, end } = parseTimeRange(timeText);
  // "스시 쿠보타 입장"처럼 시각 하나만 적힌 행은 끼니가 아니다. 30분 넘게 머무는 식사 행만 시각으로 끼니를 정한다
  if (FOOD.test(s) && start != null && end != null && end - start >= 30) {
    return start < 10 * 60 + 30 ? 'breakfast' : start < 16 * 60 ? 'lunch' : 'dinner';
  }
  if (CAFE.test(s)) return 'cafe';
  return null;
}

// 끼니 어림값(1인). 금액이 없는 끼니에만 쓴다
export const MEAL_DEFAULTS = {
  JPY: { breakfast: 900, lunch: 1300, dinner: 3000, cafe: 700 },
  KRW: { breakfast: 9000, lunch: 13000, dinner: 25000, cafe: 6500 },
  USD: { breakfast: 15, lunch: 22, dinner: 40, cafe: 7 },
  EUR: { breakfast: 12, lunch: 20, dinner: 35, cafe: 5 },
  GBP: { breakfast: 12, lunch: 18, dinner: 32, cafe: 5 },
  CNY: { breakfast: 25, lunch: 50, dinner: 100, cafe: 30 },
  TWD: { breakfast: 150, lunch: 250, dinner: 500, cafe: 150 },
  HKD: { breakfast: 60, lunch: 100, dinner: 250, cafe: 50 },
  THB: { breakfast: 120, lunch: 200, dinner: 450, cafe: 100 },
  VND: { breakfast: 60000, lunch: 90000, dinner: 200000, cafe: 50000 },
  SGD: { breakfast: 8, lunch: 15, dinner: 35, cafe: 7 },
};
const LOCKER_DEFAULTS = { JPY: 600, KRW: 3000 };

/* ── 교통비 어림 ── */

// 이동 수단 글자 → 요금 셈 방식
export function fareClass(text) {
  const s = String(text ?? '');
  if (!s.trim()) return null;
  if (/무료|공짜|free/i.test(s)) return 'free';
  if (/항공|비행기|flight|plane/i.test(s)) return 'flight';
  if (/택시|taxi/i.test(s)) return 'taxi';
  if (/신칸센|新幹線|shinkansen|KTX|SRT|고속철/i.test(s)) return 'highspeed';
  if (/특급|特急|limited express|ITX|새마을/i.test(s)) return 'express';
  if (/공항버스|공항\s?리무진|에어포트|리무진|airport/i.test(s)) return 'airportbus';
  if (/고속버스|시외버스|highway bus|高速バス|coach/i.test(s)) return 'coach';
  if (/셔틀|shuttle/i.test(s)) return 'shuttle';
  if (/페리|배편|선박|여객선|ferry|boat/i.test(s)) return 'ferry';
  if (/지하철|subway|metro|모노레일|monorail|트램|tram|노면|streetcar/i.test(s)) return 'metro';
  if (/버스|bus/i.test(s)) return 'bus';
  if (/JR|전철|열차|기차|보통|쾌속|무궁화|train|rail|니시테츠|西鉄|사철|급행/i.test(s)) return 'rail';
  if (/대중교통|public transport|transit/i.test(s)) return 'metro'; // 무엇을 탈지 모르면 시내 지하철 요금으로
  if (/도보|걸어|걷|walk/i.test(s)) return 'walk';
  return null;
}

// 걸린 시간으로 거리를 어림할 때 쓰는 평균 속도(km/h)
// (일정표의 이동 시간에는 역까지 걷고 기다리는 시간도 들어 있어 시내 교통은 낮게 잡는다)
const SPEED = { bus: 12, metro: 20, rail: 35, express: 80, highspeed: 180, airportbus: 40, coach: 70, taxi: 25, shuttle: 25, ferry: 25 };
const COUNTRY_SPEED = { JP: { highspeed: 240 }, KR: { highspeed: 160 } }; // 신칸센은 KTX보다 빠르다
const FARE_NAMES = {
  bus: '버스', metro: '지하철', rail: '전철', express: '특급', highspeed: '고속철', airportbus: '공항버스', coach: '고속버스', taxi: '택시',
};

// 나라별 어림 요금(1인, km는 이동 거리). 모르면 null
const FARES = {
  JP: {
    bus: (km) => 150 + 30 * km,
    metro: (km) => Math.min(400, 210 + 15 * Math.max(0, km - 3)),
    rail: (km) => 140 + 17 * km,
    express: (km) => Math.max(1000, 30 * km),
    highspeed: (km) => Math.max(1500, 32 * km),
    airportbus: (km) => 300 + 20 * km,
    coach: (km) => Math.max(1000, 25 * km),
    taxi: (km) => 700 + 350 * Math.max(0, km - 1.5),
  },
  KR: {
    bus: () => 1500,
    metro: (km) => 1550 + 100 * Math.ceil(Math.max(0, km - 10) / 5),
    rail: (km) => Math.max(2600, 80 * km),
    express: (km) => Math.max(4800, 110 * km),
    highspeed: (km) => Math.max(8400, 145 * km),
    airportbus: (km) => Math.max(10000, 200 * km),
    coach: (km) => Math.max(5000, 85 * km),
    taxi: (km) => 4800 + 800 * Math.max(0, km - 1.6),
  },
};
const COUNTRY_OF_CURRENCY = { JPY: 'JP', KRW: 'KR' };
// 거리를 모를 때도 어림할 수 있는 시내 교통 (기본요금 근처)
const TYPICAL_KM = { bus: 3, metro: 3 };

/** 교통비 어림. { amount, km, how } 또는 null (모름) */
export function estimateFare(cls, km, currency) {
  const table = FARES[COUNTRY_OF_CURRENCY[currency]];
  const f = table?.[cls];
  if (!f) return null;
  const dist = km ?? TYPICAL_KM[cls];
  if (dist == null) return null;
  return { amount: roundMoney(f(dist), currency), km: dist, how: FARE_NAMES[cls] };
}

// 걸린 시간(분)과 이동 수단으로 거리(km) 어림
export function kmFromMinutes(cls, minutes, currency) {
  const speed = COUNTRY_SPEED[COUNTRY_OF_CURRENCY[currency]]?.[cls] ?? SPEED[cls];
  return speed && minutes > 0 ? (speed * minutes) / 60 : null;
}

/* ── 날짜별 지출 ── */

/**
 * @param {Array} rows 일정표 행 [{ index, day, title, memo, mode, place, time, travel, fixed }]
 *   travel: 장소가 비고 이동 수단이 적힌 이동 행 · fixed: [고정] 행
 * @param {object} o
 * @param {(day: string) => string} o.currencyOf 그날 통화 (메모에 금액이 없을 때)
 * @param {string} [o.fixedCurrency] 사용자가 고른 현지 통화 (메모보다 앞선다)
 * @param {(index: number) => number|null} [o.legKm] 이동 행이 한 구간의 유일한 유료 이동일 때 그 구간 거리(km)
 * @param {(index: number) => ({amount, currency})|null} [o.googleFare] 구글 경로가 준 요금
 * @param {Map<number, {amount, currency, name?}>} [o.picks] 추천에서 고른 가게의 1인 가격
 * @param {Map<number, number>} [o.overrides] 사용자가 직접 고친 금액 (그날 통화)
 * @param {(amount, from, to) => number|null} [o.convert] 환율로 바꾸기 (모르면 null)
 * @returns {Array<{ day, currency, lines, total, fixed, estimated, unknown, excluded }>}
 *   lines: [{ index, kind, meal, slot, amount, min, max, currency, value, source, note, excluded }]
 *     amount는 그 줄의 통화(currency), value는 그날 통화로 바꾼 값
 *   kind: 'food' | 'transport' | 'locker' | 'ticket' | 'lodging' | 'flight'
 *   source: 'memo' | 'manual' | 'google' | 'pick' | 'estimate' | 'pass' | 'free' | 'unknown'
 */
export function dayCosts(rows, o) {
  const days = [];
  const byDay = new Map();
  for (const row of rows) {
    if (!byDay.has(row.day)) {
      const entry = { day: row.day, rows: [] };
      byDay.set(row.day, entry);
      days.push(entry);
    }
    byDay.get(row.day).rows.push(row);
  }
  return days.map(({ day, rows: dayRows }) => {
    const money = dayRows.flatMap((r) => parseMoney(`${r.title} ${r.memo}`).filter((m) => !m.optional && !m.alternative));
    const currency = o.fixedCurrency || mostCommon(money.map((m) => m.currency)) || o.currencyOf(day);
    const lines = [];
    let pass = null; // 그날 산 1일권이 태워 주는 차
    dayRows.forEach((row, i) => {
      const line = rowCost(row, dayRows, i, { ...o, currency, pass });
      if (line?.passCovers) pass = line.passCovers;
      if (line) lines.push(line);
    });
    // 다른 통화로 적은 금액은 환율로 바꿔 더한다. 환율을 모르면 '미정'으로 센다
    for (const l of lines) l.value = l.amount == null ? null : l.currency === currency ? l.amount : o.convert?.(l.amount, l.currency, currency) ?? null;
    const counted = lines.filter((l) => !l.excluded && l.value != null);
    const fixed = sum(counted.filter((l) => FIXED_SOURCES.has(l.source)));
    const estimated = sum(counted.filter((l) => !FIXED_SOURCES.has(l.source)));
    return {
      day,
      currency,
      lines,
      fixed,
      estimated,
      total: fixed + estimated,
      unknown: lines.filter((l) => !l.excluded && l.value == null).length,
      excluded: lines.filter((l) => l.excluded),
    };
  });
}

const TELL = '금액을 누르거나 메모에 적으면 더해요';
const FIXED_SOURCES = new Set(['memo', 'manual', 'google', 'pass', 'free']);
const sum = (lines) => lines.reduce((n, l) => n + l.value, 0);

export function mostCommon(list) {
  const counts = new Map();
  for (const v of list) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

// 한 행의 지출. 돈과 상관없는 행이면 null
function rowCost(row, dayRows, i, o) {
  const text = `${row.title} ${row.memo}`;
  const money = parseMoney(text);
  const main = money.find((m) => !m.optional && !m.alternative);
  const extra = money.filter((m) => m.optional && !m.alternative);
  const base = { index: row.index, currency: o.currency };
  const memoLine = (kind, more = {}) => ({
    ...base, ...more, kind, amount: main.amount, min: main.min, max: main.max, currency: main.currency, source: 'memo',
    // 범위로 적었으면 화면엔 범위를 보이고, 합계에는 가운데 값을 넣는다
    note: [
      main.range ? `가운데 ${formatMoney(roundMoney(main.amount, main.currency), main.currency)}로 셈` : '',
      extra.length ? `선택 ${extra.map((m) => m.text).join(', ')}` : '',
    ].filter(Boolean).join(' · '),
  });
  const manual = o.overrides?.get(row.index);
  const withManual = (line) => (manual != null && !line.excluded
    ? { ...line, amount: manual, min: manual, max: manual, currency: o.currency, source: 'manual', note: '' } : line);

  if (row.travel) {
    const cls = fareClass(row.mode) || fareClass(row.title);
    if (cls === 'flight' || FLIGHT_WORD.test(text)) {
      return main ? { ...memoLine('flight'), excluded: true, note: '항공권은 미리 결제해 빼요' } : null;
    }
    if (cls === 'walk') return null;
    if (main) return withManual(memoLine('transport'));
    if (cls === 'free') return { ...base, kind: 'transport', amount: 0, source: 'free', note: '무료' };
    if (o.pass && covers(o.pass, cls)) return withManual({ ...base, kind: 'transport', amount: 0, source: 'pass', note: '' });
    const google = o.googleFare?.(row.index);
    if (google) {
      return withManual({ ...base, kind: 'transport', amount: google.amount, currency: google.currency, source: 'google', note: '구글 경로 요금' });
    }
    const minutes = rowMinutes(dayRows, i);
    const byTime = kmFromMinutes(cls, minutes, o.currency);
    const byLeg = byTime == null ? o.legKm?.(row.index) ?? null : null;
    const fare = estimateFare(cls, byTime ?? byLeg, o.currency);
    if (!fare) return withManual({ ...base, kind: 'transport', amount: null, source: 'unknown', note: TELL });
    const why = byTime != null ? `${fare.how} 약 ${minutes}분` : byLeg != null ? `${fare.how} 약 ${Math.round(byLeg)}km` : `${fare.how} 기본요금`;
    return withManual({ ...base, kind: 'transport', amount: fare.amount, source: 'estimate', note: why });
  }

  if (PASS.test(row.title)) {
    const covers = /버스|bus/i.test(row.title) ? ['bus'] : /지하철|subway|metro/i.test(row.title) ? ['metro'] : ['bus', 'metro'];
    const line = main ? memoLine('transport') : { ...base, kind: 'transport', amount: null, source: 'unknown', note: TELL };
    return { ...withManual(line), passCovers: covers };
  }

  const meal = mealOf(row.title, row.time);
  if (meal) {
    const slot = isOpenSlot(row, dayRows[i - 1]);
    const pick = o.picks?.get(row.index);
    if (main) return withManual(memoLine('food', { meal, slot: false }));
    if (pick) {
      return withManual({
        ...base, kind: 'food', meal, slot, amount: pick.amount, min: pick.min, max: pick.max, currency: pick.currency, source: 'pick', note: pick.note || '고른 가게 가격대',
      });
    }
    const guess = MEAL_DEFAULTS[o.currency]?.[meal];
    return withManual({
      ...base, kind: 'food', meal, slot, amount: guess ?? null, source: guess != null ? 'estimate' : 'unknown',
      note: guess != null ? `${MEALS[meal].label} 보통 값` : TELL,
    });
  }

  if (LOCKER.test(row.title) && STORE.test(row.title)) {
    if (main) return withManual(memoLine('locker'));
    const guess = LOCKER_DEFAULTS[o.currency];
    return guess ? withManual({ ...base, kind: 'locker', amount: guess, source: 'estimate', note: '중간 크기 하루' }) : null;
  }

  if (!main) return null;
  if (LODGING.test(text)) return { ...memoLine('lodging'), excluded: true, note: '숙박비는 하루 예산에서 빼요' };
  return withManual(memoLine('ticket'));
}

function covers(pass, cls) {
  return pass.includes(cls);
}

// 가게를 아직 정하지 않은 끼니: 장소가 비었고, 예약([고정])이 아니고, 바로 앞 행의 가게("스시 쿠보타 입장" → "스시 쿠보타 오마카세 코스")도 아니다
function isOpenSlot(row, prev) {
  if (row.place || row.fixed) return false;
  if (!prev?.place || !(FOOD.test(prev.title) || /입장|예약|reservation/i.test(prev.title))) return true;
  const words = String(prev.title).split(/[\s,·:()'"]+/).filter((w) => w.length >= 2);
  return !words.some((w) => row.title.includes(w));
}

// 이동 행에 걸린 시간(분): 시간 칸이 "11:55–12:10"이면 그 차이, "~11:30"처럼 시작만 있으면 다음 시각까지
function rowMinutes(dayRows, i) {
  const { start, end } = parseTimeRange(dayRows[i].time);
  if (start == null) return null;
  if (end != null && end > start) return end - start;
  for (let j = i + 1; j < dayRows.length; j++) {
    const next = parseTimeRange(dayRows[j].time).start;
    if (next != null) return next > start ? next - start : null;
  }
  return null;
}
