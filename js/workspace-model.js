export function workspaceFingerprint(snapshot) {
  return JSON.stringify({...snapshot, updated:0});
}

export function workspaceDays(snapshot, items) {
  const days = [...new Set([...(snapshot.dates || []), ...items.map(item => item.day || '')])];
  return days.length ? days : [''];
}

export function moveWorkspaceItem(snapshot, items, source, target) {
  if (typeof target.day !== 'string' || target.day.length > 100) throw new Error('이동할 날짜를 확인해 주세요.');
  const next = structuredClone(snapshot);
  const mapping = next.mapping;
  const originalRecords = [...next.records];
  const sourceItem = items.find(item => item.recordIndex === source.index);
  if (source.kind === 'record' && (!sourceItem || !next.records[source.index])) throw new Error('일정이 변경됐어요. 현재 카드에서 다시 이동해 주세요.');
  if (source.kind !== 'record' && source.kind !== 'library') throw new Error('이동할 장소를 확인해 주세요.');
  const beforeIndex = target.beforeRecordIndex;
  const beforeItem = beforeIndex == null ? null : items.find(item => item.recordIndex === beforeIndex);
  if (beforeIndex != null && (!beforeItem || beforeItem.day !== target.day || (source.kind === 'record' && source.index === beforeIndex))) throw new Error('삽입 위치가 변경됐어요. 다시 선택해 주세요.');
  const ensureColumn = (key, title) => {
    if (mapping[key] < 0) { mapping[key] = next.headers.length; next.headers.push(title); }
    if (next.headers.length > 200) throw new Error('열이 너무 많아 날짜 열을 추가할 수 없어요.');
  };
  ensureColumn('date','날짜');
  // Imported merged/blank date cells inherit the prior row. Materialize before reordering.
  for (const item of items) {
    const record = next.records[item.recordIndex];
    if (record && !record.cells[mapping.date]?.v) record.cells[mapping.date] = {v:item.day || '',t:'s'};
  }
  let record;
  let placeEntry = null;
  if (source.kind === 'record') {
    record = next.records[source.index];
    next.records.splice(source.index,1);
  } else {
    const place = next.library?.[source.index];
    if (!place) throw new Error('후보가 변경됐어요. 다시 선택해 주세요.');
    for (const [key,title] of [['name','장소'],['memo','메모'],['address','주소'],['lat','위도'],['lng','경도']]) if (place[key] != null) ensureColumn(key,title);
    record = {rowNumber:Math.max(1,...next.records.map(row=>row.rowNumber))+1,cells:[]};
    for (const key of ['name','memo','address','lat','lng']) if (mapping[key] >= 0 && place[key] != null) record.cells[mapping[key]] = {v:place[key],t:typeof place[key] === 'number' ? 'n' : 's'};
    if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) placeEntry = {place:structuredClone(place),status:'given',cachedAt:place.cachedAt || Date.now()};
  }
  record.cells[mapping.date] = {v:target.day,t:'s'};
  const beforeRecord = beforeIndex == null ? null : originalRecords[beforeIndex];
  let insert = beforeRecord ? next.records.indexOf(beforeRecord) : -1;
  if (insert < 0) {
    const last = items.filter(item => item.day === target.day && !(source.kind === 'record' && item.recordIndex === source.index)).at(-1);
    insert = last ? next.records.indexOf(originalRecords[last.recordIndex]) + 1 : next.records.length;
  }
  next.records.splice(insert,0,record);
  next.places = (next.places || []).map(entry => ({...entry,recordIndex:next.records.indexOf(originalRecords[entry.recordIndex])}));
  if (placeEntry) next.places.push({...placeEntry,recordIndex:insert});
  next.dates = [...new Set([...(next.dates || []), ...(target.day ? [target.day] : [])])];
  next.updated = Date.now();
  return {snapshot:next,recordIndex:insert};
}
