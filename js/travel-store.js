// 저장본을 바꾸기 전에 검증하고, 같은 출처의 탭 간 쓰기를 직렬화한다.
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const optionalTime = v => v == null || finite(v);
const safeId = v => typeof v === 'string' && v.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(v);
const point = p => object(p) && typeof p.name === 'string'
  && ['id', 'address', 'url', 'memo'].every(k => p[k] == null || typeof p[k] === 'string')
  && ['lat', 'lng'].every(k => p[k] == null || finite(p[k])) && optionalTime(p.cachedAt);
const statuses = new Set(['pending','searching','ok','check','notfound','error','given','confirmed','manual']);
export function validTravel(s, id = s?.id) {
  return object(s) && safeId(id) && s.id === id && typeof s.name === 'string' && finite(s.updated)
    && Array.isArray(s.headers) && s.headers.length <= 200 && s.headers.every(h => typeof h === 'string')
    && object(s.mapping) && ['name','date','category','time','region','memo','address','lat','lng','mode'].every(k => Number.isInteger(s.mapping[k]) && s.mapping[k] >= -1 && s.mapping[k] < s.headers.length)
    && Array.isArray(s.records) && s.records.length <= 20000 && s.records.every(r => object(r) && Number.isInteger(r.rowNumber) && Array.isArray(r.cells) && r.cells.length <= 200 && r.cells.every(c => c == null || (object(c) && (c.v == null || ['string','number','boolean'].includes(typeof c.v) || c.v instanceof Date) && (c.w == null || typeof c.w === 'string'))))
    && (s.library == null || (Array.isArray(s.library) && s.library.every(point)))
    && (s.dates == null || (Array.isArray(s.dates) && s.dates.every(d => typeof d === 'string')))
    && (s.places == null || (Array.isArray(s.places) && s.places.every(e => object(e) && Number.isInteger(e.recordIndex) && e.recordIndex >= 0 && e.recordIndex < s.records.length && point(e.place) && finite(e.place.lat) && finite(e.place.lng) && statuses.has(e.status) && optionalTime(e.cachedAt))))
    && (s.sheetName == null || (typeof s.sheetName === 'string' && s.sheetName.length <= 31 && !/[\\/\[\]:*?]/.test(s.sheetName)))
    && (s.region == null || typeof s.region === 'string');
}

export function createTravelStore({read, write, lock}) {
  const bases = new Map();
  const fingerprint = value => value == null ? null : JSON.stringify(value);
  function all() {
    const value = JSON.parse(read() || '{}');
    if (!object(value)) throw new Error('invalid store');
    return value;
  }
  return {
    list() {
      try {
        const entries = Object.entries(all());
        return {entries: entries.filter(([id,s]) => validTravel(s,id)), invalid: entries.filter(([id,s]) => !validTravel(s,id)).length};
      } catch { return {entries:[], invalid:1}; }
    },
    observe(id, snapshot) { try { bases.set(id, fingerprint(snapshot === undefined ? all()[id] : snapshot)); } catch { bases.set(id, undefined); } },
    async save(snapshot) {
      const s = structuredClone(snapshot);
      if (!validTravel(s)) return {invalid:true};
      if (!lock) return {unsupported:true};
      try { return await lock(() => {
        const values = all(), current = fingerprint(values[s.id]);
        if (!bases.has(s.id)) bases.set(s.id, null);
        if (bases.get(s.id) !== current) return {conflict:true};
        if (values[s.id] && JSON.stringify({...values[s.id],updated:0}) === JSON.stringify({...s,updated:0})) return {ok:true};
        values[s.id] = s;
        if (!write(JSON.stringify(values))) return {storageError:true};
        bases.set(s.id, fingerprint(s));
        return {ok:true};
      }); } catch { return {storageError:true}; }
    },
    async remove(id, expected) {
      if (!lock) return {unsupported:true};
      try { return await lock(() => {
        const values = all();
        if (!safeId(id) || fingerprint(values[id]) !== fingerprint(expected)) return {conflict:true};
        delete values[id];
        if (!write(JSON.stringify(values))) return {storageError:true};
        // Keep the old baseline: a deleted open snapshot must not recreate it.
        return {ok:true};
      }); } catch { return {storageError:true}; }
    },
  };
}
