import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {validateNegativeResults}=createRequire(import.meta.url)('./browser/rebuild-regressions.cjs');
const unavailable=new Set([5,40,50,59,67,69,71,72,75]);
const fixture=()=>Array.from({length:78},(_,index)=>({id:index+1,status:unavailable.has(index+1)?'검증 불가':'통과',checks:[{status:unavailable.has(index+1)?'검증 불가':'통과'}]}));
test('negative result validation accepts exactly all cases and explicit exclusions',()=>{
  assert.deepEqual(validateNegativeResults(fixture()),{ok:true,total:78,passed:69,unavailable:[5,40,50,59,67,69,71,72,75]});
});
test('negative result validation rejects a successful exit with incomplete or duplicated cases',()=>{
  assert.throws(()=>validateNegativeResults(fixture().slice(1)),/missing/);
  const duplicate=fixture();duplicate[0]=duplicate[1];assert.throws(()=>validateNegativeResults(duplicate),/duplicated/);
});
test('negative result validation rejects failed checks hidden behind passing case status',()=>{
  const results=fixture();results[0].checks=[{status:'결함 확인'}];assert.throws(()=>validateNegativeResults(results),/failed check/);
});
test('negative result validation rejects harness errors and unapproved exclusions',()=>{
  const results=fixture();results[0].harnessError='timed out';assert.throws(()=>validateNegativeResults(results),/harness error/);
  delete results[0].harnessError;results[0].status='검증 불가';assert.throws(()=>validateNegativeResults(results),/boundary/);
});
test('targeted negative result validation requires only the explicitly selected cases',()=>{
  assert.deepEqual(validateNegativeResults(fixture().filter(result=>[2,24,69,70].includes(result.id)),'2,24,69,70'),{ok:true,total:4,passed:3,unavailable:[69]});
});
