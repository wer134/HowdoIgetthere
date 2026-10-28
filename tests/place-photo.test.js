import test from 'node:test';
import assert from 'node:assert/strict';
import { placePhoto } from '../js/nearby.js';

test('사진만 요청하고 첫 사진과 출처를 반환한다', async (t) => {
  const requested = [];
  globalThis.google = { maps: { importLibrary: async () => ({ Place: class {
    constructor(options) { assert.equal(options.id, 'place-id'); }
    async fetchFields(options) {
      requested.push(options.fields);
      this.photos = [{ getURI: () => 'https://example.com/photo', authorAttributions: [{ displayName: '촬영자', uri: 'https://example.com/author' }] }];
    }
  } }) } };
  t.after(() => { delete globalThis.google; });
  const photo = await placePhoto('place-id', 'ko');
  assert.deepEqual(requested, [['photos']]);
  assert.equal(photo.url, 'https://example.com/photo');
  assert.equal(photo.authors[0].name, '촬영자');
});

test('사진이 없는 장소는 빈 결과로 처리한다', async (t) => {
  globalThis.google = { maps: { importLibrary: async () => ({ Place: class {
    async fetchFields() { this.photos = []; }
  } }) } };
  t.after(() => { delete globalThis.google; });
  assert.equal(await placePhoto('no-photo', 'ko'), null);
});
