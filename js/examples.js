// Hand-authored one-day examples. Times are planning estimates and points are approximate.
const stop = (name, time, category, memo, lat, lng, x, y) => ({ name, time, category, memo, lat, lng, x, y });
const leg = (mode, minutes) => ({ mode, minutes });
export const updated = '2026-11-22';

export const examples = {
  busan: {
    city: '부산', country: '대한민국', english: 'BUSAN', title: '부산, 바다를 따라', area: '해운대 · 청사포',
    description: '동백섬 숲길에서 청사포 등대까지, 해안선을 따라 동쪽으로 걷는 하루.',
    stops: [
      stop('동백섬', '09:30', '산책', '섬 남쪽 산책로에서 광안대교를 바라봐요.', 35.1532, 129.1518, 95, 308),
      stop('해운대해수욕장', '11:00', '해변', '백사장을 따라 걸으며 점심을 즐겨요.', 35.1587, 129.1604, 259, 250),
      stop('미포정거장', '13:30', '해변열차', '미포에서 청사포행 해변열차를 타요.', 35.1602, 129.1694, 433, 200),
      stop('청사포 등대', '15:00', '전망', '항구 끝 붉은 등대에서 바다를 만나요.', 35.1597, 129.1959, 625, 165),
    ],
    legs: [leg('도보', 25), leg('도보', 20), leg('해변열차·도보', 25)],
  },
  seoul: {
    city: '서울', country: '대한민국', english: 'SEOUL', title: '서울, 오래된 골목 사이', area: '종로 · 북촌',
    description: '경복궁 돌담에서 북촌 한옥길과 인사동을 지나 청계천 물가로 내려오는 하루.',
    stops: [
      stop('경복궁 광화문', '09:30', '궁궐', '광화문 앞에서 궁궐의 정면을 바라봐요.', 37.576, 126.9769, 120, 236),
      stop('북촌문화센터', '11:00', '한옥', '한옥 안마당에서 북촌의 역사를 살펴봐요.', 37.579, 126.9862, 451, 128),
      stop('인사동 쌈지길', '13:00', '공예', '공예 상점을 둘러보고 골목에서 점심을 즐겨요.', 37.5744, 126.9847, 397, 258),
      stop('청계천 광통교', '15:00', '산책', '돌다리 아래 산책로를 따라 걸어요.', 37.5688, 126.9831, 337, 365),
    ],
    legs: [leg('도보', 25), leg('도보', 15), leg('도보', 15)],
  },
  tokyo: {
    city: '도쿄', country: '일본', english: 'TOKYO', title: '도쿄, 스미다강 건너', area: '아사쿠사 · 오시아게',
    description: '센소지에서 아사쿠사 골목을 거쳐 스미다강 너머 스카이트리까지 걷는 하루.',
    stops: [
      stop('센소지', '09:30', '사찰', '본당을 둘러보고 나카미세 거리로 내려가요.', 35.7148, 139.7967, 112, 160),
      stop('가미나리몬', '11:00', '거리', '붉은 등롱 앞에서 아사쿠사 거리를 만나요.', 35.7106, 139.7967, 130, 311),
      stop('스미다공원', '13:00', '공원', '강변 산책로에서 스카이트리를 바라봐요.', 35.7131, 139.801, 278, 209),
      stop('도쿄 스카이트리', '15:00', '전망', '강을 건너 전망대 아래 광장에서 마무리해요.', 35.7101, 139.8107, 609, 315),
    ],
    legs: [leg('도보', 10), leg('도보', 15), leg('도보', 25)],
  },
};

function visitRange(city, index) {
  const arrival = city.stops[index].time;
  const next = city.stops[index + 1];
  if (!next) return arrival;
  const [hours, minutes] = next.time.split(':').map(Number);
  const departure = hours * 60 + minutes - city.legs[index].minutes;
  const time = [Math.floor(departure / 60), departure % 60].map(v => String(v).padStart(2, '0')).join(':');
  return arrival + ' ~ ' + time;
}

export function exampleSnapshot(cityId) {
  if (!Object.hasOwn(examples, cityId)) return null;
  const city = examples[cityId];
  return {
    id: 'example-' + cityId, name: city.title, region: city.city, updated: Date.parse(updated),
    sheetName: '하루 일정', headers: ['장소', '날짜', '시간', '분류', '메모', '위도', '경도', '이동수단'],
    mapping: { name: 0, date: 1, time: 2, category: 3, memo: 4, lat: 5, lng: 6, mode: 7, region: -1, address: -1 },
    records: city.stops.map((place, i) => ({
      rowNumber: i + 2,
      cells: [place.name, updated, visitRange(city, i), place.category, place.memo, place.lat, place.lng, city.legs[i - 1]?.mode || '']
        .map(v => ({ v, t: typeof v === 'number' ? 'n' : 's' })),
    })),
    places: city.stops.map(({name, lat, lng}, recordIndex) => ({ recordIndex, status: 'given', place: { name, lat, lng } })),
    dates: [updated], library: [],
  };
}
