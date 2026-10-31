import { escapeHtml } from './util.js';
import { AI_PROVIDERS, verifyPlan } from './planner.js';
import { revisionDays, revisionEntries, revisionFingerprint, reviseDay, mergeDayRevision } from './day-revision.js';

export function setupDayRevision({ snapshot, currentDay, settings, ready, apply, openSettings }) {
  const $ = id => document.getElementById(id);
  const dialog = $('dayRevisionDialog');
  let base, entries = [], preview = null, controller = null, generation = 0, applying = false;
  const status = message => { $('dayRevisionStatus').textContent = message; };
  const cancel = () => { generation++; controller?.abort(); controller = null; preview = null; $('dayRevisionApply').disabled = true; $('dayRevisionGenerate').disabled = false; };
  const locked = () => [...dialog.querySelectorAll('[data-revision-lock]:checked')].map(e => e.value);
  const line = e => `<strong>${escapeHtml(e.name || e.title || '이동·휴식')}</strong><span>${escapeHtml(e.time || '시간 미정')}</span>`;
  function chooseDay() {
    cancel();
    entries = revisionEntries(base, $('dayRevisionDay').value);
    $('dayRevisionBefore').innerHTML = entries.map(e => `<li>${line(e)}${e.memo ? `<p>${escapeHtml(e.memo)}</p>` : ''}<label class="revision-lock"><input type="checkbox" data-revision-lock value="${e.id}"${/\[고정\]|예약/.test(e.memo) ? ' checked' : ''}>장소·시간 유지</label></li>`).join('');
    $('dayRevisionAfter').replaceChildren();
    status('수정할 내용을 적어 주세요. 원래 메모는 유지됩니다.');
  }
  $('dayRevisionOpen').onclick = () => {
    if (!ready()) return;
    base = structuredClone(snapshot());
    const days = [...revisionDays(base).keys()];
    $('dayRevisionDay').innerHTML = days.map(day => `<option value="${escapeHtml(day)}">${escapeHtml(day)}</option>`).join('');
    if (days.includes(currentDay())) $('dayRevisionDay').value = currentDay();
    $('dayRevisionRequest').value = '';
    $('dayRevisionProvider').textContent = `${AI_PROVIDERS[settings().provider]?.label || 'AI 제공업체 설정 필요'} · 선택한 날짜의 장소·시각·메모와 수정 요청을 전송합니다.`;
    chooseDay();
    dialog.showModal();
  };
  $('dayRevisionDay').onchange = chooseDay;
  $('dayRevisionRequest').oninput = () => { if (preview || controller) { cancel(); status('요청이 바뀌었어요. 수정안을 다시 만들어 주세요.'); } };
  $('dayRevisionBefore').onchange = () => { cancel(); status('유지 조건이 바뀌었어요. 수정안을 다시 만들어 주세요.'); };
  $('dayRevisionSettings').onclick = () => { dialog.close(); openSettings(); };
  dialog.addEventListener('cancel', event => { if (applying) event.preventDefault(); });
  dialog.addEventListener('close', cancel);
  $('dayRevisionForm').onsubmit = async event => {
    event.preventDefault();
    if (controller || applying) return;
    preview = null;
    $('dayRevisionApply').disabled = true;
    $('dayRevisionAfter').replaceChildren();
    const selected = settings();
    if (!AI_PROVIDERS[selected.provider] || !selected.key) { status('AI 설정에서 제공업체와 API 키를 저장해 주세요.'); return; }
    const day = $('dayRevisionDay').value, keep = locked();
    if (revisionFingerprint(snapshot()) !== revisionFingerprint(base)) { status('일정이 변경됐어요. 창을 닫고 현재 일정으로 다시 시작해 주세요.'); return; }
    const token = ++generation;
    controller = new AbortController();
    $('dayRevisionGenerate').disabled = true;
    status('AI가 이 날짜의 수정안을 만드는 중…');
    try {
      const proposal = await reviseDay({ snapshot: base, day, instruction: $('dayRevisionRequest').value.trim(), locked: keep },
        { provider: selected.provider, apiKey: selected.key, model: selected.model, signal: controller.signal });
      if (token !== generation) return;
      const added = proposal.items.map((item, index) => ({ item, index })).filter(x => !x.item.id);
      const places = new Map();
      if (added.length) {
        status('새 장소를 Google 지도에서 확인하는 중…');
        const plan = { days: [{ date: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '', items: added.map(({ item }) => ({ kind: 'place', place: item.name, place_ko: item.name, search: `${item.name} ${item.region}`, start: item.time.slice(0, 5), end: '', memo: '' })) }] };
        await verifyPlan(plan);
        if (token !== generation) return;
        plan.days[0].items.forEach((item, i) => { if (item.found && !item.issue) places.set(added[i].index, item.found); });
      }
      const removed = entries.filter(e => !proposal.items.some(i => i.id === e.id));
      $('dayRevisionAfter').innerHTML = `<p>${escapeHtml(proposal.summary)}</p><ol>${proposal.items.map((item, index) => {
        const old = entries.find(e => e.id === item.id);
        return `<li>${line({ ...item, title: old?.title })}<small>${!old ? '추가' : old.time !== item.time ? `${escapeHtml(old.time || '시간 미정')} → 시간 변경` : '기존 일정'}${!old ? places.has(index) ? ' · 지도 위치 확인' : ' · 지도 위치 확인 필요' : ''}</small>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}</li>`;
      }).join('')}</ol>${removed.length ? `<h4>제외되는 일정 ${removed.length}개</h4><ul>${removed.map(e => `<li>${line(e)}${e.memo ? `<p>${escapeHtml(e.memo)}</p>` : ''}</li>`).join('')}</ul>` : ''}`;
      if (places.size !== added.length) { status('위치를 확인하지 못했거나 확인이 필요한 새 장소가 있어 적용할 수 없어요. 지역·장소를 구체적으로 적어 다시 요청해 주세요.'); return; }
      mergeDayRevision(base, day, proposal, keep, places);
      preview = { proposal, keep, places, day };
      $('dayRevisionApply').disabled = false;
      status('변경 내용을 확인한 뒤 이 날짜에 적용하세요. 다른 날짜는 유지됩니다.');
    } catch (error) { if (token === generation) status(error.message || '수정안을 만들지 못했어요. 다시 시도해 주세요.'); }
    finally { if (token === generation) { controller = null; $('dayRevisionGenerate').disabled = false; } }
  };
  $('dayRevisionApply').onclick = async () => {
    if (!preview || applying) return;
    applying = true;
    const controls = [...dialog.querySelectorAll('button, input, select, textarea')];
    const disabled = controls.map(c => c.disabled);
    controls.forEach(c => { c.disabled = true; });
    try { await apply(base, mergeDayRevision(snapshot(), preview.day, preview.proposal, preview.keep, preview.places), preview.day); dialog.close(); }
    catch (error) { status(error.message); }
    finally { applying = false; controls.forEach((c, i) => { c.disabled = disabled[i]; }); }
  };
}
