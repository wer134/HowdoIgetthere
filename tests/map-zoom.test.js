import test from 'node:test';
import assert from 'node:assert/strict';
import { MapView } from '../js/mapview.js';

test('드래그 슬라이더와 버튼이 지도 줌을 바꾸고 지도 변경을 알린다', async (t) => {
  const listeners = new Map();
  const changes = [];
  class FakeMap {
    constructor(_el, options) { this.zoom = options.zoom; assert.equal(options.zoomControl, false); }
    addListener(name, callback) { listeners.set(name, callback); }
    getZoom() { return this.zoom; }
    setZoom(level) { this.zoom = level; listeners.get('zoom_changed')?.(); }
  }
  globalThis.google = { maps: { importLibrary: async (name) => name === 'maps'
    ? { Map: FakeMap, InfoWindow: class { close() {} }, Polyline: class {} }
    : name === 'marker' ? { AdvancedMarkerElement: class {}, PinElement: class {} }
      : { LatLngBounds: class {} } } };
  t.after(() => { delete globalThis.google; });
  const view = new MapView({}, { mapId: 'DEMO_MAP_ID', onZoomChange: (level) => changes.push(level) });
  await view.init();
  view.zoomTo('12');
  view.zoomBy(-2);
  view.zoomTo(100);
  view.zoomTo(-10);
  assert.deepEqual(changes, [7, 12, 10, 20, 3]);
});
