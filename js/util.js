// 여러 모듈에서 함께 쓰는 작은 도구들

export const $ = (selector, root = document) => root.querySelector(selector);

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 사생활 보호 모드 등에서 localStorage가 막혀 있어도 앱이 멈추지 않도록 감싼다
export const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* 무시 */ }
  },
};

// localStorage에 두는 결과 보관함. ttl이 지난 것은 버리고, 공간이 모자라면 오래된 절반을 버린다
export function createStore(key, ttl) {
  let data = null;
  let timer = null;
  const load = () => {
    if (!data) {
      try { data = JSON.parse(storage.get(key) || '{}'); } catch { data = {}; }
      const now = Date.now();
      for (const [k, entry] of Object.entries(data)) {
        if (!entry || now - entry.t > ttl) delete data[k];
      }
    }
    return data;
  };
  const save = () => {
    if (storage.set(key, JSON.stringify(data))) return;
    const entries = Object.entries(data).sort((a, b) => a[1].t - b[1].t);
    data = Object.fromEntries(entries.slice(Math.floor(entries.length / 2)));
    storage.set(key, JSON.stringify(data));
  };
  return {
    has: (k) => Object.hasOwn(load(), k),
    get: (k) => load()[k]?.r,
    set(k, value) {
      load()[k] = { t: Date.now(), r: value };
      clearTimeout(timer);
      timer = setTimeout(save, 500);
    },
    clear() {
      data = {};
      storage.remove(key);
    },
  };
}

// 분류별 핀 색 — 흰색 번호 글자가 잘 보이는 진한 색 위주
export const PALETTE = [
  '#d93025', '#1a73e8', '#188038', '#e8710a', '#9334e6', '#00897b',
  '#c2185b', '#3949ab', '#558b2f', '#8d6e63', '#0097a7', '#5f6368',
];

export const STATUS = {
  pending: { label: '대기', cls: 'pending' },
  searching: { label: '검색 중', cls: 'pending' },
  ok: { label: '찾음', cls: 'ok' },
  check: { label: '확인 필요', cls: 'check' },
  notfound: { label: '못 찾음', cls: 'fail' },
  error: { label: '오류', cls: 'fail' },
  given: { label: '좌표 있음', cls: 'ok' },
  confirmed: { label: '확인함', cls: 'ok' },
  manual: { label: '직접 지정', cls: 'ok' },
};

// 비교용 정규화: 대소문자·공백·문장부호 차이를 없앤다
export function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

// 두 글자씩 끊어 겹치는 비율(Dice 계수). 1이면 같음, 0이면 전혀 다름
export function similarity(a, b) {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const counts = new Map();
  const bx = bigrams(x);
  const by = bigrams(y);
  for (const g of bx) counts.set(g, (counts.get(g) || 0) + 1);
  let hits = 0;
  for (const g of by) {
    const n = counts.get(g);
    if (n) { hits++; counts.set(g, n - 1); }
  }
  return (2 * hits) / (bx.length + by.length);
}
