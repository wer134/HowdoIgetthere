import test from 'node:test';import assert from 'node:assert/strict';
import {BoundedMap,BoundedSet} from '../js/memory-cache.js';
test('session caches remain bounded and keep recently accessed entries',()=>{
 const cache=new BoundedMap(2);cache.set('a',1).set('b',2);assert.equal(cache.get('a'),1);cache.set('c',3);assert.equal(cache.has('b'),false);assert.equal(cache.size,2);
 for(let i=0;i<1000;i++)cache.set(i,{data:i});assert.equal(cache.size,2);
 const failed=new BoundedSet(3);for(let i=0;i<1000;i++)failed.add(String(i));assert.equal(failed.size,3);cache.clear();assert.equal(cache.size,0);
});
