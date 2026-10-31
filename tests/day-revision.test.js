import test from 'node:test';
import assert from 'node:assert/strict';
import { revisionDays, revisionEntries, revisionFingerprint, validateRevision, mergeDayRevision, reviseDay } from '../js/day-revision.js';
import { validTravel } from '../js/travel-store.js';

const snapshot = {
  id: 'day-test', name: '직접 작성한 여행', updated: 1, headers: ['장소', '날짜', '시간', '메모', '지역', '나만의 열'],
  mapping: { name: 0, date: 1, category: 1, time: 2, memo: 3, region: 4, address: -1, lat: -1, lng: -1, mode: -1 },
  records: [['공원', '2026-12-31', '10:00', '예약 메모', '후쿠오카', '보존'], ['미술관', '', '11:00', '개인 메모', '후쿠오카', '원본'], ['다음 날', '2027-01-01', '09:00', '다른 날 메모']].map((values, i) => ({ rowNumber: i + 2, cells: values.map(v => ({ t: 's', v })) })),
  places: [0, 1, 2].map(recordIndex => ({ recordIndex, place: { name: '장소', lat: 33, lng: 130 }, status: 'given' })), library: [{ name: '보관함', memo: '유지' }], dates: ['2026-12-31', '2027-01-01'],
};
const day = '2026-12-31';
const proposal = { summary: '순서와 시간을 변경', items: [
  { id: 'r1', name: '미술관', time: '09:00', region: '후쿠오카', note: '새 안내' },
  { id: 'r0', name: '공원', time: '10:00', region: '후쿠오카', note: '' },
] };
test('빈 날짜의 상속과 다른 연도의 날짜를 분리한다', () => {
  assert.deepEqual([...revisionDays(snapshot)], [[day, [0, 1]], ['2027-01-01', [2]]]);
});
test('사진용 장소 정보 보충은 편집 충돌이 아니고 핀 이동과 메모 편집은 충돌이다', () => {
  const updated = structuredClone(snapshot);
  updated.places[0].place.id = 'google-place-id';
  updated.places[0].place.name = 'Google의 장소 이름';
  updated.places[0].cachedAt = Date.now();
  assert.equal(revisionFingerprint(updated), revisionFingerprint(snapshot));
  updated.places[0].place.lat += 0.01;
  assert.notEqual(revisionFingerprint(updated), revisionFingerprint(snapshot));
  updated.places[0].place.lat = snapshot.places[0].place.lat;
  updated.records[0].cells[3].v = '새 메모';
  assert.notEqual(revisionFingerprint(updated), revisionFingerprint(snapshot));
});
test('선택한 하루만 수정하고 원본 셀·메모·다른 날짜·보관함·장소 연결을 보존한다', () => {
  const before = structuredClone(snapshot);
  const out = mergeDayRevision(snapshot, day, proposal, ['r0']);
  assert.deepEqual(snapshot, before);
  assert.deepEqual(out.records[2], before.records[2]);
  assert.deepEqual(out.library, before.library);
  assert.equal(out.records[0].cells[5].v, '원본');
  assert.equal(out.records[0].cells[3].v, '개인 메모\nAI 참고: 새 안내');
  assert.equal(out.records[0].cells[1].v, day);
  assert.equal(out.records[1].cells[3].v, '예약 메모');
  assert.equal(validTravel(out), true);
});
test('새 장소는 확인한 좌표와 새 행으로 추가하고 삭제된 장소 연결을 제거한다', () => {
  const p = { summary: '장소 교체', items: [{ id: '', name: '카페', time: '12:00–13:00', region: '후쿠오카', note: '' }] };
  assert.throws(() => mergeDayRevision(snapshot, day, p), /지도 위치/);
  const out = mergeDayRevision(snapshot, day, p, [], new Map([[0, { name: '카페', lat: 33.5, lng: 130.2 }]]));
  assert.equal(out.records.length, 2);
  assert.equal(out.places.length, 2);
  assert.equal(out.places[0].place.name, '카페');
  assert.deepEqual(out.records[1], snapshot.records[2]);
  assert.equal(validTravel(out), true);
});
for (const [name, change] of [
  ['다른 날짜 행 참조', p => { p.items[0].id = 'r2'; }],
  ['중복 행', p => { p.items.push(p.items[0]); }],
  ['기존 장소 몰래 변경', p => { p.items[0].name = '다른 곳'; }],
  ['잠금 시간 변경', p => { p.items[1].time = '12:00'; }],
  ['잠금 행 삭제', p => { p.items.pop(); }],
  ['잘못된 시간', p => { p.items[0].time = '25:30'; }],
  ['역전된 시간', p => { p.items[0].time = '15:00–12:00'; }],
  ['빈 응답', p => { p.items = []; }],
]) test(`${name} 거부`, () => {
  const p = structuredClone(proposal); change(p);
  assert.throws(() => validateRevision(p, revisionEntries(snapshot, day, ['r0'])));
});
test('선택한 날짜의 데이터만 AI에 보내고 키는 본문에 포함하지 않는다', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body), input = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(input.day, day);
    assert.equal(input.items.length, 2);
    assert.equal(input.items[0].locked, true);
    assert(!options.body.includes('다른 날 메모'));
    assert(!options.body.includes('test-secret'));
    assert.equal(options.headers['x-goog-api-key'], 'test-secret');
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(proposal) }] } }] });
  });
  const out = await reviseDay({ snapshot, day, instruction: '덜 걷게 수정', locked: ['r0'] }, { provider: 'gemini', apiKey: 'test-secret' });
  assert.deepEqual(out, proposal);
});
test('취소된 AI 요청은 그대로 취소돼 적용안이 생기지 않는다', async t => {
  t.mock.method(globalThis, 'fetch', async (_, options) => { options.signal.throwIfAborted(); });
  const c = new AbortController(); c.abort();
  await assert.rejects(reviseDay({ snapshot, day, instruction: '수정' }, { provider: 'gemini', apiKey: 'test', signal: c.signal }), { name: 'AbortError' });
});

test('overlap, reversed row ordering and overlap with locked reservation are rejected', () => {
  for (const times of [['10:00–11:00','10:30–11:30'], ['12:00','09:00'], ['09:00–10:30','10:00']]) {
    const p=structuredClone(proposal);p.items.forEach((item,i)=>item.time=times[i]);
    assert.throws(()=>validateRevision(p,revisionEntries(snapshot,day)),/겹치|순서/);
  }
});
test('adjacent slots and unspecified times pass; overnight and ambiguous old times require clarification', () => {
  for(const times of [['09:00–10:00','10:00'], ['','10:00'],['09:00','']]) {
    const p=structuredClone(proposal);p.items.forEach((item,i)=>item.time=times[i]);assert.doesNotThrow(()=>validateRevision(p,revisionEntries(snapshot,day)));
  }
  const p=structuredClone(proposal);p.items[0].time='23:00–01:00';assert.throws(()=>validateRevision(p,revisionEntries(snapshot,day)));
  const entries=revisionEntries(snapshot,day);entries[1].time=p.items[0].time='오전 중';assert.throws(()=>validateRevision(p,entries),/모호/);
});
