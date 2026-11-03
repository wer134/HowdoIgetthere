const fingerprint = snapshot => JSON.stringify({...snapshot, updated:0});
const keyFor = user => `routeflow.accountDraft.v1:${user}`;

export function createAccountSync({send, storage, onState = () => {}}) {
  let current = null, pendingSnapshot = null, savedFingerprint = '', request = null, generation = 0;
  let status = 'idle', message = '', journalFailed = false;
  const state = () => ({status,message,journalFailed,travelId:current?.id,version:current?.version,pending:!!pendingSnapshot});
  const announce = () => onState(state());
  function journal() {
    try {
      if (current && pendingSnapshot) storage.setItem(keyFor(current.user), JSON.stringify({id:current.id,version:current.version,snapshot:pendingSnapshot}));
      else if (current) storage.removeItem(keyFor(current.user));
      journalFailed = false;
    } catch { journalFailed = true; }
  }
  function queue(snapshot) {
    if (!current || snapshot.id !== current.id) return;
    if (!pendingSnapshot && fingerprint(snapshot) === savedFingerprint) return;
    pendingSnapshot = structuredClone(snapshot);
    if (!['conflict','error','saving'].includes(status)) status='pending';
    journal(); announce();
  }
  async function flush({retry=false}={}) {
    if (request) return request;
    if (status==='conflict') return {conflict:true};
    if (status==='error' && !retry) return {storageError:true};
    const capturedGeneration=generation;
    const ownRequest=(async()=>{
      while (current && pendingSnapshot && capturedGeneration===generation) {
        const sending=structuredClone(pendingSnapshot), sendingFingerprint=fingerprint(sending);
        status='saving';message='';announce();
        try {
          const response=await send(current.id,{snapshot:sending,version:current.version});
          if (capturedGeneration!==generation) return {cancelled:true};
          if (!Number.isInteger(response?.travel?.version)) throw new Error('저장 응답을 확인할 수 없어요.');
          current.version=response.travel.version; savedFingerprint=sendingFingerprint;
          if (fingerprint(pendingSnapshot)===sendingFingerprint) pendingSnapshot=null;
          status=pendingSnapshot?'pending':'saved';journal();announce();
        } catch(error) {
          if (capturedGeneration!==generation) return {cancelled:true};
          status=error.status===409?'conflict':'error';message=error.message; journal();announce();
          return status==='conflict'?{conflict:true}:{storageError:true};
        }
      }
      return {ok:true};
    })();
    request=ownRequest;
    try {return await ownRequest;} finally {if(request===ownRequest)request=null;}
  }
  return {
    state, queue, flush,
    pending:()=>!!pendingSnapshot || !!request,
    active:()=>current?{...current}:null,
    open(user, travel, {recover=true}={}) {
      generation++;current={user,id:travel.id,version:travel.version};request=null;pendingSnapshot=null;
      savedFingerprint=fingerprint(travel.snapshot);status='saved';message='';
      if(recover) {
        try {
          const draft=JSON.parse(storage.getItem(keyFor(user)) || 'null');
          if(draft?.id===travel.id && draft.snapshot?.id===travel.id && Number.isInteger(draft.version)) {
            pendingSnapshot=draft.snapshot;status=draft.version===travel.version?'pending':'conflict';
            current.version=draft.version;
          }
        } catch {journalFailed=true;}
      } else journal();
      announce();return structuredClone(pendingSnapshot || travel.snapshot);
    },
    close({discard=false}={}) {
      if(discard && current) {try {storage.removeItem(keyFor(current.user));} catch {journalFailed=true;}}
      generation++;current=null;pendingSnapshot=null;request=null;savedFingerprint='';status='idle';message='';announce();
    },
  };
}
