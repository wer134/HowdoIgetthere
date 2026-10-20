// 대표 장소 주변의 명소·맛집 추천 (Places API (New) — Nearby Search / Text Search)
// 평점·리뷰 수·가격대·영업시간은 Enterprise 등급 필드라 매달 1,000건까지 무료, 넘으면 1,000건당 $35.
// 평점 같은 장소 정보는 오래 저장하지 않고, 이 페이지를 연 동안만 기억한다
import { withRetry } from './places.js';
import { distanceMeters } from './routes.js';

const FIELDS = [
  'id', 'displayName', 'location', 'rating', 'userRatingCount', 'priceLevel', 'priceRange', 'regularOpeningHours',
  'primaryType', 'types', 'postalAddress', 'formattedAddress', 'businessStatus', 'googleMapsURI', 'utcOffsetMinutes',
];
const MAX_RESULTS = 20;

// 맛집에서는 끼니가 되기 어려운 가게를 뺀다 (카페는 따로 찾는다)
const SNACKS = ['cafe', 'coffee_shop', 'bakery', 'dessert_shop', 'donut_shop', 'ice_cream_shop', 'cake_shop', 'confectionery',
  'candy_store', 'tea_house', 'juice_shop', 'convenience_store', 'chocolate_shop'];
// 안에 식당이 있어 'restaurant'로도 잡히는 호텔·쇼핑몰 (영업시간을 몰라 아침에 맨 위로 올라오곤 한다)
const BUILDINGS = ['hotel', 'lodging', 'resort_hotel', 'japanese_inn', 'hostel', 'guest_house', 'inn', 'motel', 'bed_and_breakfast',
  'shopping_mall', 'department_store'];
const BARS = new Set(['bar', 'pub', 'night_club', 'cocktail_bar', 'wine_bar', 'lounge_bar', 'sports_bar', 'irish_pub', 'hookah_bar']);

export const KINDS = {
  // weight: 베이즈 평균에서 주변 평균 쪽으로 당기는 힘(리뷰 수), fame: 리뷰가 많은 곳을 얼마나 올릴지
  food: { label: '맛집', types: ['restaurant'], exclude: [...SNACKS, ...BUILDINGS], textType: 'restaurant', radius: 800, weight: 150, fame: 0.05 },
  cafe: {
    label: '카페',
    types: ['cafe', 'coffee_shop', 'bakery', 'dessert_shop', 'tea_house', 'cake_shop'],
    exclude: BUILDINGS,
    textType: 'cafe',
    radius: 800,
    weight: 100,
    fame: 0.05,
  },
  sights: {
    label: '명소',
    types: ['tourist_attraction', 'museum', 'art_gallery', 'park', 'garden', 'historical_landmark', 'shinto_shrine', 'buddhist_temple',
      'church', 'castle', 'observation_deck', 'scenic_spot', 'aquarium', 'zoo', 'amusement_park', 'market', 'beach'],
    exclude: ['restaurant', 'cafe', 'coffee_shop', 'gift_shop', 'hotel'],
    textType: 'tourist_attraction',
    radius: 1500,
    weight: 300,
    fame: 0.12, // 명소는 많이 찾는 곳이 대개 볼 만한 곳이다
  },
};

/* ── 나라 짐작 (검색 언어·평점 링크를 고르는 데 쓴다) ── */

// 한국(본토·제주) 대략의 경계 [경도, 위도]. 대마도·규슈는 들어가지 않게 남동쪽을 잘랐다
const KOREA = [
  [124.5, 38.0], [126.0, 37.75], [127.0, 38.3], [128.4, 38.65], [129.5, 37.3], [129.6, 36.0], [129.65, 35.6],
  [129.3, 35.05], [128.5, 34.6], [126.9, 33.0], [125.9, 33.0], [125.9, 33.8], [124.5, 34.3],
];

function inside([x, y], polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** 좌표로 나라 짐작: 'KR' | 'JP' | '' */
export function countryAt({ lat, lng }) {
  if (inside([lng, lat], KOREA) || (lat > 37.2 && lat < 37.6 && lng > 130.7 && lng < 131.9)) return 'KR'; // 울릉도·독도
  if (lat > 35.5 && lng < 132.5) return ''; // 한반도 북쪽·중국 동북부
  if (lat > 24 && lat < 45.6 && lng > 122.9 && lng < 146) return 'JP';
  return '';
}

/* ── 검색 ── */

const results = new Map(); // 검색 조건 → Promise<장소[]>

/**
 * 주변 장소 찾기. keyword가 있으면 그 말로 찾고(Text Search), 없으면 그 종류의 인기 있는 곳(Nearby Search)
 * @returns {Promise<Array>} normalizePlace 모양
 */
export function findNearby({ center, kind, keyword = '', language, region }) {
  const key = [kind, keyword, center.lat.toFixed(4), center.lng.toFixed(4), language, region].join('|');
  if (!results.has(key)) {
    const job = fetchNearby({ center, kind, keyword, language, region });
    results.set(key, job);
    job.catch(() => results.delete(key));
  }
  return results.get(key);
}

async function fetchNearby({ center, kind, keyword, language, region }) {
  const { Place, SearchNearbyRankPreference } = await google.maps.importLibrary('places');
  const k = KINDS[kind];
  const common = { fields: FIELDS, maxResultCount: MAX_RESULTS };
  if (language) common.language = language;
  if (region) common.region = region;
  const { places } = await withRetry(() => (keyword
    ? Place.searchByText({ ...common, textQuery: keyword, includedType: k.textType, locationBias: { center, radius: k.radius } })
    : Place.searchNearby({
      ...common,
      locationRestriction: { center, radius: k.radius },
      includedTypes: k.types,
      ...(k.exclude ? { excludedPrimaryTypes: k.exclude } : {}),
      rankPreference: SearchNearbyRankPreference?.POPULARITY ?? 'POPULARITY',
    })));
  // 말로 찾으면 멀리 있는 곳도 섞여 오므로 걸어갈 만한 곳까지만
  const limit = Math.max(2000, k.radius * 2.5);
  // 말로 찾을 때는 종류를 하나만 줄 수 있어 빼야 할 곳을 여기서 거른다
  const skip = new Set(keyword ? k.exclude || [] : []);
  return (places || []).map(normalizePlace)
    .filter((p) => p && p.status !== 'CLOSED_PERMANENTLY' && p.status !== 'CLOSED_TEMPORARILY' && !skip.has(p.type) && distanceMeters(center, p) <= limit);
}

// 아침·점심 끼니에는 술집을 빼고 보여 준다
export const withoutBars = (places) => places.filter((p) => !BARS.has(p.type));

const num = (v) => (v == null || v === '' ? null : Number(v));
const money = (m) => (m ? { amount: num(m.units) ?? 0, currency: m.currencyCode || '' } : null);

/** JS SDK의 Place든 REST 응답이든 같은 모양으로 */
export function normalizePlace(p) {
  const loc = p.location;
  if (!loc) return null;
  const lat = typeof loc.lat === 'function' ? loc.lat() : loc.latitude ?? loc.lat;
  const lng = typeof loc.lng === 'function' ? loc.lng() : loc.longitude ?? loc.lng;
  const start = money(p.priceRange?.startPrice);
  const end = money(p.priceRange?.endPrice);
  return {
    id: p.id || '',
    name: typeof p.displayName === 'string' ? p.displayName : p.displayName?.text || '',
    lat,
    lng,
    rating: num(p.rating),
    count: num(p.userRatingCount) || 0,
    priceLevel: String(p.priceLevel || '').replace(/^PRICE_LEVEL_/, '') || '',
    price: start || end ? { min: start?.amount ?? null, max: end?.amount ?? null, currency: (start || end).currency } : null,
    periods: (p.regularOpeningHours?.periods || []).map((x) => ({ open: point(x.open), close: x.close ? point(x.close) : null })),
    hoursKnown: !!p.regularOpeningHours,
    type: p.primaryType || '',
    types: p.types || [],
    country: p.postalAddress?.regionCode || '',
    area: p.postalAddress?.administrativeArea || '',
    address: p.formattedAddress || '',
    status: p.businessStatus || '',
    url: p.googleMapsURI || p.googleMapsUri || '',
    utcOffset: num(p.utcOffsetMinutes),
  };
}

const point = (x) => ({ day: Number(x.day), hour: Number(x.hour ?? 0), minute: Number(x.minute ?? 0) });

/* ── 순위 ── */

// 리뷰가 적은 곳의 평점은 주변 평균 쪽으로 당긴다(베이즈 평균): 리뷰 3개 5.0점보다 리뷰 800개 4.3점이 위로
export function bayes(rating, count, mean, weight) {
  if (rating == null) return mean - 0.3;
  return (count * rating + weight * mean) / (count + weight);
}

// 1.3은 직선 거리를 실제 걷는 길로 늘리는 비율, 75m/분은 보통 걸음
export const walkMinutes = (meters) => Math.max(1, Math.round((meters * 1.3) / 75));

/**
 * 순위 매기기. 걸어서 먼 곳·그 시각에 닫은 곳·예산을 넘는 곳은 뒤로
 * @param {Array} places normalizePlace 모양
 * @param {object} o { center, kind, at: {weekday, minutes}|null, allowance: {amount, currency}|null,
 *   extraScore: (place) => 0~5 평점|null (직접 적은 타베로그·카카오 점수), costOf: (place) => priceOf 모양|null }
 */
export function rankPlaces(places, { center, kind, at = null, allowance = null, extraScore = null, costOf = null }) {
  const rated = places.filter((p) => p.rating != null && p.count >= 20);
  const mean = rated.length ? rated.reduce((n, p) => n + p.rating, 0) / rated.length : 4.0;
  const weight = KINDS[kind]?.weight ?? 150;
  return places.map((p) => {
    const meters = distanceMeters(center, p);
    const walk = walkMinutes(meters);
    const open = at ? openState(p, at.weekday, at.minutes, kind === 'sights' ? 30 : 45, at.now) : null;
    const cost = costOf ? costOf(p) : null;
    const fit = allowance && cost && cost.currency === allowance.currency ? budgetFit(cost, allowance.amount) : null;
    const extra = extraScore?.(p);
    let score = bayes(p.rating, p.count, mean, weight) + (KINDS[kind]?.fame ?? 0.05) * Math.log10(p.count + 1);
    if (extra != null) score = (score + extra) / 2;
    score -= 0.012 * Math.max(0, walk - 5);
    if (open && (open.state === 'closed' || open.state === 'dayoff')) score -= 1;
    else if (open?.state === 'closing') score -= 0.3;
    if (fit === 'over') score -= 0.6;
    else if (allowance && !cost && kind !== 'sights') score -= 0.15; // 예산을 정했는데 값을 모르는 곳은 조금 뒤로
    return { ...p, meters, walk, open, cost, fit, score };
  }).sort((a, b) => b.score - a.score);
}

// 명소에서는 큰 곳 바로 옆의 딸린 곳(신사의 누문·가전처럼 리뷰가 훨씬 적은 같은 종류의 장소)을 뺀다
export function dropParts(places) {
  return places.filter((p) => !places.some((big) => big !== p && big.count > p.count / 0.15
    && (big.type === p.type || big.types.includes(p.type)) && distanceMeters(big, p) < 150));
}

function budgetFit(cost, allowance) {
  if (cost.min != null && cost.min > allowance) return 'over';
  if (cost.amount > allowance) return 'tight';
  return 'ok';
}

/* ── 영업시간 ── */

const WEEK = 7 * 1440;
const DAY_NAMES = '일월화수목금토';
const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * 그 요일·시각(분)에 열려 있는지. stay: 그 뒤로 머물 시간(분), now: 일정 시각이 아니라 지금 기준
 * @returns {{state: 'open'|'closing'|'closed'|'dayoff'|'unknown', text: string}}
 */
export function openState(place, weekday, minutes, stay = 45, now = false) {
  if (!place.hoursKnown || !place.periods.length) return { state: 'unknown', text: '영업시간 정보 없음' };
  // 하루 종일 여는 곳은 open만 있고 close가 없다
  if (place.periods.some((p) => !p.close)) return { state: 'open', text: '24시간 영업' };
  const t = weekday * 1440 + minutes;
  const when = now ? '지금' : hm(minutes);
  const at = now ? '지금은' : `${hm(minutes)}엔`;
  const spans = place.periods.map(({ open, close }) => {
    const a = open.day * 1440 + open.hour * 60 + open.minute;
    let b = close.day * 1440 + close.hour * 60 + close.minute;
    if (b <= a) b += WEEK; // 토요일 밤 → 일요일 새벽
    return [a, b];
  });
  for (const [a, b] of spans) {
    for (const shift of [0, WEEK]) {
      const x = t + shift;
      if (x >= a && x < b) {
        return b - x >= stay
          ? { state: 'open', text: `${when} 영업 중 · ${hm(b % 1440)}까지` }
          : { state: 'closing', text: `${hm(b % 1440)}에 닫아요` };
      }
    }
  }
  const later = spans.map(([a]) => a).filter((a) => a > t && a < (weekday + 1) * 1440).sort((x, y) => x - y)[0];
  if (later != null) return { state: 'closed', text: `${at} 닫혀 있어요 · ${hm(later % 1440)}에 열어요` };
  const today = spans.some(([a]) => Math.floor(a / 1440) === weekday);
  return today
    ? { state: 'closed', text: `${at} 영업이 끝났어요` }
    : { state: 'dayoff', text: `${DAY_NAMES[weekday]}요일 휴무` };
}

/** 그 장소 시간대의 지금 (요일, 분) — 일정 시각이 없을 때 */
export function nowAt(place, now = new Date()) {
  const offset = place.utcOffset ?? -now.getTimezoneOffset();
  const local = new Date(now.getTime() + offset * 60000);
  return { weekday: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes(), now: true };
}

/* ── 가격 ── */

// 가격대가 없을 때 가격 등급으로 어림(1인)
const LEVEL_PRICE = {
  JPY: { FREE: 0, INEXPENSIVE: 1000, MODERATE: 2500, EXPENSIVE: 6000, VERY_EXPENSIVE: 15000 },
  KRW: { FREE: 0, INEXPENSIVE: 10000, MODERATE: 25000, EXPENSIVE: 60000, VERY_EXPENSIVE: 150000 },
  USD: { FREE: 0, INEXPENSIVE: 15, MODERATE: 30, EXPENSIVE: 60, VERY_EXPENSIVE: 120 },
  EUR: { FREE: 0, INEXPENSIVE: 12, MODERATE: 25, EXPENSIVE: 55, VERY_EXPENSIVE: 110 },
};
const LEVEL_COUNT = { INEXPENSIVE: 1, MODERATE: 2, EXPENSIVE: 3, VERY_EXPENSIVE: 4 };
const SIGNS = { JPY: '¥', KRW: '₩', EUR: '€', GBP: '£' };

/** 1인 가격 어림 { amount, min, max, currency, from: 'range'|'level' } 또는 null */
export function priceOf(place, fallbackCurrency) {
  const p = place.price;
  if (p && (p.max != null || p.min != null)) {
    const min = p.min != null && p.min > 1 ? p.min : 0;
    const max = p.max;
    const amount = max == null ? min * 1.2 : min <= max * 0.05 ? max * 0.7 : (min + max) / 2;
    return { amount: Math.round(amount), min, max, currency: p.currency, from: 'range' };
  }
  const table = LEVEL_PRICE[fallbackCurrency];
  if (place.priceLevel && table?.[place.priceLevel] != null) {
    const amount = table[place.priceLevel];
    return { amount, min: null, max: null, currency: fallbackCurrency, from: 'level' };
  }
  return null;
}

// 가격 등급 표시: ¥¥ · ₩₩₩
export function levelSigns(level, currency) {
  if (level === 'FREE') return '무료';
  return LEVEL_COUNT[level] ? (SIGNS[currency] || '$').repeat(LEVEL_COUNT[level]) : '';
}

/* ── 종류 이름 ── */

const TYPE_LABELS = {
  ramen_restaurant: '라멘', sushi_restaurant: '스시', japanese_izakaya_restaurant: '이자카야', yakiniku_restaurant: '야키니쿠',
  yakitori_restaurant: '야키토리', tonkatsu_restaurant: '돈카츠', japanese_curry_restaurant: '카레', japanese_restaurant: '일식',
  korean_restaurant: '한식', korean_barbecue_restaurant: '고깃집', chinese_restaurant: '중식', chinese_noodle_restaurant: '중화면',
  dumpling_restaurant: '만두', dim_sum_restaurant: '딤섬', cantonese_restaurant: '광둥 요리', taiwanese_restaurant: '대만 요리',
  hot_pot_restaurant: '전골·훠궈', noodle_shop: '면 요리', soup_restaurant: '국물 요리', seafood_restaurant: '해산물',
  oyster_bar_restaurant: '굴 요리', chicken_restaurant: '닭 요리', italian_restaurant: '이탈리안', pizza_restaurant: '피자',
  french_restaurant: '프렌치', spanish_restaurant: '스페인 요리', steak_house: '스테이크', hamburger_restaurant: '버거',
  fast_food_restaurant: '패스트푸드', barbecue_restaurant: '바비큐', buffet_restaurant: '뷔페', fine_dining_restaurant: '파인 다이닝',
  family_restaurant: '패밀리 레스토랑', breakfast_restaurant: '아침 식사', brunch_restaurant: '브런치', thai_restaurant: '태국 요리',
  vietnamese_restaurant: '베트남 요리', indian_restaurant: '인도 요리', mexican_restaurant: '멕시칸', american_restaurant: '아메리칸',
  western_restaurant: '양식', asian_restaurant: '아시안', vegetarian_restaurant: '채식', vegan_restaurant: '비건',
  sandwich_shop: '샌드위치', food_court: '푸드코트', bar: '바', pub: '펍', wine_bar: '와인 바', bistro: '비스트로',
  cafe: '카페', coffee_shop: '커피', bakery: '베이커리', dessert_shop: '디저트', cake_shop: '케이크', tea_house: '찻집',
  donut_shop: '도넛', ice_cream_shop: '아이스크림', confectionery: '과자점',
  tourist_attraction: '명소', museum: '박물관', art_museum: '미술관', art_gallery: '갤러리', history_museum: '역사박물관',
  park: '공원', city_park: '공원', garden: '정원', botanical_garden: '식물원', shinto_shrine: '신사', buddhist_temple: '절',
  church: '성당·교회', hindu_temple: '사원', mosque: '모스크', castle: '성', historical_landmark: '유적', historical_place: '유적',
  monument: '기념물', cultural_landmark: '문화 명소', observation_deck: '전망대', scenic_spot: '경치 좋은 곳', beach: '해변',
  aquarium: '수족관', zoo: '동물원', amusement_park: '놀이공원', market: '시장', shopping_mall: '쇼핑몰', plaza: '광장',
  bridge: '다리', sculpture: '조형물', hiking_area: '산책로', national_park: '국립공원', lake: '호수', river: '강',
  mountain_peak: '산', sports_complex: '체육 시설', visitor_center: '안내소',
};
const GENERIC = new Set(['restaurant', 'food', 'tourist_attraction', 'point_of_interest', 'establishment', 'store', 'place_of_worship']);

export function typeLabel(place, kind) {
  const ordered = [place.type, ...place.types].filter(Boolean);
  const specific = ordered.find((t) => !GENERIC.has(t) && TYPE_LABELS[t]);
  return TYPE_LABELS[specific] || TYPE_LABELS[ordered.find((t) => TYPE_LABELS[t])] || KINDS[kind]?.label || '';
}

/* ── 평점을 더 볼 곳 (일본은 타베로그, 한국은 카카오맵, 그 밖은 구글) ── */

// 타베로그 주소의 도도부현 이름
const PREFECTURES = {
  北海道: 'hokkaido', 青森県: 'aomori', 岩手県: 'iwate', 宮城県: 'miyagi', 秋田県: 'akita', 山形県: 'yamagata', 福島県: 'fukushima',
  茨城県: 'ibaraki', 栃木県: 'tochigi', 群馬県: 'gunma', 埼玉県: 'saitama', 千葉県: 'chiba', 東京都: 'tokyo', 神奈川県: 'kanagawa',
  新潟県: 'niigata', 富山県: 'toyama', 石川県: 'ishikawa', 福井県: 'fukui', 山梨県: 'yamanashi', 長野県: 'nagano', 岐阜県: 'gifu',
  静岡県: 'shizuoka', 愛知県: 'aichi', 三重県: 'mie', 滋賀県: 'shiga', 京都府: 'kyoto', 大阪府: 'osaka', 兵庫県: 'hyogo',
  奈良県: 'nara', 和歌山県: 'wakayama', 鳥取県: 'tottori', 島根県: 'shimane', 岡山県: 'okayama', 広島県: 'hiroshima',
  山口県: 'yamaguchi', 徳島県: 'tokushima', 香川県: 'kagawa', 愛媛県: 'ehime', 高知県: 'kochi', 福岡県: 'fukuoka', 佐賀県: 'saga',
  長崎県: 'nagasaki', 熊本県: 'kumamoto', 大分県: 'oita', 宮崎県: 'miyazaki', 鹿児島県: 'kagoshima', 沖縄県: 'okinawa',
};

// 타베로그는 공개 API가 없고 약관상 점수를 가져다 쓸 수 없어, 가게 이름으로 검색한 화면을 연다 (도도부현 안에서 찾으면 그 가게가 맨 위에 온다)
export function tabelogUrl(place) {
  const q = encodeURIComponent(place.name);
  const pref = PREFECTURES[place.area];
  return pref ? `https://tabelog.com/${pref}/rstLst/?vs=1&sk=${q}&sw=${q}` : `https://tabelog.com/rst/rstsearch/?sk=${q}`;
}

export const kakaoUrl = (place) => `https://map.kakao.com/link/search/${encodeURIComponent(place.name)}`;

export function googleUrl(place) {
  if (place.url) return place.url;
  const params = new URLSearchParams({ api: '1', query: place.name || `${place.lat},${place.lng}` });
  if (place.id) params.set('query_place_id', place.id);
  return `https://www.google.com/maps/search/?${params}`;
}

/** 그 나라에서 많이 보는 평점 사이트 { key, label, url, scale } 또는 null(구글만) */
export function ratingSource(place, kind) {
  const country = place.country || place.guessCountry;
  if (country === 'JP' && kind !== 'sights') return { key: 'tabelog', label: '타베로그', url: tabelogUrl(place), hint: '3.5 이상이면 손꼽히는 곳' };
  if (country === 'KR') return { key: 'kakao', label: '카카오맵', url: kakaoUrl(place), hint: '5점 만점' };
  return null;
}

// 타베로그 점수(대개 3.0~4.0)를 구글 평점과 견줄 수 있게: 3.0 → 3.6, 3.5 → 4.3, 4.0 → 5.0
export function scoreOnGoogleScale(source, score) {
  if (score == null || !Number.isFinite(score)) return null;
  if (source === 'tabelog') return Math.min(5, 3.6 + (score - 3.0) * 1.4);
  return Math.min(5, score);
}

/* ── 눌렀을 때 보여 줄 자세한 정보 ── */
// Place Details Enterprise + Atmosphere(매달 1,000건 무료, 넘으면 1,000건당 $25). 사진은 한 장마다 Place Photo(1,000장 무료, $7)
const DETAIL_FIELDS = [
  'photos', 'reviews', 'reviewSummary', 'editorialSummary', 'websiteURI', 'nationalPhoneNumber',
  'isReservable', 'hasTakeout', 'hasDineIn', 'hasDelivery', 'servesBreakfast', 'servesLunch', 'servesDinner',
  'servesVegetarianFood', 'paymentOptions', 'isGoodForChildren', 'isGoodForGroups', 'hasOutdoorSeating', 'hasRestroom',
];
const PHOTOS = 3;
const REVIEWS = 3;
const details = new Map(); // 장소 ID|언어 → Promise (이 페이지를 연 동안만)

/** 사진·리뷰·특징. 한국어로 요청하면 한국어로 쓴 리뷰가 먼저 온다 */
export function placeDetails(id, language) {
  const key = `${id}|${language}`;
  if (!details.has(key)) {
    const job = fetchDetails(id, language);
    details.set(key, job);
    job.catch(() => details.delete(key));
  }
  return details.get(key);
}

async function fetchDetails(id, language) {
  const { Place } = await google.maps.importLibrary('places');
  const place = new Place({ id, requestedLanguage: language });
  await withRetry(() => place.fetchFields({ fields: DETAIL_FIELDS }));
  return normalizeDetails(place);
}

const textOf = (v) => (v == null ? '' : typeof v === 'string' ? v : v.text || '');
const flag = (p, jsName, restName) => p[jsName] ?? p[restName] ?? null;

// [JS 이름, REST 이름, 그렇다, 아니다(보여 줄 때만)]
const FEATURES = [
  ['hasDineIn', 'dineIn', '매장 식사'],
  ['hasTakeout', 'takeout', '포장'],
  ['hasDelivery', 'delivery', '배달'],
  ['isReservable', 'reservable', '예약 가능', '예약 안 받음'],
  ['servesVegetarianFood', 'servesVegetarianFood', '채식 메뉴'],
  ['isGoodForGroups', 'goodForGroups', '단체 가능'],
  ['isGoodForChildren', 'goodForChildren', '아이와 가기 좋음'],
  ['hasOutdoorSeating', 'outdoorSeating', '야외 좌석'],
  ['hasRestroom', 'restroom', '화장실'],
];

/** JS SDK의 Place든 REST 응답이든 같은 모양으로 */
export function normalizeDetails(p) {
  const meals = [['servesBreakfast', '아침'], ['servesLunch', '점심'], ['servesDinner', '저녁']].filter(([k]) => p[k]).map(([, label]) => label);
  const pay = p.paymentOptions || {};
  const features = [
    meals.length ? `${meals.join('·')} 영업` : '',
    pay.acceptsCashOnly ? '현금만' : pay.acceptsCreditCards ? '카드 가능' : '',
    ...FEATURES.map(([js, rest, yes, no]) => {
      const v = flag(p, js, rest);
      return v === true ? yes : v === false && no ? no : '';
    }),
  ].filter(Boolean);
  const summary = p.reviewSummary;
  return {
    photos: (p.photos || []).slice(0, PHOTOS).map((ph) => ({
      url: typeof ph.getURI === 'function' ? ph.getURI({ maxWidth: 480, maxHeight: 360 }) : '',
      link: ph.googleMapsURI || ph.googleMapsUri || '',
      authors: (ph.authorAttributions || []).map((a) => ({ name: a.displayName || '', uri: a.uri || '' })),
    })),
    reviews: (p.reviews || []).slice(0, REVIEWS).map((r) => ({
      rating: num(r.rating),
      when: r.relativePublishTimeDescription || '',
      author: r.authorAttribution?.displayName || '',
      authorUri: r.authorAttribution?.uri || '',
      text: textOf(r.text) || textOf(r.originalText),
      link: r.googleMapsURI || r.googleMapsUri || '',
    })).filter((r) => r.text),
    about: textOf(p.editorialSummary),
    reviewSummary: summary ? {
      text: textOf(summary.text),
      disclosure: textOf(summary.disclosureText) || 'Gemini로 요약됨',
      uri: summary.reviewsURI || summary.reviewsUri || '',
    } : null,
    features,
    website: p.websiteURI || p.websiteUri || '',
    phone: p.nationalPhoneNumber || '',
  };
}

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월요일부터

/** 요일별 영업시간 [{ day, label: '월', text: '11:00–14:30, 18:00–21:00' | '휴무' | '24시간' }] (주변 검색에서 받은 것으로) */
export function weekHours(place) {
  if (!place.hoursKnown || !place.periods.length) return [];
  if (place.periods.some((p) => !p.close)) return WEEK_ORDER.map((day) => ({ day, label: DAY_NAMES[day], text: '24시간' }));
  return WEEK_ORDER.map((day) => {
    const spans = place.periods.filter((p) => p.open.day === day)
      .sort((a, b) => a.open.hour * 60 + a.open.minute - (b.open.hour * 60 + b.open.minute))
      .map(({ open, close }) => `${hm(open.hour * 60 + open.minute)}–${hm(close.hour * 60 + close.minute)}`);
    return { day, label: DAY_NAMES[day], text: spans.length ? spans.join(', ') : '휴무' };
  });
}

/** 대표 장소에서 걸어가는 구글 지도 길찾기 */
export function walkUrl(from, place) {
  const params = new URLSearchParams({ api: '1', origin: `${from.lat},${from.lng}`, destination: `${place.lat},${place.lng}`, travelmode: 'walking' });
  if (place.id) params.set('destination_place_id', place.id);
  return `https://www.google.com/maps/dir/?${params}`;
}
