import {moveWorkspaceItem, workspaceDays, workspaceFingerprint} from './workspace-model.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dayLabel = day => day || '날짜 미정';

export function initWorkspace({host,getSnapshot,getItems,getSelectedDay,onSelectDay,onApplySnapshot,onEditItem,onAddPlace,onShowMap,onNewTravel,onOpenSaved,onImport,onBackup,isBusy,notify}) {
  let mode = 'board', appliedMode = null, query = '', pending = null, dragged = null, applying = false;
  host.classList.add('workspace');
  host.innerHTML = `<div class="workspace-toolbar">
    <div class="workspace-view" role="group" aria-label="작업 화면"><button type="button" data-workspace-mode="board" aria-pressed="true">일정 정리</button><button type="button" data-workspace-mode="map" aria-pressed="false">지도 · 목록</button></div>
    <label class="workspace-board-search">장소 찾기<input type="search" placeholder="이름이나 메모 검색" aria-label="보드 장소 검색"></label>
    <button type="button" data-workspace-add>장소 추가</button></div>
    <div class="workspace-board"><div class="workspace-travel-actions"><button type="button" data-workspace-travel="new">새 여행</button><button type="button" data-workspace-travel="saved">저장한 여행</button><button type="button" data-workspace-travel="import">엑셀 가져오기</button><button type="button" data-workspace-travel="backup">전체 백업</button><span class="workspace-travel-name"></span></div><nav class="workspace-days" aria-label="보드 날짜"></nav><p class="workspace-hint">카드를 날짜로 끌어 놓거나 이동 버튼으로 순서를 정리하세요.</p><div class="workspace-columns"></div></div>
    <p class="workspace-status" role="status" aria-live="polite"></p>
    <dialog class="workspace-move-dialog" aria-labelledby="workspaceMoveTitle"><form method="dialog">
      <h2 id="workspaceMoveTitle">장소 이동</h2><label>날짜<select name="day"></select></label>
      <label>넣을 위치<select name="position"></select></label><p class="workspace-move-error" role="alert"></p>
      <div class="workspace-dialog-actions"><button type="button" data-workspace-cancel>취소</button><button type="submit">이동</button></div>
    </form></dialog>`;
  const board = host.querySelector('.workspace-board');
  const columns = host.querySelector('.workspace-columns');
  const daysNav = host.querySelector('.workspace-days');
  const search = host.querySelector('input[type=search]');
  const status = host.querySelector('.workspace-status');
  const dialog = host.querySelector('dialog');
  const form = dialog.querySelector('form');
  const daySelect = form.elements.day;
  const positionSelect = form.elements.position;
  const media = matchMedia('(max-width: 760px)');
  const medium = matchMedia('(max-width: 1100px)');
  const matches = item => !query || `${item.name || ''} ${item.memo || ''}`.toLocaleLowerCase().includes(query);
  const sourceFromCard = card => ({kind:card.dataset.workspaceKind,index:Number(card.dataset.workspaceIndex)});
  function announce(message) { status.textContent = message; notify?.(message); }
  function focusCard(index) {
    const card = columns.querySelector(`[data-workspace-kind="record"][data-workspace-index="${index}"]`);
    card?.focus({preventScroll:true});
    card?.scrollIntoView({block:'nearest',behavior:'instant'});
  }
  function setMode(value) {
    mode = value === 'map' ? 'map' : 'board';
    render();
  }
  function syncMode() {
    board.hidden = mode === 'map';
    host.querySelector('.workspace-board-search').hidden = mode === 'map';
    for (const button of host.querySelectorAll('[data-workspace-mode]')) button.setAttribute('aria-pressed',String(button.dataset.workspaceMode === mode));
    if (appliedMode === mode) return;
    // The application callback may render this workspace again.
    appliedMode = mode;
    onShowMap?.(mode === 'map');
  }
  function cardMarkup(item, kind, index, order, total) {
    const name = item.name || '이름 없는 장소';
    const controls = kind === 'record' ? `<button type="button" data-workspace-action="earlier" aria-label="${escape(name)} 앞으로" ${order === 0 ? 'disabled' : ''}>앞으로</button><button type="button" data-workspace-action="later" aria-label="${escape(name)} 뒤로" ${order === total-1 ? 'disabled' : ''}>뒤로</button>` : '';
    return `<article class="workspace-place" tabindex="-1" draggable="true" data-workspace-kind="${kind}" data-workspace-index="${index}" aria-label="${escape(name)}">
      <div class="workspace-place-heading"><span class="workspace-order">${kind === 'record' ? String(order+1).padStart(2,'0') : '후보'}</span><strong title="${escape(name)}">${escape(name)}</strong></div>
      ${item.timeText ? `<p class="workspace-time">${escape(item.timeText)}</p>` : ''}
      ${item.memo ? `<p class="workspace-memo" title="${escape(item.memo)}">${escape(item.memo)}</p>` : ''}
      <div class="workspace-place-actions">${controls}<button type="button" data-workspace-action="move" aria-label="${escape(name)} ${kind === 'record' ? '날짜와 위치 이동' : '일정에 넣기'}">${kind === 'record' ? '이동' : '일정에 넣기'}</button>${kind === 'record' ? `<button type="button" data-workspace-action="edit" aria-label="${escape(name)} 편집">편집</button>` : ''}</div></article>`;
  }
  function render() {
    const snapshot = getSnapshot();
    if (!snapshot) { host.hidden = true; appliedMode = null; return; }
    host.hidden = false;
    syncMode();
    host.querySelector('.workspace-travel-name').textContent = snapshot.name;
    host.querySelector('.workspace-travel-name').title = snapshot.name;
    const items = getItems();
    const days = workspaceDays(snapshot,items);
    const selected = days.includes(getSelectedDay()) ? getSelectedDay() : days[0];
    const count = media.matches ? 1 : medium.matches ? 2 : 3;
    const selectedIndex = days.indexOf(selected);
    const start = Math.min(selectedIndex,Math.max(0,days.length-count));
    const visibleDays = days.slice(start,start+count);
    daysNav.innerHTML = days.map(day=>`<button type="button" data-workspace-day="${escape(day)}" aria-pressed="${day === selected}">${escape(dayLabel(day))}</button>`).join('');
    const library = snapshot.library || [];
    columns.style.setProperty('--workspace-day-count',String(visibleDays.length));
    columns.innerHTML = `<details class="workspace-candidates" ${media.matches ? '' : 'open'}><summary>가고 싶은 곳 <span>${library.length}</span></summary><div class="workspace-candidate-list">${library.map((place,index)=>matches(place) ? cardMarkup(place,'library',index,0,library.length) : '').join('') || '<p class="workspace-empty">아직 후보가 없어요. 장소를 보관하면 여기에서 날짜별로 배치할 수 있어요.</p>'}</div></details>` + visibleDays.map(day=>{
      const dayItems = items.filter(item=>item.day === day);
      return `<section class="workspace-day" data-workspace-drop-day="${escape(day)}" aria-label="${escape(dayLabel(day))} 일정"><header><h2>${escape(dayLabel(day))}</h2><span>${dayItems.length}곳</span></header><div class="workspace-day-list">${dayItems.map((item,index)=>matches(item) ? cardMarkup(item,'record',item.recordIndex,index,dayItems.length) : '').join('') || `<p class="workspace-empty">${query ? '검색 결과가 없어요.' : '여유로운 하루예요. 후보를 옮기거나 장소를 추가해 보세요.'}</p>`}</div></section>`;
    }).join('');
    for (const button of host.querySelectorAll('[data-workspace-add]')) button.disabled = applying;
  }
  function positions() {
    const items = getItems().filter(item=>item.day === daySelect.value && !(pending?.source.kind === 'record' && item.recordIndex === pending.source.index));
    positionSelect.innerHTML = '<option value="">이 날짜의 마지막</option>' + items.map(item=>`<option value="${item.recordIndex}">${escape(item.name)} 앞</option>`).join('');
  }
  function openMove(source) {
    if (applying || isBusy?.()) return;
    const snapshot = getSnapshot(), items = getItems();
    const item = source.kind === 'record' ? items.find(value=>value.recordIndex === source.index) : snapshot.library[source.index];
    if (!item) return;
    pending = {source,fingerprint:workspaceFingerprint(snapshot)};
    const days = workspaceDays(snapshot,items);
    daySelect.innerHTML = days.map(day=>`<option value="${escape(day)}">${escape(dayLabel(day))}</option>`).join('');
    daySelect.value = days.includes(item.day) ? item.day : days.includes(getSelectedDay()) ? getSelectedDay() : days[0];
    dialog.querySelector('h2').textContent = `${item.name} · ${source.kind === 'record' ? '이동' : '일정에 넣기'}`;
    dialog.querySelector('.workspace-move-error').textContent = '';
    positions(); dialog.showModal(); daySelect.focus();
  }
  async function apply(source,target,fingerprint) {
    if (applying || isBusy?.()) return false;
    const before = getSnapshot();
    if (workspaceFingerprint(before) !== fingerprint) { announce('일정이 변경됐어요. 현재 카드에서 다시 이동해 주세요.'); return false; }
    applying = true;
    try {
      const result = moveWorkspaceItem(before,getItems(),source,target);
      const message = `${dayLabel(target.day)} 일정에 반영했어요.`;
      await onApplySnapshot(result.snapshot,{before:structuredClone(before),message});
      query = ''; search.value = ''; onSelectDay(target.day); render();
      status.textContent = message;
      focusCard(result.recordIndex);
      return true;
    } catch (error) { announce(error instanceof Error ? error.message : '이동하지 못했어요. 다시 시도해 주세요.'); return false; }
    finally { applying = false; host.querySelector('[data-workspace-add]').disabled = false; }
  }
  const onClick = async event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.workspaceMode) { setMode(button.dataset.workspaceMode); return; }
    if ('workspaceDay' in button.dataset) { onSelectDay(button.dataset.workspaceDay); render(); return; }
    if ('workspaceAdd' in button.dataset) { onAddPlace?.(); return; }
    if (button.dataset.workspaceTravel) { ({new:onNewTravel,saved:onOpenSaved,import:onImport,backup:onBackup})[button.dataset.workspaceTravel]?.(); return; }
    if ('workspaceCancel' in button.dataset) { dialog.close(); return; }
    const card = button.closest('[data-workspace-kind]');
    if (!card) return;
    const source = sourceFromCard(card), action = button.dataset.workspaceAction;
    if (action === 'move') { openMove(source); return; }
    if (action === 'edit') { onEditItem?.(source.index); return; }
    const items = getItems(), item = items.find(value=>value.recordIndex === source.index);
    if (!item) return;
    const sameDay = items.filter(value=>value.day === item.day), index = sameDay.indexOf(item);
    const beforeItem = action === 'earlier' ? sameDay[index-1] : sameDay[index+2];
    await apply(source,{day:item.day,beforeRecordIndex:beforeItem?.recordIndex ?? null},workspaceFingerprint(getSnapshot()));
  };
  const onSearch = () => { query = search.value.trim().toLocaleLowerCase(); render(); };
  const onSubmit = async event => {
    event.preventDefault();
    if (!pending) return;
    const current = pending;
    const target = {day:daySelect.value,beforeRecordIndex:positionSelect.value === '' ? null : Number(positionSelect.value)};
    dialog.close();
    await apply(current.source,target,current.fingerprint);
  };
  const onDragStart = event => {
    const card = event.target.closest('[data-workspace-kind]');
    if (!card || applying || isBusy?.()) { event.preventDefault(); return; }
    dragged = {source:sourceFromCard(card),fingerprint:workspaceFingerprint(getSnapshot())};
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain','routeflow-workspace');
    card.classList.add('is-dragging');
  };
  const onDragOver = event => { if (dragged && event.target.closest('[data-workspace-drop-day]')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } };
  const onDrop = async event => {
    const target = event.target.closest('[data-workspace-drop-day]');
    if (!target || !dragged) return;
    event.preventDefault();
    const current = dragged; dragged = null;
    const card = event.target.closest('[data-workspace-kind="record"]');
    const beforeRecordIndex = card ? Number(card.dataset.workspaceIndex) : null;
    if (current.source.kind === 'record' && beforeRecordIndex === current.source.index) return;
    await apply(current.source,{day:target.dataset.workspaceDropDay,beforeRecordIndex},current.fingerprint);
  };
  const onDragEnd = () => { dragged = null; for (const card of columns.querySelectorAll('.is-dragging')) card.classList.remove('is-dragging'); };
  const onClose = () => { const index = pending?.source.index; if (pending?.source.kind === 'record') focusCard(index); pending = null; };
  host.addEventListener('click',onClick); search.addEventListener('input',onSearch);
  form.addEventListener('submit',onSubmit); daySelect.addEventListener('change',positions); dialog.addEventListener('close',onClose);
  host.addEventListener('dragstart',onDragStart); host.addEventListener('dragover',onDragOver); host.addEventListener('drop',onDrop); host.addEventListener('dragend',onDragEnd);
  media.addEventListener('change',render); medium.addEventListener('change',render);
  render();
  return {render,setMode,destroy() {
    media.removeEventListener('change',render); medium.removeEventListener('change',render);
    host.removeEventListener('click',onClick); host.removeEventListener('dragstart',onDragStart); host.removeEventListener('dragover',onDragOver); host.removeEventListener('drop',onDrop); host.removeEventListener('dragend',onDragEnd);
    host.replaceChildren();
  }};
}
