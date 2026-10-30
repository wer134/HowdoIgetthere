import test from 'node:test';
import assert from 'node:assert/strict';
import {createTravelStore, validTravel} from '../js/travel-store.js';
const snapshot = id => ({id,name:id,updated:1,headers:['장소'],records:[{rowNumber:2,cells:[{v:'장소',t:'s'}]}],mapping:{name:0,date:-1,category:-1,time:-1,region:-1,memo:-1,address:-1,lat:-1,lng:-1,mode:-1},library:[],dates:[],places:[]});
function fixture() {
  let data=JSON.stringify({a:snapshot('a'),b:snapshot('b')}), queue=Promise.resolve(), fail=false;
  const make=()=>createTravelStore({read:()=>data,write:v=>{if(fail)return false;data=v;return true;},lock:fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;}});
  return {make,read:()=>JSON.parse(data),set:v=>data=JSON.stringify(v),fail:()=>fail=true};
}
test('동일 여행 동시 쓰기: 하나만 저장되고 다른 탭은 충돌',async()=>{
  const f=fixture(),a=f.make(),b=f.make();a.observe('a');b.observe('a');
  const result=await Promise.all([a.save({...snapshot('a'),name:'첫 탭'}),b.save({...snapshot('a'),name:'둘째 탭'})]);
  assert.equal(result.filter(r=>r.ok).length,1);assert.equal(result.filter(r=>r.conflict).length,1);assert.equal(f.read().a.name,'첫 탭');
});
test('다른 여행 동시 쓰기는 둘 다 보존',async()=>{
  const f=fixture(),a=f.make(),b=f.make();a.observe('a');b.observe('b');
  await Promise.all([a.save({...snapshot('a'),name:'A 편집'}),b.save({...snapshot('b'),name:'B 편집'})]);
  assert.equal(f.read().a.name,'A 편집');assert.equal(f.read().b.name,'B 편집');
});
test('삭제한 여행은 오래된 탭에서 부활하지 않음',async()=>{
  const f=fixture(),a=f.make(),b=f.make();a.observe('a');b.observe('a');
  assert.equal((await a.remove('a',snapshot('a'))).ok,true);
  assert.equal((await b.save({...snapshot('a'),name:'오래된 편집'})).conflict,true);assert.equal(f.read().a,undefined);
});
test('목록을 연 뒤 다른 탭이 변경한 여행은 삭제하지 않음',async()=>{
  const f=fixture(),a=f.make(),b=f.make();b.observe('a');await b.save({...snapshot('a'),name:'최신'});
  assert.equal((await a.remove('a',snapshot('a'))).conflict,true);assert.equal(f.read().a.name,'최신');
});
test('목록 읽기와 열기 사이에 변경돼도 오래된 snapshot이 덮어쓰지 않음',async()=>{
  const f=fixture(),a=f.make(),b=f.make(),old=snapshot('a');b.observe('a');await b.save({...old,name:'최신'});a.observe('a',old);
  assert.equal((await a.save({...old,name:'오래된 수정'})).conflict,true);
});
test('쓰기 실패 후 원본 보존',async()=>{const f=fixture(),a=f.make();a.observe('a');f.fail();assert.equal((await a.save({...snapshot('a'),name:'수정'})).storageError,true);assert.equal(f.read().a.name,'a');});
test('손상 항목과 ID 불일치를 제외하고 정상 저장본 보존',()=>{
  const f=fixture();f.set({a:snapshot('b'),b:snapshot('b'),bad:{...snapshot('bad'),records:null}});
  assert.deepEqual(f.make().list().entries.map(([id])=>id),['b']);assert.equal(f.make().list().invalid,2);assert.equal(f.read().bad.records,null);
});
for(const [key,value] of [['records',{}],['library',{}],['dates',{}],['mapping',null],['updated','bad'],['places',[{recordIndex:99,place:{}}]]])test(`${key} 타입 손상 검증`,()=>assert.equal(validTravel({...snapshot('a'),[key]:value}),false));
