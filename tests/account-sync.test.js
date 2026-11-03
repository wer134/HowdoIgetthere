import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountSync } from '../js/account-sync.js';

const fixture = () => { const values = new Map(); return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),values}; };
const travel = (name='원본') => ({id:'travel',version:1,snapshot:{id:'travel',name,updated:1}});
test('serial saves send the next version and preserve edits queued during a request', async () => {
  const calls=[]; let release;
  const sync=createAccountSync({storage:fixture(),send:async(id,body)=>{calls.push(body);if(calls.length===1)await new Promise(r=>release=r);return {travel:{id,version:body.version+1,snapshot:body.snapshot}};}});
  sync.open('user',travel()); sync.queue({...travel().snapshot,name:'첫 편집'});
  const saving=sync.flush(); await Promise.resolve(); sync.queue({...travel().snapshot,name:'두 번째'}); release();
  assert.deepEqual(await saving,{ok:true}); assert.deepEqual(calls.map(c=>c.version),[1,2]); assert.equal(calls[1].snapshot.name,'두 번째'); assert.equal(sync.pending(),false);
});
test('conflict retains draft and refuses automatic overwrite',async()=>{
  const storage=fixture();const sync=createAccountSync({storage,send:async()=>{throw Object.assign(new Error('conflict'),{status:409});}});
  sync.open('user',travel());sync.queue({...travel().snapshot,name:'보존'});
  assert.equal((await sync.flush()).conflict,true);assert.equal(sync.pending(),true);assert.equal(sync.state().status,'conflict');
  const recovered=createAccountSync({storage,send:async()=>{}});const draft=recovered.open('user',travel());assert.equal(draft.name,'보존');assert.equal(recovered.pending(),true);
});
test('drafts belong to one user and logout clears the user draft',()=>{
  const storage=fixture();const sync=createAccountSync({storage,send:async()=>{}});
  sync.open('first',travel());sync.queue({...travel().snapshot,name:'비공개'});sync.close();
  assert.equal(sync.open('second',travel()).name,'원본');sync.close();sync.open('first',travel());sync.close({discard:true});
  assert.equal(storage.values.size,0);
});
test('updated timestamps alone never trigger saves',async()=>{
  let calls=0;const sync=createAccountSync({storage:fixture(),send:async()=>calls++});sync.open('user',travel());sync.queue({...travel().snapshot,updated:100});
  assert.equal(sync.pending(),false);await sync.flush();assert.equal(calls,0);
});
test('an old request finishing cannot clear a newer account request',async()=>{
  const resolvers=[];let calls=0;
  const sync=createAccountSync({storage:fixture(),send:async(id,body)=>{calls++;await new Promise(resolve=>resolvers.push(resolve));return {travel:{id,version:body.version+1}};}});
  sync.open('first',travel());sync.queue({...travel().snapshot,name:'first edit'});const old=sync.flush();
  sync.open('second',travel());sync.queue({...travel().snapshot,name:'second edit'});const current=sync.flush();
  resolvers[0]();await old;const duplicate=sync.flush();assert.equal(calls,2);resolvers[1]();await Promise.all([current,duplicate]);assert.equal(sync.pending(),false);
});
test('network failures retain latest edit and retry with the original version',async()=>{
  const calls=[];let offline=true;
  const sync=createAccountSync({storage:fixture(),send:async(id,body)=>{calls.push(body);if(offline)throw new Error('offline');return {travel:{id,version:body.version+1}};}});
  sync.open('user',travel());sync.queue({...travel().snapshot,name:'처음'});assert.equal((await sync.flush()).storageError,true);
  sync.queue({...travel().snapshot,name:'추가 편집'});await sync.flush();assert.equal(calls.length,1);
  offline=false;assert.equal((await sync.flush({retry:true})).ok,true);assert.equal(calls[1].version,1);assert.equal(calls[1].snapshot.name,'추가 편집');
});
test('journal storage failure is visible while the unsent snapshot remains in memory',async()=>{
  const storage={getItem:()=>null,setItem:()=>{throw new Error('quota');},removeItem:()=>{}};
  const sync=createAccountSync({storage,send:async()=>{throw new Error('offline');}});
  sync.open('user',travel());sync.queue({...travel().snapshot,name:'보관 필요'});await sync.flush();
  assert.equal(sync.state().journalFailed,true);assert.equal(sync.pending(),true);assert.equal(sync.state().status,'error');
});
