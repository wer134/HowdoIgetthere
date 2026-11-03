import { createAccountSync } from './account-sync.js';
import { validTravel } from './travel-store.js';
import { escapeHtml } from './util.js';
import { itineraryContent } from './travel-portability.js';

export function setupAccounts({snapshot, ready, saveGuest, restore, reset, busy, canLeave = () => true, notify, backup}) {
  const byId=id=>document.getElementById(id);
  const dialog=byId('accountDialog');
  let session={available:false,user:null,freeAI:false}, operation=false, sharedToken='', epoch=0, aiRequest=null;
  async function api(path, body, method=body===undefined?'GET':'POST') {
    const response=await fetch(`/api${path}`,{method,credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json','X-RouteFlow-Request':'1'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const data=await response.json();
    if(!response.ok) throw Object.assign(new Error(data.message || '요청을 완료하지 못했어요.'),{status:response.status,code:data.error});
    return data;
  }
  const journal={getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)};
  const sync=createAccountSync({send:(id,body)=>api(`/travels/${encodeURIComponent(id)}`,body,'PUT'),storage:journal,onState:renderStatus});
  const fingerprint=value=>JSON.stringify({...value,updated:0});
  function unchanged(stamp,id,generation) {return epoch===generation && snapshot().id===id && fingerprint(snapshot())===stamp;}
  function renderStatus() {
    const state=sync.state(), active=sync.active();
    byId('accountStatus').textContent=active ? ({saving:'계정에 저장 중…',pending:'계정 변경사항 대기 중',saved:'계정에 저장됨',conflict:'다른 곳에서 일정이 변경됐어요. 현재 편집을 백업하고 최신본을 확인하세요.',error:'계정 저장 실패. 재시도하거나 탭을 닫기 전에 파일로 백업하세요.'}[state.status] || '') : '기기 저장 · 계정으로 복사할 여행을 직접 선택하세요.';
    byId('accountStatus').dataset.state=state.status;
    if(active) byId('travelSaveStatus').textContent=byId('accountStatus').textContent;
    for(const button of document.querySelectorAll('[data-account-open]')) button.textContent=active ? ({saved:'계정 · 저장됨',saving:'계정 · 저장 중',pending:'계정 · 대기',conflict:'계정 · 충돌',error:'계정 · 저장 실패'}[state.status] || '계정 · 저장') : session.user?'계정 · 저장':'로그인 · 계정';
    byId('accountRetry').hidden=!['error','pending'].includes(state.status);
    byId('accountLatest').hidden=!active;
    byId('accountDraftWarning').hidden=!state.pending;
    byId('accountDraftWarning').textContent=state.journalFailed?'이 탭에도 임시본을 저장하지 못했어요. 반드시 파일로 백업하세요.':'미전송 편집은 이 탭의 임시본입니다. 탭을 닫기 전에 전체 백업을 내려받으세요.';
    byId('accountCopy').disabled=operation || !ready() || !!active;
    for(const id of ['accountShareCreate','accountShareRevoke','accountSuggestionsRefresh','accountAIGenerate']) byId(id).disabled=operation || !active;
  }
  function renderSession() {
    for(const button of document.querySelectorAll('[data-account-open]')) button.textContent=session.user?'계정 · 저장':'로그인 · 계정';
    byId('accountIdentity').textContent=session.user?`${session.user.name || '여행자'} · ${session.user.email || ''}`:'로그인 없이도 여행을 만들고 백업할 수 있어요.';
    byId('accountLogin').hidden=!!session.user || !session.available;
    byId('accountUnavailable').hidden=session.available;
    byId('accountContent').hidden=!session.user;
    byId('accountFreeAI').hidden=!session.freeAI || !session.user;
    byId('accountPhoneState').textContent=session.user?.phoneVerified?'휴대폰 인증됨':'무료 AI를 사용하려면 휴대폰 인증이 필요합니다.';
    renderStatus();
  }
  async function run(action) {
    if(operation) return;
    operation=true;renderStatus();
    const frozen=[document.querySelector('.app-shell'),...document.querySelectorAll('dialog:not(#accountDialog):not(#sharedDialog)')].filter(Boolean).map(element=>({element,inert:element.inert}));
    for(const {element} of frozen)element.inert=true;
    byId('accountClose').disabled=true;
    try {await action();} catch(error) {const message=error.message || '연결하지 못했어요. 다시 시도해 주세요.';byId('accountMessage').textContent=message;if(byId('sharedDialog').open)byId('sharedSuggestionStatus').textContent=message;notify(message);}
    finally {for(const {element,inert} of frozen)element.inert=inert;operation=false;byId('accountClose').disabled=false;renderStatus();}
  }
  async function beforeLeave() {
    if(!canLeave()) {notify('일정 편집의 변경을 저장하거나 편집창을 닫은 뒤 이동해 주세요.');return false;}
    if(!sync.active()) return true;
    if(ready()) sync.queue(snapshot());
    const result=await sync.flush();
    if(!result.ok) {notify('계정에 보내지 못한 변경이 있어 이동을 멈췄어요. 재시도하거나 전체 백업 후 최신본을 열어 주세요.');return false;}
    return true;
  }
  async function openTravel(id,{recover=true}={}) {
    if(busy() || !(await beforeLeave())) return;
    if(!sync.active() && ready()) {const saved=await saveGuest();if(!saved?.ok)throw new Error('현재 기기 여행을 저장하지 못했어요. 먼저 백업해 주세요.');}
    const generation=epoch, currentId=snapshot().id, stamp=fingerprint(snapshot());
    const {travel}=await api(`/travels/${encodeURIComponent(id)}`);
    if(generation!==epoch || !session.user) return;
    if(!unchanged(stamp,currentId,generation))throw new Error('여는 동안 현재 여행이 바뀌었어요. 다시 열어 주세요.');
    if(!validTravel(travel.snapshot)) throw new Error('계정 여행 형식이 올바르지 않아 현재 여행을 유지했어요.');
    const next=sync.open(session.user.id,travel,{recover});
    if(!validTravel(next)) {sync.close();throw new Error('임시본 형식을 확인할 수 없어요. 서버 원본을 다시 열어 주세요.');}
    restore(next);renderStatus();dialog.close();
  }
  async function listTravels() {
    if(!session.user) return;
    const {travels}=await api('/travels');
    byId('accountTravels').innerHTML=travels.length?travels.map(t=>`<article class="account-entry"><strong>${escapeHtml(t.name)}</strong><small>버전 ${t.version}</small><button type="button" data-account-travel="${escapeHtml(t.id)}">열기</button></article>`).join(''):'<p>아직 계정에 저장한 여행이 없어요.</p>';
  }
  async function listSuggestions() {
    const active=sync.active();if(!active)return;
    const {suggestions}=await api(`/travels/${encodeURIComponent(active.id)}/suggestions`);
    if(sync.active()?.id!==active.id)return;
    byId('accountSuggestions').innerHTML=suggestions.length?suggestions.map(s=>`<article class="account-entry"><strong>${escapeHtml(s.place.name)}</strong><p>${escapeHtml(s.place.memo || s.place.address || '')}</p><small>${escapeHtml(s.authorName || '동행자')}</small>${s.status==='pending'?`<button type="button" data-accept-suggestion="${escapeHtml(s.id)}">후보로 수락</button>`:'<span>처리됨</span>'}</article>`).join(''):'<p>아직 도착한 장소 제안이 없어요.</p>';
  }
  for(const button of document.querySelectorAll('[data-account-open]')) button.addEventListener('click',()=>{renderSession();dialog.showModal();run(listTravels);});
  byId('accountClose').onclick=()=>{if(!operation)dialog.close();};
  dialog.addEventListener('cancel',event=>{if(operation)event.preventDefault();});
  byId('accountBackup').onclick=backup;
  byId('accountLogin').onclick=()=>run(async()=>{if(!(await beforeLeave()))return;if(ready() && !sync.active()){const result=await saveGuest();if(!result?.ok)throw new Error('기기 저장 실패. 로그인 전에 전체 백업으로 보관하세요.');}if(sharedToken)sessionStorage.setItem('routeflow.pendingShare',sharedToken);location.assign('/api/auth/login');});
  byId('accountCopy').onclick=()=>run(async()=>{
    if(!session.user || !ready() || busy())return;
    if(!(await beforeLeave()))return;
    const saved=await saveGuest();if(!saved?.ok)throw new Error('기기 원본을 저장하지 못했어요. 전체 백업 후 다시 시도하세요.');
    const before=structuredClone(snapshot()), generation=epoch;
    const {travel}=await api('/travels',{snapshot:before});
    if(generation!==epoch)return;
    if(!validTravel(travel.snapshot))throw new Error('계정 저장 응답의 여행 형식을 확인할 수 없어요.');
    if(!unchanged(fingerprint(before),before.id,generation)){await listTravels();throw new Error('복사 중 현재 여행이 바뀌었어요. 계정에는 요청 시점의 복사본이 저장됐고, 현재 편집은 기기에 유지됩니다.');}
    sync.open(session.user.id,travel,{recover:false});restore(travel.snapshot);
    byId('accountMessage').textContent='계정으로 복사했어요. 기기에 저장한 원본도 그대로 남아 있습니다.';await listTravels();
  });
  byId('accountTravels').onclick=event=>{const button=event.target.closest('[data-account-travel]');if(button)run(()=>openTravel(button.dataset.accountTravel));};
  byId('accountRetry').onclick=()=>run(async()=>{if(ready())sync.queue(snapshot());await sync.flush({retry:true});});
  byId('accountLatest').onclick=()=>run(async()=>{
    const active=sync.active();if(!active || busy())return;
    if(!canLeave()){await beforeLeave();return;}
    if(sync.pending() && !confirm('현재 미전송 편집을 버리고 서버 최신본을 열까요? 필요한 내용은 먼저 전체 백업으로 보관하세요.'))return;
    const generation=epoch,stamp=fingerprint(snapshot());
    const {travel}=await api(`/travels/${encodeURIComponent(active.id)}`);
    if(!unchanged(stamp,active.id,generation))throw new Error('최신본을 가져오는 동안 편집이 바뀌었어요. 현재 편집을 유지합니다.');
    if(!validTravel(travel.snapshot))throw new Error('서버 여행 형식을 확인할 수 없어요.');
    sync.open(session.user.id,travel,{recover:false});restore(travel.snapshot);renderStatus();
  });
  byId('accountLogout').onclick=()=>run(async()=>{
    if(busy() || !(await beforeLeave()))return;
    await api('/logout',{});epoch++;const active=sync.active();sync.close({discard:true});
    if(session.user) {sessionStorage.removeItem(`routeflow.accountEditor.v1:${session.user.id}`);sessionStorage.removeItem(`routeflow.accountEditor.v1:${session.user.id}:notes`);}
    session={...session,user:null};aiRequest=null;byId('accountAIResult').textContent='';byId('accountPhone').value='';byId('accountCode').value='';byId('accountTravels').replaceChildren();byId('accountSuggestions').replaceChildren();byId('accountShareLink').value='';
    if(active)reset();renderSession();byId('accountMessage').textContent='로그아웃했어요. 계정 편집 임시본을 이 탭에서 지웠습니다.';
  });
  byId('accountShareCreate').onclick=()=>run(async()=>{
    if(!(await beforeLeave()))return;const active=sync.active();if(!active)return;
    const generation=epoch;
    const result=await api(`/travels/${encodeURIComponent(active.id)}/share`,{version:active.version});
    if(epoch!==generation || sync.active()?.id!==active.id)return;
    const url=new URL(location.href);url.search='';url.hash=`share=${encodeURIComponent(result.token)}`;
    byId('accountShareLink').value=url.href;byId('accountMessage').textContent='30일 읽기 링크를 만들었어요. 링크를 가진 사람은 일정·메모·후보를 볼 수 있습니다. 이전 링크는 만료됩니다.';
  });
  byId('accountShareRevoke').onclick=()=>run(async()=>{const active=sync.active();if(!active)return;await api(`/travels/${encodeURIComponent(active.id)}/share`,{},'DELETE');byId('accountShareLink').value='';byId('accountMessage').textContent='공유 링크를 취소했어요.';});
  byId('accountSuggestionsRefresh').onclick=()=>run(listSuggestions);
  byId('accountSuggestions').onclick=event=>{const button=event.target.closest('[data-accept-suggestion]');if(button)run(async()=>{
    if(!(await beforeLeave()))return;const active=sync.active();if(!active)return;
    const generation=epoch,stamp=fingerprint(snapshot());
    const {travel}=await api(`/travels/${encodeURIComponent(active.id)}/suggestions/${encodeURIComponent(button.dataset.acceptSuggestion)}/accept`,{version:active.version});
    if(!unchanged(stamp,active.id,generation))throw new Error('수락하는 동안 편집이 바뀌었어요. 현재 편집을 백업한 뒤 최신본에서 수락된 후보를 확인하세요.');
    if(!validTravel(travel.snapshot))throw new Error('여행 형식을 확인할 수 없어요.');
    sync.open(session.user.id,travel,{recover:false});restore(travel.snapshot);await listSuggestions();notify('동행자 제안을 후보로 수락했어요. 일정에는 직접 배치해 주세요.');
  });};
  byId('accountPhoneStart').onclick=()=>run(async()=>{await api('/phone/start',{phone:byId('accountPhone').value});byId('accountMessage').textContent='인증번호를 보냈어요. 재발송은 60초 뒤에 가능합니다.';});
  byId('accountPhoneCheck').onclick=()=>run(async()=>{await api('/phone/check',{code:byId('accountCode').value});session=await api('/session');byId('accountCode').value='';renderSession();});
  byId('accountAIForm').onsubmit=event=>{event.preventDefault();run(async()=>{
    if(!(await beforeLeave()))return;const active=sync.active();if(!active)return;
    const prompt=byId('accountAIPrompt').value;
    if(!aiRequest || aiRequest.travel!==active.id || aiRequest.prompt!==prompt)aiRequest={travel:active.id,prompt,requestId:crypto.randomUUID()};
    const result=await api(`/travels/${encodeURIComponent(active.id)}/ai`,{requestId:aiRequest.requestId,prompt});
    if(result.status!=='completed'){byId('accountMessage').textContent=result.status==='pending'?'아직 처리 중입니다. 잠시 후 같은 요청을 다시 확인해 주세요.':'요청에 실패했어요. 사용량은 반환되지 않을 수 있습니다.';return;}
    byId('accountAIResult').textContent=result.text;byId('accountMessage').textContent='무료 AI 제안입니다. 일정은 변경하지 않았어요. 내용을 확인하고 직접 반영하세요.';
  });};
  async function openShared(token) {
    const result=await api(`/shared/${encodeURIComponent(token)}`);
    if(!validTravel(result.snapshot))throw new Error('공유 여행 형식을 확인할 수 없어요.');
    sharedToken=token;byId('sharedTitle').textContent=result.snapshot.name;
    byId('sharedItinerary').innerHTML=itineraryContent(result.snapshot);
    byId('sharedCandidates').innerHTML=(result.snapshot.library || []).map(p=>`<article class="account-entry"><strong>${escapeHtml(p.name)}</strong><p>${escapeHtml(p.memo || '')}</p></article>`).join('');
    byId('sharedLoginHint').hidden=!!session.user;byId('sharedSuggestionForm').hidden=!session.user;byId('sharedDialog').showModal();
  }
  byId('sharedClose').onclick=()=>byId('sharedDialog').close();
  byId('sharedLogin').onclick=()=>run(async()=>{if(!(await beforeLeave()))return;sessionStorage.setItem('routeflow.pendingShare',sharedToken);location.assign('/api/auth/login');});
  byId('sharedSuggestionForm').onsubmit=event=>{event.preventDefault();run(async()=>{
    await api(`/shared/${encodeURIComponent(sharedToken)}/suggestions`,{place:{name:byId('sharedPlaceName').value.trim(),address:byId('sharedPlaceAddress').value.trim(),memo:byId('sharedPlaceMemo').value.trim()}});
    byId('sharedSuggestionStatus').textContent='주인에게 제안을 보냈어요. 수락되면 후보에 추가됩니다.';byId('sharedSuggestionForm').reset();
  });};
  window.addEventListener('beforeunload',event=>{if(sync.active() && ready())sync.queue(snapshot());if(sync.pending()){event.preventDefault();event.returnValue='';}});
  async function initialize() {
    try {session=await api('/session');} catch {session={available:false,user:null,freeAI:false};}
    renderSession();
    const token=new URLSearchParams(location.hash.slice(1)).get('share') || sessionStorage.getItem('routeflow.pendingShare');
    if(token){sessionStorage.removeItem('routeflow.pendingShare');await run(()=>openShared(token));return;}
    if(session.user) {
      let draft;try{draft=JSON.parse(sessionStorage.getItem(`routeflow.accountDraft.v1:${session.user.id}`) || 'null');}catch{}
      if(draft?.id)await run(()=>openTravel(draft.id));
    }
  }
  initialize().catch(()=>notify('계정 임시 저장소에 접근하지 못했어요. 기기 여행은 파일로 백업해 주세요.'));
  return {
    active:()=>sync.active(),pending:()=>sync.pending(),beforeLeave,
    save:async value=>{sync.queue(value);return sync.flush();},
    changed:()=>{if(sync.active() && ready())sync.queue(snapshot());renderStatus();},
    detach:()=>{epoch++;sync.close({discard:true});renderStatus();},
    editorKey:()=>sync.active()?`routeflow.accountEditor.v1:${session.user.id}`:null,
    render:renderStatus,
  };
}
