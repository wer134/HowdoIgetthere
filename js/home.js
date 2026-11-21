import { examples } from './examples.js';

const $ = id => document.getElementById(id);
const icons = {
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  flag: '<path d="M5 21V4c5-4 9 4 14 0v9c-5 4-9-4-14 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1"/>',
  map: '<path d="m3 5 6-2 6 3 6-2v15l-6 2-6-3-6 2Zm6-2v15m6-12v15"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.1"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  walk: '<circle cx="13" cy="4" r="1.5"/><path d="m5 13 4-2 2-4 3 1 2 4 3 1M11 9l-1 6 4 3 2 4M10 15l-4 6"/>',
  train: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 10h14M8 18l-2 3m10-3 2 3M9 14h.1m5.9 0h.1"/>',
};
const icon = name => '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + icons[name] + '</svg>';
document.querySelectorAll('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });

const initial = new URL(location.href);
const hasCity = id => Object.hasOwn(examples, id);
let cityId = hasCity(initial.searchParams.get('city')) ? initial.searchParams.get('city') : 'busan';
let selection = { type: 'stop', index: 0 };
let session = { available: false, user: null };
let dialogIntent, liveView, mapLoading = false, showLive = false, copying = false;
const city = () => examples[cityId];
const pendingKey = 'routeflow.homeIntent.v1';
function readPending() {
  try { return JSON.parse(sessionStorage.getItem(pendingKey)); } catch { return null; }
}
function notice(text) { $('homeStatus').textContent = text; $('homeStatus').hidden = !text; }

// The diagrams intentionally simplify geography. Numbered lines show visit order, not navigable roads.
const mapArt = {
  busan: {
    land: 'M-300 -260H1040V145Q913 165 831 156Q776 145 705 147L670 157 659 181 626 177 620 195 600 183 595 165Q557 133 499 159L461 177 448 207 423 210Q372 216 329 243Q271 275 197 280L156 275Q129 281 137 309Q145 333 124 352Q106 365 80 348L58 327Q49 305 65 279L48 261 -30 277 -300 297Z',
    parks: ['M58 278Q84 272 110 287T133 319L125 343 109 352 76 334Q57 313 58 278Z','M462 165Q496 105 547 89Q594 66 672 77L710 144 657 151 618 164 560 144Z','M-42 -20Q48 89 151 61T338 -29Z'],
    roads: ['M-90 216Q60 181 148 202T348 191Q478 162 522 134T783 95','M-65 133Q92 127 177 161T356 141L473 75Q518 48 680 52','M-25 245Q84 214 155 236T346 209Q414 184 450 171','M24 -44Q41 65 103 123T163 259','M235 -24Q244 61 292 101T375 199','M444 -29Q415 32 430 65T476 134'],
    labels: [[130,150,'우동'],[325,112,'중동'],[522,113,'달맞이길'],[627,50,'청사포']],
    water: [418,332,'수 영 만'], shore: 'M161 278Q247 295 344 242', route: ['M95 308Q116 300 129 282T182 267Q224 269 259 250','M259 250Q311 240 346 221T433 200','M433 200Q470 170 504 166T558 153Q592 147 625 165'],
  },
  seoul: {
    land: '', parks: ['M-50 -50H208L237 70 182 199 84 203 21 89Z','M388 -20 479 69 561 75 585 -30Z','M497 32 681 17 703 131 655 161 617 144 550 151Z'],
    roads: ['M-90 211Q96 209 123 236L383 214 601 201 820 196','M-50 320 209 303 431 292 790 278','M121 0 128 136 120 236 109 476','M236 -20 265 116 264 225 293 470','M502 -30 447 127 439 213 462 297 475 475','M-10 393 242 384 422 366 840 352'],
    labels: [[128,105,'경복궁'],[351,86,'북촌'],[565,234,'익선동'],[158,317,'종로']],
    river: 'M-100 407Q119 389 251 377T491 358Q590 350 843 338', water: [565,385,'청 계 천'],
  },
  tokyo: {
    land: '', parks: ['M268 66 309 71 314 143 291 222 267 240 247 228 268 168Z','M351 127 418 136 444 181 417 200 365 181Z','M68 81 162 83 173 159 77 169Z'],
    roads: ['M-44 250 178 238 253 201 324 174 520 236 791 253','M-20 344 169 331 226 301 330 285 440 257 738 321','M61 -24 102 170 109 269 137 484','M466 -30 454 99 484 223 512 445','M640 -30 548 105 593 249 656 457'],
    labels: [[95,97,'아사쿠사'],[203,369,'가미나리몬'],[548,125,'무코지마'],[616,373,'오시아게']],
    river: 'M337 -65Q386 75 335 173T281 301Q286 388 213 493', water: [339,81,'스미다강'],
  },
};
const path = (d, attrs = '') => '<path d="' + d + '" ' + attrs + '/>';
function diagram() {
  const c = city(), a = mapArt[cityId], land = a.land || 'M-300 -250H1040V670H-300Z';
  const roads = a.roads.map(d => path(d)).join('');
  const river = a.river ? path(a.river, 'fill="none" stroke="#c2dfeb" stroke-width="' + (cityId === 'tokyo' ? 40 : 12) + '"') : '';
  const lines = c.legs.map((leg, i) => {
    const p = c.stops[i], q = c.stops[i + 1];
    const d = a.route?.[i] || 'M' + p.x + ' ' + p.y + ' Q' + p.x + ' ' + (p.y + q.y)/2 + ' ' + (p.x+q.x)/2 + ' ' + (p.y+q.y)/2 + 'T' + q.x + ' ' + q.y;
    return '<g class="map-leg" tabindex="0" role="button" aria-label="' + p.name + '에서 ' + q.name + ', ' + leg.minutes + '분" data-leg="' + i + '" fill="none" stroke-linecap="round">' + path(d,'stroke="white" stroke-width="8"') + path(d,'class="route-line" stroke="#0755f5" stroke-width="4" stroke-dasharray="7 5"') + path(d,'stroke="transparent" stroke-width="18"') + '</g>';
  }).join('');
  const pins = c.stops.map((p, i) => '<g class="map-pin" tabindex="0" role="button" data-stop="' + i + '" aria-label="' + (i+1) + '번 ' + p.name + '" transform="translate(' + p.x + ' ' + p.y + ')"><circle class="halo" r="24" fill="#0755f5" fill-opacity=".16" stroke="#0755f5" stroke-opacity=".48"/><circle r="16" fill="#0755f5" stroke="white" stroke-width="3"/><text class="pin-num" text-anchor="middle" y="5">' + (i+1) + '</text><text class="pin-caption" text-anchor="middle" y="36">' + p.name + '</text></g>').join('');
  const districts = a.labels.map(([x,y,label]) => '<text class="map-label" x="' + x + '" y="' + y + '">' + label + '</text>').join('');
  return '<svg viewBox="0 38 720 372" role="group" aria-label="' + c.city + ' 코스 약도">' +
    '<defs><clipPath id="landClip">' + path(land) + '</clipPath><pattern id="blocks" width="75" height="54" patternUnits="userSpaceOnUse" patternTransform="rotate(-16)"><rect width="75" height="54" fill="#e8eae3"/><path d="M0 0H75V54H0Z M36 0V54 M0 27H75" fill="none" stroke="#fdfcf4" stroke-width="4"/><path d="M4 5h26v16H4zm38 26h26v17H42z" fill="#dee3db"/></pattern></defs>' +
    '<rect x="-300" y="-250" width="1340" height="920" fill="#c2dfeb"/><g clip-path="url(#landClip)"><rect x="-300" y="-250" width="1340" height="920" fill="url(#blocks)"/>' + a.parks.map(d=>path(d,'fill="#c7dcca"')).join('') + river + '<g fill="none" stroke="#d5d6c9" stroke-width="8">' + roads + '</g><g fill="none" stroke="#fffbed" stroke-width="6">' + roads + '</g></g>' +
    (a.shore ? path(a.shore, 'fill="none" stroke="#ebddbe" stroke-width="5"') : '') + districts + '<text class="water-label" x="' + a.water[0] + '" y="' + a.water[1] + '">' + a.water[2] + '</text>' + lines + pins +
    '<g transform="translate(26 67)" aria-hidden="true"><circle r="15" fill="#fff" fill-opacity=".86"/><path d="m0-11 5 16-5-3-5 3z" fill="#34495a"/></g></svg>';
}
function select(type, index) {
  selection = { type, index };
  const c = city(), stop = c.stops[index], leg = c.legs[index];
  document.querySelectorAll('[data-stop],[data-leg]').forEach(el => {
    el.setAttribute('aria-pressed', String(Number(el.dataset[type]) === index));
  });
  $('selectionNumber').textContent = type === 'stop' ? String(index+1).padStart(2, '0') : (index+1) + '→' + (index+2);
  $('selectionTitle').textContent = type === 'stop' ? stop.name : stop.name + ' → ' + c.stops[index+1].name;
  $('selectionMemo').textContent = type === 'stop' ? stop.memo : leg.mode + ' · 예상 ' + leg.minutes + '분';
  if (liveView && showLive) {
    liveView.highlight(type === 'stop' ? index : null);
    if (type === 'stop') liveView.markers.get(index).marker.gmpDraggable = false;
    liveView.highlightLeg(type === 'leg' ? index : null);
  }
}
function renderLive() {
  if (!liveView || !showLive) return;
  const c = city();
  liveView.clear();
  c.stops.forEach((p,i) => liveView.setMarker(i,{position:{lat:p.lat,lng:p.lng},label:String(i+1),title:p.name,color:'#0755f5',visible:true}));
  c.legs.forEach((_,i) => liveView.setLeg(i,{segments:[{kind:'straight',path:c.stops.slice(i,i+2).map(p=>[p.lat,p.lng])}],color:'#0755f5',visible:true}));
  liveView.fitPoints(c.stops.map(({lat,lng}) => ({lat,lng})));
}
function renderCity() {
  const c = city();
  document.querySelectorAll('[data-city]').forEach(b=>b.setAttribute('aria-pressed', String(b.dataset.city === cityId)));
  $('courseTitle').textContent = c.title;
  $('description').textContent = c.description;
  $('area').textContent = c.area;
  $('duration').textContent = '이동 약 ' + c.legs.reduce((sum,l)=>sum+l.minutes,0) + '분';
  $('timeRange').textContent = c.stops[0].time + ' — ' + c.stops.at(-1).time;
  $('stops').innerHTML = c.stops.map((p,i) => {
    const leg = c.legs[i];
    return '<li><button class="stop" data-stop="' + i + '"><span class="num">' + (i+1) + '</span><span><strong>' + p.name + '</strong><small>' + p.category + '</small></span><time>' + p.time + '</time></button>' +
      (leg ? '<button class="leg" data-leg="' + i + '" aria-label="' + p.name + '에서 ' + c.stops[i+1].name + ', ' + leg.mode + ' 약 ' + leg.minutes + '분">' + icon(leg.mode === '도보' ? 'walk' : 'train') + leg.mode + ' · 약 ' + leg.minutes + '분</button>' : '') + '</li>';
  }).join('');
  $('schematic').innerHTML = diagram();
  renderLive();
  select('stop',0);
}
function chooseCity(id) {
  cityId = id;
  const url = new URL(location.href);
  url.searchParams.set('city', id); url.searchParams.delete('signin'); history.replaceState(null,'',url);
  renderCity();
}
document.querySelectorAll('[data-city]').forEach(b=>b.onclick=()=>chooseCity(b.dataset.city));
function pick(event) {
  const target = event.target.closest('[data-stop],[data-leg]');
  if (!target) return;
  const type = target.hasAttribute('data-stop') ? 'stop' : 'leg';
  select(type, Number(target.dataset[type]));
}
$('workspace').addEventListener('click',pick);
$('schematic').addEventListener('keydown',e=>{ if (['Enter',' '].includes(e.key)) { e.preventDefault(); pick(e); } });
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{
  $('workspace').dataset.mobileView = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(el=>el.setAttribute('aria-pressed', String(el === b)));
  if (b.dataset.view === 'map' && showLive) liveView.fitPoints(city().stops.map(({lat,lng})=>({lat,lng})));
});
function displayMap(live) {
  showLive = live;
  $('liveMap').hidden = !live; $('schematic').hidden = live;
  $('mapMode').textContent = live ? '방문 순서 연결선' : '예시 약도';
  $('switchMap').textContent = live ? '예시 약도 보기' : 'Google 지도 열기';
}
$('switchMap').hidden = !window.APP_CONFIG?.googleMapsApiKey;
let mapAuthErrors = 0;
window.gm_authFailure = () => {
  mapAuthErrors++;
  liveView = null;
  displayMap(false);
  notice('지도를 연결할 수 없어 예시 약도를 표시했어요.');
};
$('switchMap').onclick = async () => {
  if (mapLoading) return;
  if (showLive) { displayMap(false); return; }
  const priorErrors = mapAuthErrors;
  mapLoading = true; $('switchMap').disabled = true;
  try {
    if (!liveView) {
      const [{loadGoogleMaps},{MapView}] = await Promise.all([import('./places.js'), import('./mapview.js')]);
      const cfg = window.APP_CONFIG;
      await loadGoogleMaps({key:cfg.googleMapsApiKey, language:cfg.language, region:cfg.region});
      const candidate = new MapView($('liveMap'), {mapId:cfg.mapId, onSelect:i=>select('stop',i), onSelectLeg:i=>select('leg',i)});
      await candidate.init();
      if (priorErrors !== mapAuthErrors) return;
      liveView = candidate;
    }
    displayMap(true); renderLive(); select(selection.type,selection.index); notice('');
  } catch { displayMap(false); notice('지도를 연결할 수 없어 예시 약도를 표시했어요.'); }
  finally { mapLoading = false; $('switchMap').disabled = false; }
};

const actions = {
  account: '로그인하면 내 여행 목록을 열 수 있어요.',
  copy: '로그인하면 이 코스를 내 여행으로 복사해 장소와 시간을 바꿀 수 있어요.',
  import: '로그인하면 내 엑셀 파일을 선택해 일정을 가져올 수 있어요.',
  new: '로그인하면 빈 일정을 만들고 가고 싶은 장소를 담을 수 있어요.',
  share: '로그인하면 공유받은 여행을 확인할 수 있어요.',
};
const validIntent = intent => intent && Object.hasOwn(actions,intent.action) && hasCity(intent.city) &&
  (intent.action !== 'share' || typeof intent.token === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(intent.token));
function makeIntent(action, token) {
  return {action, token, city:cityId, selection:{...selection}, view:$('workspace').dataset.mobileView};
}
function restoreContext(intent) {
  chooseCity(intent.city);
  const type = intent.selection?.type, index = intent.selection?.index;
  if (['leg','stop'].includes(type) && Number.isInteger(index) && index >= 0 && index < (type === 'stop' ? city().stops : city().legs).length) select(type,index);
  if (intent.view === 'map') document.querySelector('[data-view="map"]').click();
}
function promptLogin(intent) {
  dialogIntent = intent;
  $('authTitle').textContent = session.available ? '로그인하고 시작하세요' : '지금은 로그인할 수 없어요';
  $('authMessage').textContent = session.available ? actions[intent.action] : '계정 서비스에 연결할 수 없어요. 잠시 후 다시 시도해 주세요. 도시 예시는 계속 둘러볼 수 있어요.';
  $('authContinue').hidden = !session.available;
  if (!$('authDialog').open) $('authDialog').showModal();
}
function clearShareHash() {
  if (!location.hash) return;
  const url = new URL(location.href); url.hash = ''; history.replaceState(null,'',url);
}
$('authCancel').onclick = () => $('authDialog').close();
$('authDialog').addEventListener('close', () => {
  if (dialogIntent?.action === 'share') clearShareHash();
  dialogIntent = null;
});
$('authContinue').onclick = () => {
  if (!dialogIntent || !session.available) return;
  try { sessionStorage.setItem(pendingKey,JSON.stringify(dialogIntent)); }
  catch { $('authMessage').textContent = '로그인을 이어가려면 이 사이트의 브라우저 저장소를 허용해 주세요.'; return; }
  location.assign('/api/auth/login');
};
function setUser(user) {
  session.user = user;
  document.querySelector('[data-action="account"]').textContent = user ? '내 여행' : '로그인';
}
async function refreshSession() {
  try {
    const response = await fetch('/api/session',{cache:'no-store',credentials:'same-origin', signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error();
    session = await response.json(); setUser(session.user);
  } catch { session = {available:false,user:null}; setUser(null); }
}
async function runIntent(intent) {
  if (!validIntent(intent) || copying) return;
  if (!session.user?.id) { promptLogin(intent); return; }
  if (intent.action !== 'copy') {
    const dest = new URL('/editor.html', location.origin);
    if (intent.action === 'share') dest.hash = new URLSearchParams({share:intent.token});
    else dest.searchParams.set('action',intent.action);
    location.assign(dest.href); return;
  }
  const button = document.querySelector('[data-action="copy"]');
  copying = true; button.disabled = true; notice('');
  const copyKey = 'routeflow.exampleCopy.v1:' + session.user.id + ':' + intent.city;
  try {
    let requestId = sessionStorage.getItem(copyKey);
    if (!requestId) { requestId = crypto.randomUUID(); sessionStorage.setItem(copyKey,requestId); }
    const response = await fetch('/api/examples/' + intent.city + '/copy',{
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json','X-RouteFlow-Request':'1','X-RouteFlow-User':String(session.user.id)},
      body:JSON.stringify({requestId}), signal:AbortSignal.timeout(15000),
    });
    if (response.status === 401) { setUser(null); promptLogin(intent); return; }
    if (!response.ok) throw new Error();
    const {travel} = await response.json();
    if (!travel?.id) throw new Error();
    sessionStorage.removeItem(copyKey);
    location.assign('/editor.html?travel=' + encodeURIComponent(travel.id));
  } catch { notice('코스를 복사하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.'); }
  finally { copying = false; button.disabled = false; }
}
renderCity();
const ready = refreshSession();
document.querySelectorAll('[data-action]').forEach(b => b.onclick = async () => {
  const intent = makeIntent(b.dataset.action);
  await ready;
  await refreshSession();
  await runIntent(intent);
});
window.addEventListener('pageshow',event=>{ if (event.persisted) location.reload(); });
async function resume() {
  await ready;
  const pending = readPending();
  const cancelled = initial.searchParams.get('signin') === 'cancelled';
  if (validIntent(pending)) restoreContext(pending);
  if (cancelled || pending && (session.user || session.available)) {
    try { sessionStorage.removeItem(pendingKey); } catch {}
  }
  if (cancelled) {
    clearShareHash();
    if (!validIntent(pending)) chooseCity(cityId);
    notice('로그인을 취소했어요. 보던 코스를 계속 둘러보세요.'); return;
  }
  if (validIntent(pending) && session.user) { await runIntent(pending); return; }
  const token = new URLSearchParams(location.hash.slice(1)).get('share');
  if (token) await runIntent(makeIntent('share',token));
}
resume();
