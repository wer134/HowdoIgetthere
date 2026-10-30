import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeTravelBackup, decodeTravelBackup, itineraryDocument, itineraryContent } from '../js/travel-portability.js';
const fixture = () => ({id:'original',name:'부산 여행',updated:100,headers:['장소','날짜','시간','메모'],mapping:{name:0,date:1,category:1,time:2,memo:3,region:-1,address:-1,lat:-1,lng:-1,mode:-1},records:[{rowNumber:2,cells:['해변','2026-11-07','10:00','예약 메모'].map(v=>({t:'s',v}))}],dates:['2026-11-07','2026-11-08'],library:[{id:'place',name:'후보',memo:'꼭 먹을 것',photos:['private-photo'],apiKey:'secret-place'}],places:[],sheetName:'일정',apiKey:'secret-root'});
test('backup round trip preserves itinerary, empty days and personal notes with a new identity',()=>{
  const source=fixture(), original=JSON.stringify(source);
  const text=encodeTravelBackup(source), restored=decodeTravelBackup(text,{id:'new',now:200});
  assert.equal(restored.id,'new');assert.equal(restored.name,'부산 여행 (복원본)');
  assert.deepEqual(restored.records,source.records);assert.deepEqual(restored.dates,source.dates);
  assert.equal(restored.library[0].memo,'꼭 먹을 것');assert.equal(restored.library[0].cachedAt,100);
  assert.equal(JSON.stringify(source),original);assert.doesNotMatch(text,/secret-|private-photo/);
});
test('backup import rejects malformed, unsupported and structurally damaged documents',()=>{
  const text=encodeTravelBackup(fixture());
  assert.throws(()=>decodeTravelBackup('{',{id:'new'}),/읽을 수 없/);
  assert.throws(()=>decodeTravelBackup(text.replace('"version": 1','"version": 2'),{id:'new'}),/형식/);
  const invalid=JSON.parse(text);invalid.travel.records=null;
  assert.throws(()=>decodeTravelBackup(JSON.stringify(invalid),{id:'new'}),/형식/);
  assert.throws(()=>decodeTravelBackup(text,{id:'original'}),/새 ID/);
});
test('standalone itinerary escapes hostile content and carries no scripts or external assets',()=>{
  const source=fixture();source.name='<script>bad()</script>';source.library[0].memo='<img src=x onerror=bad()>\n메모';
  const html=itineraryDocument(source);
  assert.doesNotMatch(html,/<script|<img|<iframe|<link|<[^>]+\bsrc=/);assert.match(html,/&lt;script&gt;/);
  assert.match(html,/아직 정한 일정이 없는 날/);assert.match(html,/예약 메모/);assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/secret-/);
  assert.match(itineraryContent(source),/2026-11-08/);
});
