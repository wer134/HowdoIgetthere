// 장소 사이 이동 경로 (Routes API — Maps JavaScript API의 Route 클래스)
import { createStore } from './util.js';
import { CACHE_TTL, withRetry } from './places.js';

// 경로를 그리는 데 필요한 것만 요청한다. 대중교통·도보·차 모두 Compute Routes Essentials 등급
// (travelAdvisory는 대중교통 요금용. 통행료는 따로 요청해야 셈하므로 등급이 오르지 않는다)
const ROUTE_FIELDS = ['path', 'legs', 'distanceMeters', 'durationMillis', 'localizedValues', 'travelAdvisory'];
const DAY = 24 * 60 * 60 * 1000;

const store = createStore('routesCache.v2', CACHE_TTL); // v2: 대중교통 요금을 함께 저장
const inflight = new Map();

export const MODES = {
  TRANSIT: '대중교통',
  WALKING: '도보',
  DRIVING: '차',
  BICYCLING: '자전거',
  FLIGHT: '항공', // 경로를 찾지 않고 직선으로 잇는다
};

// 일정표 '이동 수단' 칸의 글자로 경로 방식을 정한다. 알 수 없으면 null
export function modeFromText(text) {
  const s = String(text ?? '');
  if (!s.trim()) return null;
  if (/항공|비행기|flight|plane/i.test(s)) return 'FLIGHT';
  // 호텔 셔틀은 대중교통 시간표에 없으므로 차 경로로 대신한다
  if (/셔틀|택시|자동차|렌터카|렌트카|자차|차량|차로|taxi|car\b|drive/i.test(s)) return 'DRIVING';
  if (/자전거|bike|bicycle|cycle/i.test(s)) return 'BICYCLING';
  if (/지하철|버스|전철|열차|기차|KTX|SRT|ITX|무궁화|새마을|JR|신칸센|특급|급행|모노레일|트램|노면|페리|배편|선박|subway|metro|bus|train|rail|tram|ferry/i.test(s)) return 'TRANSIT';
  if (/도보|걸어|걷|walk/i.test(s)) return 'WALKING';
  return null;
}

export function distanceMeters(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// 글자 속 시각들과 그 위치. 일정 점검에서 시각 한 곳만 고쳐 쓸 때도 쓴다
export function timeMatches(text) {
  return [...String(text ?? '').matchAll(/(오전|오후|AM|PM)?\s*(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)\s*(AM|PM)?/gi)]
    .map((match) => {
      let h = Number(match[2]);
      const min = Number(match[3] || match[4] || 0);
      const ampm = (match[1] || match[5] || '').toUpperCase();
      if ((ampm === 'PM' || ampm === '오후') && h < 12) h += 12;
      if ((ampm === 'AM' || ampm === '오전') && h === 12) h = 0;
      return { match, minutes: h < 24 && min < 60 ? h * 60 + min : null };
    })
    .filter((t) => t.minutes != null);
}

// "13:20–13:35" → 시작 800분, 끝 815분 / "~14:30", "오후 2:30" 같은 표기도 읽는다
export function parseTimeRange(text) {
  const minutes = timeMatches(text).map((t) => t.minutes);
  return { start: minutes[0] ?? null, end: minutes.length ? minutes[minutes.length - 1] : null };
}

// "11/29 (일)", "2026-11-29", "2026.11.29", "11월 29일", 엑셀 날짜 칸 → 그날 0시 (이 컴퓨터 시간대)
export function parseDay(cell, now = new Date()) {
  if (!cell) return null;
  const text = String(cell.w ?? (cell.v instanceof Date ? '' : cell.v ?? ''));
  let y; let mo; let d; let m;
  if ((m = text.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/))) [y, mo, d] = m.slice(1).map(Number);
  else if ((m = text.match(/(\d{1,2})\s*[/.월]\s*(\d{1,2})/))) [mo, d] = m.slice(1).map(Number);
  else if (cell.v instanceof Date) [y, mo, d] = [cell.v.getFullYear(), cell.v.getMonth() + 1, cell.v.getDate()];
  else return null;
  if (!y) {
    // 연도가 없으면 다가오는 날짜로 본다 (지난 지 일주일이 넘었으면 내년)
    y = now.getFullYear();
    if (new Date(y, mo - 1, d).getTime() < now.getTime() - 7 * DAY) y += 1;
  }
  const date = new Date(y, mo - 1, d);
  return date.getMonth() === mo - 1 ? date : null;
}

// 대중교통 경로는 7일 전 ~ 100일 뒤 시각만 찾을 수 있다. 벗어나면 같은 요일·시각의 가장 가까운 날로 옮긴다
function clampTransitTime(date, now) {
  if (date.getTime() >= now.getTime() - 6 * DAY && date.getTime() <= now.getTime() + 99 * DAY) return date;
  const shifted = new Date(now.getFullYear(), now.getMonth(), now.getDate(), date.getHours(), date.getMinutes());
  while (shifted.getDay() !== date.getDay() || shifted < now) shifted.setDate(shifted.getDate() + 1);
  return shifted;
}

/**
 * 구간의 출발(또는 도착) 시각을 일정표에서 고른다.
 * 1) 두 장소 사이 이동 행의 시작 시각 → 출발  2) 앞 장소의 끝 시각 → 출발
 * 3) 뒤 장소의 시작 시각 → 도착  4) 그날 10시 출발
 */
export function legTiming({ day, betweenTimes = [], fromTime, toTime, now = new Date() }) {
  const at = (minutes) => {
    const d = day ? new Date(day) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    if (!day && d < now) d.setDate(d.getDate() + 1);
    return clampTransitTime(d, now);
  };
  for (const text of betweenTimes) {
    const { start } = parseTimeRange(text);
    if (start != null) return { departureTime: at(start) };
  }
  const from = parseTimeRange(fromTime);
  if (from.end != null) return { departureTime: at(from.end) };
  const to = parseTimeRange(toTime);
  if (to.start != null) return { arrivalTime: at(to.start) };
  return { departureTime: at(10 * 60) };
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;
const point = (p) => (typeof p.lat === 'function' ? [round5(p.lat()), round5(p.lng())] : [round5(p.lat), round5(p.lng)]);

function cacheKey({ mode, origin, destination, departureTime, arrivalTime, language, region }) {
  const ll = (p) => `${round5(p.lat)},${round5(p.lng)}`;
  // 대중교통만 시각에 따라 결과가 달라진다
  const time = mode !== 'TRANSIT' ? '' : arrivalTime ? `a${+arrivalTime}` : departureTime ? `d${+departureTime}` : '';
  return [mode, ll(origin), ll(destination), time, language, region].join('|');
}

export function isRouteCached(options) {
  return store.has(cacheKey(options));
}

export function clearRouteCache() {
  store.clear();
}

/** 한 구간의 경로. 못 찾으면 null */
export async function computeLeg(options) {
  const key = cacheKey(options);
  if (store.has(key)) return store.get(key);
  if (!inflight.has(key)) {
    inflight.set(key, fetchLeg(options, key).finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

async function fetchLeg({ mode, origin, destination, departureTime, arrivalTime, language, region }, key) {
  const { Route } = await google.maps.importLibrary('routes');
  const request = { origin, destination, travelMode: mode, fields: ROUTE_FIELDS };
  if (language) request.language = language;
  if (region) request.region = region;
  if (mode === 'TRANSIT') {
    if (arrivalTime) request.arrivalTime = arrivalTime;
    else if (departureTime) request.departureTime = departureTime;
  }
  const { routes } = await withRetry(() => Route.computeRoutes(request));
  const result = routes?.[0] ? simplify(routes[0], mode) : null;
  store.set(key, result); // 못 찾은 결과도 저장해 같은 요청을 반복하지 않는다
  return result;
}

// 지도에 그리고 목록에 보여 줄 만큼만 추린다: 도보 구간은 합치고, 대중교통은 노선별로 나눈다
function simplify(route, mode) {
  const leg = route.legs?.[0];
  const segments = [];
  for (const step of leg?.steps || []) {
    const path = (step.path || []).map(point);
    const td = step.transitDetails;
    if (td) {
      const line = td.transitLine || {};
      segments.push({
        kind: 'transit',
        path,
        duration: td.arrivalTime && td.departureTime ? td.arrivalTime - td.departureTime : step.staticDurationMillis || 0,
        line: line.shortName || line.name || line.vehicle?.name || '',
        lineName: line.name || '',
        vehicle: line.vehicle?.name || '',
        color: line.color || '',
        textColor: line.textColor || '',
        from: td.departureStop?.name || '',
        to: td.arrivalStop?.name || '',
        dep: td.departureTime ? +td.departureTime : null,
        arr: td.arrivalTime ? +td.arrivalTime : null,
        stops: td.stopCount || 0,
        headsign: td.headsign || '',
      });
      continue;
    }
    const kind = mode === 'TRANSIT' || mode === 'WALKING' || /WALK/i.test(step.travelMode || '') ? 'walk'
      : mode === 'BICYCLING' ? 'bike' : 'drive';
    const last = segments[segments.length - 1];
    if (last && last.kind === kind) {
      last.path.push(...path);
      last.duration += step.staticDurationMillis || 0;
      last.distance += step.distanceMeters || 0;
    } else {
      segments.push({ kind, path, duration: step.staticDurationMillis || 0, distance: step.distanceMeters || 0 });
    }
  }
  if (!segments.length || segments.every((s) => s.path.length < 2)) {
    segments.length = 0;
    segments.push({
      kind: mode === 'TRANSIT' ? 'transit' : mode === 'WALKING' ? 'walk' : mode === 'BICYCLING' ? 'bike' : 'drive',
      path: (route.path || []).map(point),
      duration: route.durationMillis || 0,
      distance: route.distanceMeters || 0,
    });
  }
  return {
    mode,
    fare: fareOf(route.travelAdvisory?.transitFare),
    distance: route.distanceMeters ?? leg?.distanceMeters ?? 0,
    duration: route.durationMillis ?? leg?.durationMillis ?? 0,
    durationText: route.localizedValues?.duration || '',
    distanceText: route.localizedValues?.distance || '',
    segments,
  };
}

// 구글이 모든 구간의 요금을 알 때만 대중교통 요금을 준다 (한국·영국 등. 일본은 대중교통 경로 자체가 없다)
function fareOf(money) {
  if (!money?.currencyCode || money.units == null) return null;
  return { amount: Number(money.units) + Number(money.nanos || 0) / 1e9, currency: money.currencyCode };
}
