import { validTravel } from '../js/travel-store.js';
import { requireValue } from './errors.js';

const pointFields = ['id', 'name', 'address', 'url', 'memo', 'lat', 'lng', 'cachedAt', 'type', 'types'];
export function cleanPlace(value) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 400, 'invalid_place');
  const result = Object.fromEntries(pointFields.filter(key => value[key] != null).map(key => [key, value[key]]));
  requireValue(typeof result.name === 'string' && result.name.trim().length > 0 && result.name.length <= 500, 400, 'invalid_place');
  for (const key of ['id', 'address', 'url', 'memo']) requireValue(result[key] == null || (typeof result[key] === 'string' && result[key].length <= 4000), 400, 'invalid_place');
  for (const key of ['lat', 'lng', 'cachedAt']) requireValue(result[key] == null || (typeof result[key] === 'number' && Number.isFinite(result[key])), 400, 'invalid_place');
  requireValue(result.lat == null || Math.abs(result.lat) <= 90, 400, 'invalid_place');
  requireValue(result.lng == null || Math.abs(result.lng) <= 180, 400, 'invalid_place');
  requireValue(result.type == null || (typeof result.type==='string' && result.type.length<=100),400,'invalid_place');
  requireValue(result.types == null || (Array.isArray(result.types) && result.types.length<=100 && result.types.every(type=>typeof type==='string' && type.length<=100)),400,'invalid_place');
  return result;
}
export function cleanSnapshot(value, id = value?.id) {
  requireValue(validTravel(value) && typeof id === 'string' && id.length <= 128, 400, 'invalid_travel');
  const snapshot = {
    id, name: value.name, updated: Date.now(), headers: value.headers,
    mapping: Object.fromEntries(['name','date','category','time','region','memo','address','lat','lng','mode'].map(key => [key, value.mapping[key]])),
    records: value.records.map(row => ({ rowNumber: row.rowNumber, cells: row.cells.map(cell => cell == null ? null : {
      v: cell.v ?? null, ...(typeof cell.t === 'string' ? { t: cell.t.slice(0, 4) } : {}), ...(cell.w == null ? {} : { w: cell.w }), ...(typeof cell.f==='string' ? {f:cell.f.slice(0,8192)} : {}),
    }) })),
    library: (value.library || []).map(cleanPlace), dates: value.dates || [], region: value.region || '', sheetName: value.sheetName || '일정',
    places: (value.places || []).map(entry => ({ recordIndex: entry.recordIndex, status: entry.status, cachedAt: entry.cachedAt || value.updated, place: cleanPlace(entry.place) })),
  };
  requireValue(snapshot.name.length <= 500 && snapshot.dates.length <= 366 && snapshot.dates.every(day => day.length <= 100), 400, 'invalid_travel');
  return snapshot;
}
