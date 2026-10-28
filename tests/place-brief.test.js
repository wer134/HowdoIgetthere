import test from 'node:test';
import assert from 'node:assert/strict';
import { placeBrief } from '../js/nearby.js';

test('추천 장소 유형에 맞는 한국어 설명을 만든다', () => {
  assert.match(placeBrief({ type: 'museum', types: [] }, 'sights'), /박물관.*전시/);
  assert.match(placeBrief({ type: 'ramen_restaurant', types: ['restaurant'] }, 'food'), /라멘 음식점/);
  assert.match(placeBrief({ type: 'cafe', types: [] }, 'cafe'), /카페.*음료·디저트/);
});

test('유형 정보가 없으면 장소에 대한 주장을 덧붙이지 않는다', () => {
  assert.equal(placeBrief({ type: '', types: [] }), 'Google 지도에서 찾은 장소예요.');
});
