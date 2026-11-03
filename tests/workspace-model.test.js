import test from 'node:test';
import assert from 'node:assert/strict';
import {moveWorkspaceItem, workspaceFingerprint, workspaceDays} from '../js/workspace-model.js';
import {validTravel} from '../js/travel-store.js';

const make = () => ({id:'board-test',name:'보드 여행',updated:1,headers:['장소','날짜','시간','메모','개인 열'],mapping:{name:0,date:1,time:2,memo:3,category:-1,region:-1,address:-1,lat:-1,lng:-1,mode:-1},dates:['2026-11-01','2026-11-02'],library:[{name:'후보',memo:'후보 메모',lat:35,lng:139}],records:[
  {rowNumber:2,cells:[{v:'A'},{v:'2026-11-01'},{v:'09:00'},{v:'보존 메모'},{v:123,f:'SUM(100,23)',z:'0.00',s:{font:{bold:true}}}]},
  {rowNumber:3,cells:[{v:'B'},null,{v:'10:00'},{v:'B 메모'}]},
  {rowNumber:4,cells:[{v:'C'},{v:'2026-11-02'},{v:'11:00'}]},
],places:[{recordIndex:0,place:{name:'A',lat:35,lng:139},status:'given'}]});
const items = [{recordIndex:0,day:'2026-11-01'},{recordIndex:1,day:'2026-11-01'},{recordIndex:2,day:'2026-11-02'}];
test('날짜 이동은 시간, 메모, 개인 열과 장소 연결을 보존한다',()=>{
  const before=make();
  const result=moveWorkspaceItem(before,items,{kind:'record',index:0},{day:'2026-11-02',beforeRecordIndex:null});
  assert.deepEqual(result.snapshot.records.map(r=>r.cells[0].v),['B','C','A']);
  assert.deepEqual(result.snapshot.records[2].cells.slice(2),before.records[0].cells.slice(2));
  assert.equal(result.snapshot.records[0].cells[1].v,'2026-11-01');
  assert.equal(result.snapshot.places[0].recordIndex,2);
  assert.equal(result.recordIndex,2);
  assert.equal(validTravel(result.snapshot),true);
  assert.equal(before.records[0].cells[1].v,'2026-11-01');
});
test('앞으로 이동은 대상 앞에 넣고 같은 날짜를 유지한다',()=>{
  const result=moveWorkspaceItem(make(),items,{kind:'record',index:1},{day:'2026-11-01',beforeRecordIndex:0});
  assert.deepEqual(result.snapshot.records.map(r=>r.cells[0].v),['B','A','C']);
});
test('후보를 일정에 넣어도 원래 후보와 메모를 보존한다',()=>{
  const result=moveWorkspaceItem(make(),items,{kind:'library',index:0},{day:'2026-11-02',beforeRecordIndex:2});
  assert.equal(result.snapshot.library.length,1);
  const r=result.snapshot.records[result.recordIndex];
  assert.equal(r.cells[0].v,'후보'); assert.equal(r.cells[3].v,'후보 메모');
  assert.equal(result.snapshot.places.at(-1).recordIndex,result.recordIndex);
  assert.equal(validTravel(result.snapshot),true);
});
test('오래된 출발 위치나 다른 날짜의 삽입 대상은 거부한다',()=>{
  assert.throws(()=>moveWorkspaceItem(make(),items,{kind:'record',index:99},{day:'2026-11-02'}));
  assert.throws(()=>moveWorkspaceItem(make(),items,{kind:'record',index:0},{day:'2026-11-01',beforeRecordIndex:2}));
});
test('변경 지문은 시간만 바뀐 저장을 무시하지만 실제 편집을 감지한다',()=>{
  const a=make(),b=make(); b.updated=999;
  assert.equal(workspaceFingerprint(a),workspaceFingerprint(b));
  b.records[0].cells[3].v='편집';
  assert.notEqual(workspaceFingerprint(a),workspaceFingerprint(b));
});
test('날짜 목록은 빈 날짜와 일정 없는 여행 날짜를 유지한다',()=>{
  assert.deepEqual(workspaceDays(make(),[...items,{recordIndex:3,day:''}]),['2026-11-01','2026-11-02','']);
});
