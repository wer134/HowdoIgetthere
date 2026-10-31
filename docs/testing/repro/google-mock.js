// Google SDK 모의 응답. 실제 Google 요청/지도 렌더링 검증이 아니다.
(() => {
  window.__mock = { searches: [], fields: [], routes: [], query: {}, details: {}, routeQueue: [], mapDelay: 0, markers: {}, legs: {}, events: [] };
  const m = window.__mock;
  const wait = ms => new Promise(r => setTimeout(r, ms || 0));
  const sdkPlace = p => ({ ...p, displayName: p.name || p.displayName, formattedAddress: p.address || '', googleMapsURI: p.url || '', location: { lat: () => p.lat ?? 35, lng: () => p.lng ?? 139 } });
  class Place {
    constructor(o) { Object.assign(this, o); }
    static async searchByText(req) {
      m.searches.push({ ...req, at: Date.now() });
      const cfg = m.query[req.textQuery] || { results: [] };
      await wait(cfg.delay);
      if (cfg.error) throw new Error(cfg.error);
      if (m.offline) throw new Error('NETWORK_OFFLINE');
      return { places: (cfg.results || []).map(sdkPlace) };
    }
    static async searchNearby(req) { return Place.searchByText({ ...req, textQuery: '__nearby' }); }
    async fetchFields(req) {
      m.fields.push({ id: this.id, fields: req.fields, at: Date.now() });
      const cfg = m.details[this.id] || {};
      await wait(cfg.delay);
      if (cfg.error) throw new Error(cfg.error);
      Object.assign(this, cfg, { displayName: cfg.name || this.id, formattedAddress: cfg.address || '테스트 주소' });
      this.photos = (cfg.photos || []).map(url => ({ getURI: () => url, authorAttributions: [] }));
      return { place: this };
    }
  }
  window.google = { maps: { importLibrary: async name => {
    if (name === 'maps') { await wait(m.mapDelay); return {}; }
    if (name === 'places') return { Place, SearchNearbyRankPreference: { POPULARITY: 'POPULARITY', DISTANCE: 'DISTANCE' } };
    if (name === 'routes') return { Route: { computeRoutes: async req => {
      m.routes.push({ ...req, at: Date.now() });
      const cfg = m.routeQueue.shift() || {};
      await wait(cfg.delay);
      if (cfg.error) throw new Error(cfg.error);
      return { routes: cfg.none ? [] : [{ distanceMeters: 1000, durationMillis: 600000, path: [req.origin, req.destination], legs: [] }] };
    } } };
    return {};
  } } };
})();
