// 구글 지도와 핀(Advanced Marker) 관리

const KOREA = { lat: 36.4, lng: 127.9 };

function toLiteral(position) {
  if (!position) return null;
  return typeof position.lat === 'function'
    ? { lat: position.lat(), lng: position.lng() }
    : { lat: Number(position.lat), lng: Number(position.lng) };
}

// 선 가운데에 진행 방향 화살표 (위쪽이 선의 진행 방향)
const ARROW_PATH = 'M 0,-2.5 2.5,2.5 -2.5,2.5 z';
const DOT_PATH = 'M -1,0 A 1,1 0 1,1 1,0 A 1,1 0 1,1 -1,0 z';
const DASH_PATH = 'M 0,-1 0,1';

// 구간 선의 세 가지 상태
//  normal   아무 구간도 고르지 않았을 때: 대중교통·차는 실선, 도보는 동그란 점, 경로를 찾기 전·못 찾은 구간은 파선
//  selected 고른 구간: 같은 모양을 더 굵고 진하게, 맨 위에
//  dim      다른 구간을 골랐을 때: 이동 수단과 상관없이 흐리고 가는 파선, 화살표 없음
// 점·파선 간격은 선 굵기(둥근 끝)를 빼고도 틈이 남도록 잡아, 굵어져도 실선처럼 붙어 보이지 않게 한다
function lineStyle(kind, color, state) {
  // 점선류는 선 자체를 투명하게 두고 굵게 잡아 클릭 영역으로 쓴다
  const symbols = (icons, zIndex) => ({ strokeColor: color, strokeOpacity: 0, strokeWeight: 12, icons, zIndex });
  if (state === 'dim') {
    return symbols([{
      icon: { path: DASH_PATH, strokeColor: color, strokeOpacity: 0.4, strokeWeight: 2.5, scale: 2.5 },
      offset: '0',
      repeat: '13px',
    }], 5);
  }
  const selected = state === 'selected';
  const zIndex = selected ? 30 : 10;
  const arrow = {
    icon: { path: ARROW_PATH, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeOpacity: 1, strokeWeight: 1, scale: selected ? 1.8 : 1.4 },
    offset: '50%',
  };
  if (kind === 'walk') {
    return symbols([{
      icon: { path: DOT_PATH, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeOpacity: 1, strokeWeight: 1, scale: selected ? 3.2 : 2.5 },
      offset: '0',
      repeat: selected ? '13px' : '11px',
    }], zIndex);
  }
  if (kind === 'straight') {
    return symbols([{
      icon: { path: DASH_PATH, strokeColor: color, strokeOpacity: selected ? 1 : 0.85, strokeWeight: selected ? 5 : 3.5, scale: selected ? 5 : 4 },
      offset: '0',
      repeat: selected ? '25px' : '20px',
    }, arrow], zIndex);
  }
  return { strokeColor: color, strokeOpacity: selected ? 1 : 0.9, strokeWeight: selected ? 7 : 5, icons: [arrow], zIndex: zIndex + 1 };
}

// 실선 아래 흰 테두리. 흐린 상태에서는 숨긴다
function outlineStyle(state) {
  const selected = state === 'selected';
  return { visible: state !== 'dim', strokeColor: '#ffffff', strokeOpacity: 0.85, strokeWeight: selected ? 11 : 8, icons: [], zIndex: selected ? 29 : 9 };
}

function darken(hex, amount = 0.28) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.round(((n >> shift) & 255) * (1 - amount));
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export class MapView {
  constructor(el, { mapId, onSelect, onMove, onSelectLeg, onSelectRec }) {
    this.el = el;
    this.mapId = mapId;
    this.onSelect = onSelect;
    this.onMove = onMove;
    this.onSelectLeg = onSelectLeg;
    this.onSelectRec = onSelectRec;
    this.recs = new Map(); // 추천 장소 키 → { marker, el }
    this.anchor = null;
    this.markers = new Map(); // 행 번호 → { marker, pin, visible }
    this.legs = new Map(); // 구간 키 → { lines: [{ line, kind }], color, visible, points }
    this.selected = null;
    this.selectedLeg = null;
    this.pick = null;
  }

  async init() {
    const [maps, marker, core] = await Promise.all(
      ['maps', 'marker', 'core'].map((name) => google.maps.importLibrary(name)),
    );
    this.lib = {
      AdvancedMarkerElement: marker.AdvancedMarkerElement,
      PinElement: marker.PinElement,
      LatLngBounds: core.LatLngBounds,
      Polyline: maps.Polyline,
    };
    this.map = new maps.Map(this.el, {
      center: KOREA,
      zoom: 7,
      mapId: this.mapId,
      mapTypeControl: false,
      streetViewControl: false,
      clickableIcons: false,
      gestureHandling: 'greedy',
    });
    this.info = new maps.InfoWindow({ maxWidth: 320 });
    this.map.addListener('click', (e) => {
      if (!this.pick || !e.latLng) return;
      const done = this.pick;
      this.stopPick();
      done(e.latLng.lat(), e.latLng.lng());
    });
  }

  setMarker(idx, { position, color, label, title, visible }) {
    let entry = this.markers.get(idx);
    if (!position) {
      if (entry) { entry.marker.map = null; this.markers.delete(idx); }
      if (this.selected === idx) this.info.close();
      return;
    }
    if (!entry) {
      const pin = new this.lib.PinElement({ background: color, borderColor: darken(color), glyphColor: '#fff', glyphText: label });
      const marker = new this.lib.AdvancedMarkerElement({
        position,
        title,
        content: typeof HTMLElement !== 'undefined' && pin instanceof HTMLElement ? pin : pin.element,
        gmpClickable: true,
      });
      marker.addEventListener('gmp-click', () => this.onSelect(idx, 'map'));
      marker.addEventListener('gmp-dragend', () => {
        const p = toLiteral(marker.position);
        this.onMove(idx, p.lat, p.lng);
      });
      entry = { marker, pin, visible: true };
      this.markers.set(idx, entry);
    } else {
      entry.pin.background = color;
      entry.pin.borderColor = darken(color);
      entry.pin.glyphText = label;
      entry.marker.position = position;
      entry.marker.title = title;
    }
    entry.visible = visible;
    entry.marker.map = visible ? this.map : null;
    this.applySelected(idx);
  }

  setVisible(idx, visible) {
    const entry = this.markers.get(idx);
    if (!entry) return;
    entry.visible = visible;
    entry.marker.map = visible ? this.map : null;
    if (!visible && this.selected === idx) this.info.close();
  }

  // 선택된 핀은 크게, 맨 위에, 끌어서 옮길 수 있게
  applySelected(idx) {
    const entry = this.markers.get(idx);
    if (!entry) return;
    const on = idx === this.selected;
    entry.pin.scale = on ? 1.35 : 1;
    entry.marker.zIndex = on ? 1000 : null;
    entry.marker.gmpDraggable = on;
  }

  highlight(idx) {
    const prev = this.selected;
    this.selected = idx;
    if (prev != null) this.applySelected(prev);
    if (idx != null) this.applySelected(idx);
  }

  focus(idx, html, zoomIn) {
    const entry = this.markers.get(idx);
    if (!entry || !entry.visible) return;
    this.map.panTo(toLiteral(entry.marker.position));
    if (zoomIn && this.map.getZoom() < 15) this.map.setZoom(15);
    // 일정 장소 정보는 화면 오른쪽 패널에서 표시한다.
    this.info.close();
  }

  closeInfo() {
    this.info.close();
  }

  setMapType(type) {
    this.map.setMapTypeId(type === 'hybrid' ? 'hybrid' : 'roadmap');
  }

  fitAll() {
    const points = [...this.markers.values()].filter((e) => e.visible).map((e) => toLiteral(e.marker.position));
    if (!points.length) return;
    if (points.length === 1) {
      this.map.setCenter(points[0]);
      this.map.setZoom(15);
      return;
    }
    const bounds = new this.lib.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    const wide = window.innerWidth > 950;
    const left = document.querySelector('.left-column')?.getBoundingClientRect().width || 0;
    this.map.fitBounds(bounds, wide ? { top: 180, bottom: 180, left: left + 40, right: 420 } : 48);
  }

  clear() {
    for (const { marker } of this.markers.values()) marker.map = null;
    this.markers.clear();
    this.selected = null;
    this.clearLegs();
    this.info.close();
  }

  /* ── 동선 ── */

  /** segments: [{ kind: 'walk'|'transit'|'drive'|'bike'|'straight', path: [[lat, lng], ...] }] */
  setLeg(key, { segments, color, visible }) {
    this.removeLeg(key);
    const state = this.legState(key);
    const lines = [];
    for (const seg of segments) {
      if (seg.path.length < 2) continue;
      const path = seg.path.map(([lat, lng]) => ({ lat, lng }));
      // 실선 아래에 흰 테두리를 깔아 도로 위에서도 잘 보이게
      if (seg.kind !== 'walk' && seg.kind !== 'straight') {
        lines.push({ kind: 'outline', line: new this.lib.Polyline({ path, ...outlineStyle(state), map: visible ? this.map : null }) });
      }
      lines.push({ kind: seg.kind, line: new this.lib.Polyline({ path, ...lineStyle(seg.kind, color, state), map: visible ? this.map : null }) });
    }
    for (const { line } of lines) line.addListener('click', () => this.onSelectLeg(key));
    this.legs.set(key, { lines, color, visible, points: segments.flatMap((s) => s.path) });
  }

  removeLeg(key) {
    const entry = this.legs.get(key);
    if (!entry) return;
    for (const { line } of entry.lines) line.setMap(null);
    this.legs.delete(key);
  }

  clearLegs() {
    for (const key of [...this.legs.keys()]) this.removeLeg(key);
    this.selectedLeg = null;
  }

  setLegVisible(key, visible) {
    const entry = this.legs.get(key);
    if (!entry) return;
    entry.visible = visible;
    for (const { line } of entry.lines) line.setMap(visible ? this.map : null);
  }

  legState(key) {
    if (this.selectedLeg == null) return 'normal';
    return key === this.selectedLeg ? 'selected' : 'dim';
  }

  // 구간을 고르면 나머지는 모두 흐리게, 고르지 않으면 모두 원래대로
  highlightLeg(key) {
    this.selectedLeg = key;
    for (const [k, entry] of this.legs) {
      const state = this.legState(k);
      for (const { kind, line } of entry.lines) {
        line.setOptions(kind === 'outline' ? outlineStyle(state) : lineStyle(kind, entry.color, state));
      }
    }
  }

  fitLeg(key) {
    const entry = this.legs.get(key);
    if (!entry || !entry.points.length) return;
    const bounds = new this.lib.LatLngBounds();
    entry.points.forEach(([lat, lng]) => bounds.extend({ lat, lng }));
    this.info.close();
    this.map.fitBounds(bounds, 80);
  }

  /* ── 주변 추천 ── */

  /** list: [{ key, lat, lng, label, color, title }] — 일정 핀과 헷갈리지 않게 동그란 번호 표시 */
  setRecs(list) {
    this.clearRecs();
    for (const r of list) {
      const el = document.createElement('div');
      el.className = 'rec-pin';
      el.style.setProperty('--c', r.color);
      el.textContent = r.label;
      const marker = new this.lib.AdvancedMarkerElement({
        position: { lat: r.lat, lng: r.lng }, title: r.title, content: el, gmpClickable: true, zIndex: 500, map: this.map,
      });
      marker.addEventListener('gmp-click', () => this.onSelectRec?.(r.key));
      this.recs.set(r.key, { marker, el });
    }
  }

  clearRecs() {
    for (const { marker } of this.recs.values()) marker.map = null;
    this.recs.clear();
    this.setAnchor(null);
  }

  // 일정에 없는 대표 장소(직접 검색한 곳)는 별 핀으로
  setAnchor(anchor) {
    if (this.anchor) this.anchor.map = null;
    this.anchor = null;
    if (!anchor) return;
    const pin = new this.lib.PinElement({ background: '#202928', borderColor: '#000', glyphColor: '#fff', glyphText: '★' });
    this.anchor = new this.lib.AdvancedMarkerElement({
      position: { lat: anchor.lat, lng: anchor.lng },
      title: anchor.name,
      content: typeof HTMLElement !== 'undefined' && pin instanceof HTMLElement ? pin : pin.element,
      zIndex: 900,
      map: this.map,
    });
  }

  focusRec(key, html, pan = true) {
    for (const [k, { el }] of this.recs) el.classList.toggle('active', k === key);
    const entry = this.recs.get(key);
    if (!entry) return;
    if (pan) this.map.panTo(toLiteral(entry.marker.position));
    this.info.setContent(html);
    this.info.open({ map: this.map, anchor: entry.marker, shouldFocus: false });
  }

  fitPoints(points) {
    if (!points.length) return;
    const bounds = new this.lib.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    this.info.close();
    this.map.fitBounds(bounds, 56);
  }

  startPick(callback) {
    this.pick = callback;
    this.map.setOptions({ draggableCursor: 'crosshair' });
  }

  stopPick() {
    this.pick = null;
    this.map.setOptions({ draggableCursor: null });
  }
}
