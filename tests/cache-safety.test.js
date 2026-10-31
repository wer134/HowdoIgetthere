import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/util.js';
for (const input of ['null','42','"text"','[]','{broken']) test(`invalid cache ${input} recovers without altering travel data`, () => {
  const values = new Map([['cache', input],['routeflow.travels.v1','keep']]);
  globalThis.localStorage = { getItem:k=>values.get(k), setItem:(k,v)=>values.set(k,v), removeItem:k=>values.delete(k) };
  const store=createStore('cache',1000);assert.equal(store.has('a'),false);store.set('a',{ok:true});assert.deepEqual(store.get('a'),{ok:true});
  assert.equal(values.get('routeflow.travels.v1'),'keep');store.clear();
});
test('invalid entries, expired and future timestamps are ignored; safe keys cannot change the prototype', () => {
  const now=Date.now();globalThis.localStorage={getItem:()=>JSON.stringify({valid:{t:now,r:[]},expired:{t:now-10000,r:1},future:{t:now+10000,r:1},bad:{t:'x',r:1},missing:{t:now}}),setItem:()=>{},removeItem:()=>{}};
  const store=createStore('cache',1000);assert.deepEqual(store.get('valid'),[]);
  for(const key of ['expired','future','bad','missing'])assert.equal(store.has(key),false);
  store.set('__proto__',{safe:true});assert.deepEqual(store.get('__proto__'),{safe:true});assert.equal({}.safe,undefined);store.clear();
});
test('negative route results remain cached while malformed result payloads are discarded',()=>{
 const now=Date.now();globalThis.localStorage={getItem:()=>JSON.stringify({none:{t:now,r:null},bad:{t:now,r:'invalid'}}),setItem:()=>{},removeItem:()=>{}};
 const cache=createStore('route',1000,value=>value===null || Array.isArray(value));
 assert.equal(cache.has('none'),true);assert.equal(cache.get('none'),null);assert.equal(cache.has('bad'),false);
});
