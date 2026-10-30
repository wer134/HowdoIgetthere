import { validTravel } from './travel-store.js';
import { escapeHtml } from './util.js';

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const pointFields = ['id','name','address','url','memo','lat','lng','type','types','cachedAt'];
function portablePlace(p, updated) {
  const result = Object.fromEntries(pointFields.filter(k => p[k] != null).map(k => [k, p[k]]));
  if (p.id && !result.cachedAt) result.cachedAt = updated;
  return result;
}
function portableTravel(snapshot) {
  if (!validTravel(snapshot)) throw new Error('여행 데이터 형식을 확인해 주세요.');
  return {
    id:snapshot.id, name:snapshot.name, updated:snapshot.updated,
    headers:snapshot.headers, mapping:snapshot.mapping,
    records:snapshot.records.map(r => ({rowNumber:r.rowNumber,cells:r.cells.map(c => c == null ? null : {t:c.t,v:c.v,...(c.w == null ? {} : {w:c.w})})})),
    library:(snapshot.library || []).map(p => portablePlace(p,snapshot.updated)),
    dates:snapshot.dates || [], region:snapshot.region || '', sheetName:snapshot.sheetName || '일정',
    places:(snapshot.places || []).map(e => ({recordIndex:e.recordIndex,status:e.status,cachedAt:e.cachedAt || snapshot.updated,place:portablePlace(e.place,snapshot.updated)})),
  };
}
export function encodeTravelBackup(snapshot) {
  return JSON.stringify({format:'routeflow.travel',version:1,travel:portableTravel(snapshot)},null,2);
}
export function decodeTravelBackup(text, {id, now=Date.now()} = {}) {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('백업 파일은 20MB 이하로 선택해 주세요.');
  let envelope;
  try { envelope = JSON.parse(text); } catch { throw new Error('백업 파일을 읽을 수 없어요. RouteFlow에서 받은 백업인지 확인해 주세요.'); }
  if (envelope?.format !== 'routeflow.travel' || envelope.version !== 1) throw new Error('지원하는 RouteFlow 백업 형식이 아닙니다.');
  const snapshot = portableTravel(envelope.travel);
  if (!id || id === snapshot.id) throw new Error('복원할 여행의 새 ID가 필요합니다.');
  snapshot.id = id;
  snapshot.name = `${snapshot.name} (복원본)`;
  snapshot.updated = now;
  if (!validTravel(snapshot)) throw new Error('복원할 여행 데이터가 손상됐어요.');
  return snapshot;
}
const cell = (row, index) => index >= 0 ? String(row.cells[index]?.v ?? '') : '';
export function itineraryContent(snapshot) {
  if (!validTravel(snapshot)) throw new Error('일정표를 만들 수 없는 여행 데이터입니다.');
  const m = snapshot.mapping;
  const dayOf = r => cell(r,m.date) || cell(r,m.category) || '날짜 미정';
  const days = [...new Set([...(snapshot.dates || []),...snapshot.records.map(dayOf)])];
  return `<header><p class="eyebrow">RouteFlow · 나의 여행 일정</p><h1>${escapeHtml(snapshot.name)}</h1><p>${days.length}일 · ${snapshot.records.length}곳</p></header>${days.map((day,i) => {
    const rows = snapshot.records.filter(r => dayOf(r) === day);
    return `<section class="itinerary-day"><h2>Day ${i+1} <span>${escapeHtml(day)}</span></h2>${rows.length ? `<ol>${rows.map(r => `<li><span class="itinerary-time">${escapeHtml(cell(r,m.time) || '시간 미정')}</span><div><h3>${escapeHtml(cell(r,m.name))}</h3>${cell(r,m.address) || cell(r,m.region) ? `<p>${escapeHtml(cell(r,m.address) || cell(r,m.region))}</p>` : ''}${cell(r,m.memo) ? `<p class="itinerary-memo">${escapeHtml(cell(r,m.memo))}</p>` : ''}</div></li>`).join('')}</ol>` : '<p class="itinerary-free">아직 정한 일정이 없는 날이에요.</p>'}</section>`;
  }).join('')}${snapshot.library?.length ? `<section class="itinerary-day"><h2>가고 싶은 곳 <span>${snapshot.library.length}곳</span></h2><ul>${snapshot.library.map(p => `<li><div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.address || '')}</p>${p.memo ? `<p class="itinerary-memo">${escapeHtml(p.memo)}</p>` : ''}</div></li>`).join('')}</ul></section>` : ''}<footer>영업시간·예약·실제 이동 시간은 방문 전에 확인하세요.</footer>`;
}
export const ITINERARY_CSS = `body{margin:0;background:#f3f6fa;color:#182c4c;font:16px/1.6 system-ui,sans-serif}main{max-width:760px;margin:24px auto;padding:32px;background:white;border-radius:16px}h1{font-size:30px;overflow-wrap:anywhere}.eyebrow{color:#215fe5;font-weight:700}h2{font-size:20px;border-bottom:2px solid #215fe5;padding-bottom:8px}h2 span{font-size:14px;font-weight:400;margin-left:12px;color:#526079}ol,ul{padding:0;list-style:none}li{display:flex;gap:20px;padding:16px 0;border-bottom:1px solid #e5eaf2;break-inside:avoid;overflow-wrap:anywhere}li div{min-width:0;flex:1}.itinerary-time{flex:none;width:116px;font-size:14px;color:#215fe5}h3,p{margin:0 0 6px}h3{font-size:18px}.itinerary-memo{white-space:pre-wrap;color:#384a65}.itinerary-day{margin:28px 0}.itinerary-free,footer{color:#526079}footer{border-top:1px solid #e5eaf2;padding-top:20px;font-size:13px}@media(max-width:500px){main{margin:0;padding:20px;border-radius:0}li{gap:10px;flex-direction:column}.itinerary-time{width:auto}}@media print{body{background:white}main{margin:0;padding:0;max-width:none}h2{break-after:avoid}footer{font-size:10pt}@page{size:A4;margin:16mm}}`;
export function itineraryDocument(snapshot) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(snapshot.name)} · 여행 일정표</title><style>${ITINERARY_CSS}</style></head><body><main>${itineraryContent(snapshot)}</main></body></html>`;
}
