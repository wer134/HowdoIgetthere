// 일정 점검: 장소 사이 이동에 잡아 둔 시간을 구글 경로 시간과 견주고,
// 모자라면 앞 일정을 줄이거나 뒤 일정을 미루는 고침안을 만든다 (엑셀 시간 칸의 시각 글자만 바꾼다)
import { cellText } from './excel.js';
import { modeFromText, parseTimeRange, timeMatches } from './routes.js';

export const FIXED_TAG = '[고정]'; // 이 표시가 있는 행(항공·예약 등)은 시각을 바꾸지 않는다
export const LUGGAGE_TAG = '[짐]'; // 이동 행에 이 표시가 있으면 짐을 들고 움직이는 구간으로 보고 여유를 더 잡는다

// 여유 정도: 구글 소요 시간에 더하는 여유
//  walk 걷는 시간 배율(짐·일행·구경) · leg 이동 행이 있는 구간마다(나설 채비·도착해서 찾기)
//  ride 탈 때마다(승강장 찾기·환승·택시 기다리기) · bag 짐을 들고 움직일 때
//  board 배차가 긴 차(특급·셔틀 등)를 타기 전 앞 일정과 띄워 둘 시간
// 이동 행 없이 붙어 있는 두 장소는 걷는 시간 배율만 쓴다 (관광지 사이를 걸을 때까지 몇 분씩 붙이면 잔소리가 된다)
export const PACES = {
  tight: { label: '빠듯하게', walk: 1, leg: 0, ride: 0, bag: 0, board: 5 },
  normal: { label: '보통', walk: 1.15, leg: 0, ride: 2, bag: 5, board: 10 },
  relaxed: { label: '여유롭게', walk: 1.3, leg: 5, ride: 5, bag: 10, board: 15 },
};

export function paceNote(pace) {
  const parts = [];
  if (pace.walk !== 1) parts.push(`걷는 시간 ${Math.round((pace.walk - 1) * 100)}% 더`);
  if (pace.leg) parts.push(`이동마다 ${pace.leg}분`);
  if (pace.ride) parts.push(`탈 때마다 ${pace.ride}분`);
  if (pace.bag) parts.push(`${LUGGAGE_TAG} 이동 ${pace.bag}분`);
  return `${parts.length ? parts.join(' · ') : '구글 소요 시간 그대로'} · 배차 긴 차 타기 전 ${pace.board}분`;
}

/* ── 배차: 놓치면 다음 차까지 얼마나 기다리나 ── */

export const LONG_HEADWAY = 20; // 이만큼(분) 넘게 기다릴 수 있는 차는 놓치면 일정이 밀린다

// 메모가 없을 때 이동 수단 글자로 짐작하는 배차(분). 앞에서부터 맞춰 보므로 '공항버스'·'셔틀버스'는 버스보다 먼저 긴 쪽으로
const HEADWAY_BY_MODE = [
  { minutes: 30, re: /특급|급행|리미티드|limited|express|공항\s*버스|에어포트|airport|리무진|limousine|고속\s*버스|시외\s*버스|셔틀|shuttle|페리|ferry|배편|선박|여객선|KTX|SRT|ITX|새마을|무궁화/i },
  { minutes: 5, re: /지하철|메트로|subway|metro|모노레일|monorail|트램|노면|tram/i },
  { minutes: 15, re: /버스|bus|전철|열차|기차|신칸센|JR|train|rail/i },
];
const EDGE_RUN = /첫\s*(?:셔틀|차|열차|버스|배|편|전철|지하철)|첫차|막차|마지막\s*(?:셔틀|차|열차|버스|배|편)/;

// 메모에 적힌 배차: "시간당 4~5대" → 15분(적게 다니는 쪽으로), "20~30분 간격" → 30분, "배차 12분", "1시간마다", "하루 6편"
function headwayFromText(text) {
  let m;
  if ((m = text.match(/시간당\s*(\d+)\s*(?:[~-]\s*\d+)?\s*(?:대|편|회|번|本)/))) return { minutes: Math.round(60 / Math.max(1, Number(m[1]))), note: m[0] };
  if ((m = text.match(/(\d+)\s*(?:[~-]\s*(\d+))?\s*분\s*(?:간격|마다|에\s*(?:한|1)\s*(?:대|편|번))/))) return { minutes: Number(m[2] || m[1]), note: m[0] };
  if ((m = text.match(/배차\s*(?:간격)?\s*(\d+)\s*(?:[~-]\s*(\d+))?\s*분/))) return { minutes: Number(m[2] || m[1]), note: m[0] };
  if ((m = text.match(/(\d+)\s*시간\s*(?:간격|마다|에\s*(?:한|1)\s*(?:대|편|번))/))) return { minutes: Number(m[1]) * 60, note: m[0] };
  if ((m = text.match(/하루\s*(\d+)\s*(?:대|편|회|번)/))) return { minutes: Math.round(720 / Math.max(1, Number(m[1]))), note: m[0] };
  return null;
}

/**
 * 차를 타는 행의 배차 짐작. 걷기·택시·항공처럼 기다릴 차가 없으면 null
 * @returns {null | {minutes: number, source: 'memo'|'mode', note: string, edge: string}}
 *   source memo: 행에 적힌 배차 / mode: 이동 수단 글자로 짐작 · note 근거 글자 · edge 첫차·막차 표시
 */
export function headwayOf(record, modeCol) {
  const mode = modeCol >= 0 ? cellText(record?.cells[modeCol]) : '';
  if (!mode || modeFromText(mode) === 'FLIGHT') return null;
  const byMode = HEADWAY_BY_MODE.find((h) => h.re.test(mode));
  if (!byMode) return null;
  const text = record.cells.map(cellText).filter(Boolean).join(' ');
  const edge = text.match(EDGE_RUN)?.[0] || '';
  const memo = headwayFromText(text);
  return memo
    ? { minutes: memo.minutes, source: 'memo', note: memo.note, edge }
    : { minutes: byMode.minutes, source: 'mode', note: mode.match(byMode.re)[0], edge };
}

/**
 * 놓치면 오래 기다리는 차(배차가 길거나, 첫차·막차, [고정])를 타기 전에 앞 일정과 여유가 모자란 곳.
 * 여유 = 차가 떠나는 시각 - 같은 날 바로 앞 행이 끝나는 시각
 * @param {{time: number, mode: number, date: number, name: number}} cols
 * @param {object} pace PACES 중 하나 (board만 쓴다)
 * @returns {Array<{index: number, prev: number, dayStart: number, headway: object, start: number,
 *   margin: number, need: number, short: number, step: number, fixed: boolean}>}
 */
export function boardingRisks(records, cols, pace) {
  if (cols.time < 0 || cols.mode < 0) return [];
  const time = (i) => parseTimeRange(cellText(records[i].cells[cols.time]));
  const risks = [];
  let day = null;
  let dayStart = 0;
  let prev = null;
  for (let i = 0; i < records.length; i++) {
    const dayText = cols.date >= 0 ? cellText(records[i].cells[cols.date]) : '';
    if (dayText && dayText !== day) {
      day = dayText;
      dayStart = i;
      prev = null;
    }
    const t = time(i);
    if (t.start == null) continue;
    const headway = isTravelRow(records[i], cols) ? headwayOf(records[i], cols.mode) : null;
    const fixed = hasTag(records[i]);
    if (headway && prev != null && (headway.minutes >= LONG_HEADWAY || headway.edge || fixed)) {
      const margin = t.start - time(prev).end;
      const short = pace.board - margin;
      if (short > 0) {
        risks.push({ index: i, prev, dayStart, headway, start: t.start, margin, need: pace.board, short, step: Math.ceil(short / STEP) * STEP, fixed });
      }
    }
    prev = i;
  }
  return risks;
}

/**
 * 차를 타기 전 여유를 만들도록 앞 일정을 당긴다.
 * 바로 앞이 걷는 이동 행이면 걸리는 시간은 두고 통째로 당기고, 그 앞 일정의 끝을 줄인다
 * @returns {{label: string, row: number|null, before: string, after: string, changes: Array, blocked: string}}
 */
export function boardingFix(records, risk, cols, lockOf = () => '') {
  const text = (i) => cellText(records[i].cells[cols.time]);
  const time = (i) => parseTimeRange(text(i));
  const step = risk.step;
  const label = `앞 일정 ${step}분 당기기`;
  const changes = [];
  const stop = (blocked) => ({ label, row: null, before: '', after: '', changes, blocked });
  for (let i = risk.prev; i >= risk.dayStart; i--) {
    const t = time(i);
    if (t.start == null) continue;
    if (isTravelRow(records[i], cols)) {
      // 앞에도 탈 차가 있으면 당기려면 더 이른 차를 타야 하므로 여기서는 고치지 않는다
      if (headwayOf(records[i], cols.mode)) return stop('앞에 탈 차가 있어 더 이른 차를 타야 해요');
      changes.push({ index: i, ...rewrite(text(i), isRange(t) ? { start: t.start - step, end: t.end - step } : { start: t.start - step }) });
      continue;
    }
    if (!isRange(t)) return stop('앞 일정에 도착 시각만 있어 당길 수 없어요');
    // 고침안 버튼에는 끝이 줄어드는 일정을 보여 준다 (당겨지는 이동 행은 함께 바뀐다)
    const main = { index: i, ...rewrite(text(i), { end: t.end - step }) };
    const all = [main, ...changes];
    const blocked = all.map((c) => lockOf(c.index)).find(Boolean)
      || (t.end - step - t.start < MIN_ACTIVITY ? '줄일 만큼 일정이 길지 않아요' : '');
    return { label, row: i, before: text(i), after: main.text, changes: all, blocked };
  }
  return stop('당길 수 있는 앞 일정이 없어요');
}
const STEP = 5; // 고칠 때는 5분 단위로
const MIN_ACTIVITY = 5; // 줄이거나 미뤄도 남겨 둘 일정 길이(분)
// 알리는 기준(분). 구글 도보 시간은 넉넉하게 나오는 편이라, 몇 분 차이까지 모두 알리면 잔소리가 된다
const TIGHT = 4; // 이동 행에 잡은 시간보다 이만큼 더 걸리면 알린다
const TIGHT_FIXED = 1; // 도착지가 [고정] 일정(예약 등)이면 1분이라도
const NO_GAP = 15; // 이동 행 없이 붙어 있는 두 장소는 이만큼 걸릴 때만 (가까운 곳끼리는 일정 안에서 걷는다고 본다)
const DAY_END = 24 * 60;

const isRange = (t) => t.start != null && t.end > t.start;

export function hasTag(record, tag = FIXED_TAG) {
  return Boolean(record?.cells.some((cell) => cellText(cell).includes(tag)));
}

// 이동 행 = 장소 칸이 비어 있고 이동 수단이 적힌 행.
// 장소 행의 이동 수단(예: 다케가와라 온천 · "도보 10분")은 그곳까지 가는 방법이라 이동 행이 아니다
function isTravelRow(record, cols) {
  const text = (col) => (col >= 0 ? cellText(record?.cells[col]) : '');
  return Boolean(text(cols.mode)) && !text(cols.name ?? -1);
}

/**
 * 두 장소 행 사이에 잡아 둔 이동 계획.
 * 이동 행 = 두 장소 사이에서 이동 수단 칸이 채워진 행. 그사이에 낀 다른 일정(짐 찾기·점심 등)의 시간은 이동 시간에서 뺀다
 * @param {Array} records 시트의 데이터 행
 * @param {number} from 출발 장소 행 (records 번호)
 * @param {number} to 도착 장소 행
 * @param {{time: number, mode: number, name?: number}} cols 시간·이동 수단·장소 열 (없으면 -1)
 * @returns {{travel: number[], start: number|null, end: number|null, planned: number|null, explicit: boolean}}
 *   travel 이동 행 · start~end 이동에 쓸 수 있는 시각(분) · planned 그중 이동에 쓰는 분 · explicit 이동 행이 있는지
 */
export function travelPlan(records, from, to, cols) {
  const text = (i, col) => (col >= 0 ? cellText(records[i]?.cells[col]) : '');
  const time = (i) => parseTimeRange(text(i, cols.time));
  const between = [];
  for (let i = from + 1; i < to; i++) between.push(i);
  const travel = between.filter((i) => isTravelRow(records[i], cols));
  const explicit = travel.length > 0;
  const none = { travel, start: null, end: null, planned: null, explicit };
  if (cols.time < 0) return none;

  // 앞 장소 일정이 끝난 때부터 (시각 하나만 적혔으면 그때)
  const start = time(from).end ?? (explicit ? time(travel[0]).start : null);
  let end = null;
  if (explicit) {
    const lastIndex = travel[travel.length - 1];
    const last = time(lastIndex);
    if (isRange(last)) end = last.end;
    // "~14:30"처럼 시각 하나만 적힌 이동 행은 다음 행이 시작할 때 도착한 것으로 본다
    for (let i = lastIndex + 1; end == null && i <= to; i++) end = time(i).start;
  } else {
    end = time(to).start;
  }
  if (start == null || end == null || end < start) return none;

  let busy = 0;
  for (const i of between) {
    if (travel.includes(i)) continue;
    const t = time(i);
    if (isRange(t)) busy += Math.max(0, Math.min(t.end, end) - Math.max(t.start, start));
  }
  return { travel, start, end, planned: end - start - busy, explicit };
}

/**
 * 구글 소요 시간에 여유를 더한 필요 시간(분). base는 화면에 보이는 구글 소요 시간과 같게 반올림한다
 * @param {object} route 찾은 경로
 * @param {object} plan travelPlan 결과 (이동 행이 있는 구간만 이동마다 여유를 더한다)
 * @param {object} pace PACES 중 하나
 * @param {boolean} luggage 짐을 들고 움직이는 구간인지
 * @returns {{base: number, need: number}}
 */
export function neededMinutes(route, plan, pace = PACES.tight, luggage = false) {
  const walkMs = route.segments.filter((s) => s.kind === 'walk').reduce((sum, s) => sum + (s.duration || 0), 0);
  const rides = route.segments.filter((s) => s.kind === 'transit').length + (route.segments.some((s) => s.kind === 'drive') ? 1 : 0);
  const extra = ((pace.walk - 1) * walkMs) / 60000 + rides * pace.ride + (plan.explicit ? pace.leg : 0) + (luggage ? pace.bag : 0);
  return { base: Math.round(route.duration / 60000), need: Math.round(route.duration / 60000 + extra) };
}

/**
 * 잡아 둔 이동 시간이 (여유를 더한) 구글 경로 시간보다 모자란지.
 * @param {object} plan travelPlan 결과
 * @param {object|null} route 찾은 경로 (routes.js computeLeg 결과)
 * @param {string[]} modeTexts 이동 행들의 이동 수단 글자
 * @param {{strict?: boolean, pace?: object, luggage?: boolean}} options
 *   strict 도착지가 [고정] 일정이라 조금만 모자라도 알린다 · pace 여유 정도 · luggage 짐을 들고 움직이는 구간
 * @returns {null | {kind: 'tight'|'nogap', base: number, need: number, planned: number, short: number, step: number}}
 *   tight 이동 행에 잡은 시간이 모자람 · nogap 이동 시간이 일정에 없음 · base 구글 소요 시간 · need 여유를 더한 시간
 *   step 확보할 분(5분 단위)
 */
export function checkTravel(plan, route, modeTexts = [], { strict = false, pace = PACES.tight, luggage = false } = {}) {
  if (!route || !plan || plan.planned == null) return null;
  // 걸어서 찾은 길(대중교통 경로가 없어 대신 찾은 길 포함)을 차·대중교통 계획과 견주지는 않는다
  const walkOnly = route.segments.every((s) => s.kind === 'walk');
  if (walkOnly && modeTexts.some((t) => (modeFromText(t) || 'WALKING') !== 'WALKING')) return null;
  const { base, need } = neededMinutes(route, plan, pace, luggage);
  const short = need - plan.planned;
  if (short < (strict ? TIGHT_FIXED : plan.explicit ? TIGHT : NO_GAP)) return null;
  return { kind: plan.explicit ? 'tight' : 'nogap', base, need, planned: plan.planned, short, step: Math.ceil(short / STEP) * STEP };
}

/**
 * 모자란 시간을 확보하는 고침안: 앞 일정을 줄여 일찍 출발하거나, 뒤 일정을 미뤄 늦게 도착한다.
 * @param {(index: number) => string} lockOf 그 행의 시각을 고칠 수 없는 까닭 (고칠 수 있으면 '')
 * @returns {Array<{key: string, label: string, row: number, before: string, after: string,
 *   changes: Array<{index: number, text: string, minutes: number|null}>, blocked: string}>}
 */
export function fixOptions(records, plan, from, to, step, cols, lockOf = () => '') {
  const text = (i) => cellText(records[i]?.cells[cols.time]);
  const time = (i) => parseTimeRange(text(i));
  const travelSet = new Set(plan.travel);
  const firstTravel = plan.travel[0] ?? null;
  const lastTravel = plan.travel[plan.travel.length - 1] ?? null;
  const change = (index, edit) => ({ index, ...rewrite(text(index), edit) });
  const firstLock = (changes) => changes.map((c) => lockOf(c.index)).find(Boolean) || '';
  const options = [];

  // 앞 일정 줄이기: 이동 바로 앞에서 끝나는 일정 (앞 장소, 또는 그 뒤에 낀 짐 찾기·점심)
  let prev = null;
  for (let i = (firstTravel ?? to) - 1; prev == null && i >= from; i--) {
    if (!travelSet.has(i) && isRange(time(i))) prev = i;
  }
  if (prev != null) {
    const t = time(prev);
    const newEnd = t.end - step;
    const changes = [change(prev, { end: newEnd })];
    // 이동 행이 앞 일정이 끝날 때 출발하게 적혀 있으면 출발 시각도 함께 당긴다
    if (firstTravel != null && time(firstTravel).start === t.end) changes.push(change(firstTravel, { start: newEnd }));
    options.push({
      key: 'before',
      label: `앞 일정 ${step}분 줄이기`,
      row: prev,
      before: text(prev),
      after: changes[0].text,
      changes,
      blocked: firstLock(changes) || (newEnd - t.start < MIN_ACTIVITY ? '줄일 만큼 일정이 길지 않아요' : ''),
    });
  }

  // 뒤 일정 미루기: 이동이 끝나고 처음 시작하는 일정 (휴식 등), 이동 행이 없으면 도착 장소
  let next = plan.explicit ? null : to;
  for (let i = (lastTravel ?? to) + 1; next == null && i <= to; i++) {
    if (time(i).start != null) next = i;
  }
  if (next != null && next !== prev && time(next).start != null) {
    const t = time(next);
    const newStart = t.start + step;
    const changes = [change(next, { start: newStart })];
    const lt = lastTravel != null ? time(lastTravel) : null;
    // 이동 행 끝 시각이 다음 일정 시작과 같게 적혀 있으면 함께 늦춘다
    if (lt && isRange(lt) && lt.end === t.start) changes.push(change(lastTravel, { end: newStart }));
    // 시각 하나만 적힌 일정(예: 18:25 입장)을 미룰 때는 그다음 행과 겹치지 않아야 한다
    const following = next + 1 < records.length ? time(next + 1).start : null;
    let blocked = firstLock(changes);
    if (!blocked && newStart >= DAY_END) blocked = '자정을 넘겨요';
    if (!blocked && isRange(t) && t.end - newStart < MIN_ACTIVITY) blocked = '미룰 만큼 일정이 길지 않아요';
    if (!blocked && !isRange(t) && following != null && following < newStart) blocked = '다음 일정과 겹쳐요';
    options.push({
      key: 'after', label: `뒤 일정 ${step}분 미루기`, row: next, before: text(next), after: changes[0].text, changes, blocked,
    });
  }
  return options;
}

function rewrite(text, edit) {
  const out = shiftTimeText(text, edit);
  const times = timeMatches(out);
  // 시각이 하나뿐이면 엑셀 시간 값(숫자) 칸에도 그대로 쓸 수 있게 분으로도 돌려준다
  return { text: out, minutes: times.length === 1 ? times[0].minutes : null };
}

const pad2 = (n) => String(n).padStart(2, '0');

// 시작(첫 시각)이나 끝(마지막 시각)만 바꾸고, 구분 기호·물결표·오전/오후 같은 나머지 글자는 그대로 둔다
// 예: ("17:40–17:55", { start: 17*60+30 }) → "17:30–17:55"
export function shiftTimeText(text, { start, end } = {}) {
  const source = String(text ?? '');
  const times = timeMatches(source);
  if (!times.length) return source;
  const target = new Map();
  if (start != null) target.set(times[0], start);
  if (end != null) target.set(times[times.length - 1], end);
  let out = '';
  let pos = 0;
  for (const t of times) {
    if (!target.has(t)) continue;
    out += source.slice(pos, t.match.index) + formatLike(t.match, target.get(t));
    pos = t.match.index + t.match[0].length;
  }
  return out + source.slice(pos);
}

// 원래 적힌 모양(시 자릿수, 오전/오후·AM/PM)을 따라 새 시각을 쓴다
function formatLike(match, minutes) {
  const total = ((minutes % DAY_END) + DAY_END) % DAY_END;
  let h = Math.floor(total / 60);
  let s = match[0];
  const marker = match[1] || match[4];
  if (marker) {
    const pm = h >= 12;
    const word = /오전|오후/.test(marker) ? (pm ? '오후' : '오전') : (pm ? 'PM' : 'AM');
    s = s.replace(marker, marker === marker.toLowerCase() ? word.toLowerCase() : word);
    h = h % 12 || 12;
  }
  return s.replace(/\d{1,2}:\d{2}/, `${match[2].length === 2 ? pad2(h) : h}:${pad2(total % 60)}`);
}
