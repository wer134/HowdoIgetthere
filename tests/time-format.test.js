import test from 'node:test';
import assert from 'node:assert/strict';
import { timeMatches, parseTimeRange } from '../js/routes.js';

test('Korean midnight and minute syntax retain original match offsets for schedule edits', () => {
  const text = '출발 오전 12시 5분 → 오후 2:30 도착';
  const times = timeMatches(text);
  assert.deepEqual(times.map(t=>t.minutes), [5,870]);
  for (const {match} of times) assert.equal(text.slice(match.index,match.index+match[0].length),match[0]);
  assert.deepEqual(parseTimeRange('오전 12시'),{start:0,end:0});
  assert.deepEqual(parseTimeRange('25:30'),{start:null,end:null});
});
