import test from 'node:test';
import assert from 'node:assert/strict';
import { placePhoto, placeTypes, normalizeDetails } from '../js/nearby.js';

test('사진만 요청하고 첫 사진과 출처를 반환한다', async (t) => {
  const requested = [];
  globalThis.google = { maps: { importLibrary: async () => ({ Place: class {
    constructor(options) { assert.equal(options.id, 'place-id'); assert.equal(options.requestedLanguage, 'ko'); }
    async fetchFields(options) {
      requested.push(options.fields);
      this.displayName = '한국어 장소 이름';
      this.formattedAddress = '일본 후쿠오카시';
      this.photos = [
        { getURI: () => 'https://example.com/photo', authorAttributions: [{ displayName: '촬영자', uri: 'https://example.com/author' }] },
        { getURI: () => 'https://example.com/alternate', authorAttributions: [] },
      ];
    }
  } }) } };
  t.after(() => { delete globalThis.google; });
  const photo = await placePhoto('place-id', 'ko');
  assert.deepEqual(requested, [['displayName', 'formattedAddress', 'photos']]);
  assert.equal(photo.url, 'https://example.com/photo');
  assert.equal(photo.name, '한국어 장소 이름');
  assert.equal(photo.address, '일본 후쿠오카시');
  assert.equal(photo.alternates[0].url, 'https://example.com/alternate');
  assert.equal(photo.authors[0].name, '촬영자');
});

test('사진이 없는 장소는 빈 결과로 처리한다', async (t) => {
  globalThis.google = { maps: { importLibrary: async () => ({ Place: class {
    async fetchFields() { this.photos = []; }
  } }) } };
  t.after(() => { delete globalThis.google; });
  assert.equal((await placePhoto('no-photo', 'ko')).url, '');
});

test('사진 객체가 getUrl을 제공하는 경우에도 주소를 읽는다', async (t) => {
  globalThis.google = { maps: { importLibrary: async () => ({ Place: class {
    async fetchFields() { this.photos = [{ getUrl: () => 'https://example.com/legacy-photo' }]; }
  } }) } };
  t.after(() => { delete globalThis.google; });
  assert.equal((await placePhoto('legacy', 'ko')).url, 'https://example.com/legacy-photo');
});

test('일정 수정용 장소 유형을 Google Places ID로 확인한다', async (t) => {
  globalThis.google = { maps: { importLibrary: async () => ({ Place: class {
    constructor(options) { assert.equal(options.id, 'restaurant-id'); }
    async fetchFields(options) {
      assert.deepEqual(options.fields, ['primaryType', 'types']);
      this.primaryType = 'korean_restaurant';
      this.types = ['restaurant', 'food'];
    }
  } }) } };
  t.after(() => { delete globalThis.google; });
  assert.deepEqual(await placeTypes('restaurant-id'), ['korean_restaurant', 'restaurant', 'food']);
});

test('한국어 요청에도 일본어로 온 장소 설명은 화면에서 제외한다', () => {
  const detail = normalizeDetails({
    editorialSummary: { text: '日本語の説明です' },
    reviews: [{ text: { text: '日本語のレビューです' } }, { text: { text: '한국어 후기입니다' } }],
  });
  assert.equal(detail.about, '');
  assert.deepEqual(detail.reviews.map((review) => review.text), ['한국어 후기입니다']);
});
