// 지도 호출 기록용 대역. 실제 Google 지도 DOM/제스처는 검증하지 않는다.
export class MapView {
  constructor(el, options) { this.options = options; window.__map = this; }
  async init() { window.__mock.events.push('map-init'); }
  clear() { window.__mock.markers = {}; }
  setMarker(i, value) { window.__mock.markers[i] = value; }
  setVisible(i, value) { if(window.__mock.markers[i]) window.__mock.markers[i].visible = value; }
  clearLegs() { window.__mock.legs = {}; }
  setLeg(i, value) { window.__mock.legs[i] = value; }
  removeLeg(i) { delete window.__mock.legs[i]; }
  setLegVisible(i, value) { if(window.__mock.legs[i]) window.__mock.legs[i].visible = value; }
  startPick(fn) { this.pick = fn; }
  stopPick() { this.pick = null; }
  clearRecs() {} closeInfo() {} fitAll() {} fitPoints() {} highlight() {} highlightLeg() {}
  setAnchor() {} setRecs() {} setMapType() {} fitLeg() {} focus() {} focusRec() {} zoomBy() {} zoomTo() {}
}
