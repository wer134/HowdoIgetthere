// 구글 지도 JS API 불러오기와 장소 이름 검색 (Places API (New) — Text Search)
import { createStore } from './util.js';

// 구글 약관상 검색 결과 좌표는 최대 30일까지만 보관할 수 있다
export const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
// 요청하는 필드에 따라 요금 등급이 정해진다. 아래는 모두 Text Search Pro 등급
const PLACE_FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'googleMapsURI'];
const MAX_RESULTS = 5;

let loading = null;
const store = createStore('placesCache.v1', CACHE_TTL);
const inflight = new Map(); // 같은 검색어가 동시에 들어오면 요청은 한 번만

export function loadGoogleMaps({ key, language, region }) {
  if (!loading) {
    const params = { key, v: 'weekly' };
    if (language) params.language = language;
    if (region) params.region = region;
    bootstrap(params);
    loading = google.maps.importLibrary('maps');
  }
  return loading;
}

// 구글 공식 동적 로더 스니펫 그대로
// https://developers.google.com/maps/documentation/javascript/load-maps-js-api
function bootstrap(g) {
  /* eslint-disable */
  var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n));
  /* eslint-enable */
}

// 장소 이름을 쓴 글자에 맞춰 결과 언어를 고른다. 櫛田神社처럼 일본어로 적었는데 결과가 "쿠시다 신사"로 오면
// 이름 비교가 틀어져 모두 '확인 필요'가 되기 때문이다. 한글이 섞여 있으면 기본 언어를 쓴다.
export function languageFor(text, fallback) {
  const s = String(text ?? '');
  if (/\p{Script=Hangul}/u.test(s)) return fallback;
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(s)) return 'ja';
  if (/[A-Za-z]/.test(s)) return 'en';
  return fallback;
}

function cacheKey(query, { language = '', region = '' } = {}) {
  return `${language}|${region}|${query}`;
}

export function isCached(query, options) {
  return store.has(cacheKey(query, options));
}

export function clearCache() {
  store.clear();
}

// 검색어로 장소 후보를 최대 5곳까지 돌려준다. 같은 검색어는 저장해 둔 결과를 다시 쓴다(요금 절약)
export async function searchPlaces(query, options = {}) {
  const key = cacheKey(query, options);
  if (store.has(key)) return store.get(key);
  if (!inflight.has(key)) {
    inflight.set(key, fetchPlaces(query, options, key).finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

async function fetchPlaces(query, options, key) {
  const { Place } = await google.maps.importLibrary('places');
  const request = { textQuery: query, fields: PLACE_FIELDS, maxResultCount: MAX_RESULTS };
  if (options.language) request.language = options.language;
  if (options.region) request.region = options.region;

  const { places } = await withRetry(() => Place.searchByText(request));
  const results = (places || [])
    .filter((p) => p.location)
    .map((p) => ({
      id: p.id || '',
      name: p.displayName || '',
      address: p.formattedAddress || '',
      lat: p.location.lat(),
      lng: p.location.lng(),
      url: p.googleMapsURI || '',
    }));
  store.set(key, results);
  return results;
}

export async function withRetry(fn, tries = 3) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= tries - 1 || classifyError(err) !== 'rate') throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}

// rate: 요청 한도 초과(잠시 뒤 다시 시도), fatal: 키·API 설정 문제(모두 실패할 것), other: 이 검색만의 문제
export function classifyError(err) {
  const text = `${err?.code ?? ''} ${err?.message ?? err}`;
  if (/OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED|\b429\b|rate limit|quota/i.test(text)) return 'rate';
  if (/REQUEST_DENIED|PERMISSION_DENIED|not been used|disabled|API_KEY|ApiNotActivated|billing|unauthori[sz]ed|\b403\b/i.test(text)) return 'fatal';
  return 'other';
}
