import test from 'node:test';
import assert from 'node:assert/strict';
import { examples, exampleSnapshot } from '../js/examples.js';
import { travelPlan } from '../js/plan.js';
import { parseTimeRange } from '../js/routes.js';
import { validTravel } from '../js/travel-store.js';

for (const id of ['busan', 'seoul', 'tokyo']) {
  test(id + ' example copies retain ordered places, times and independent records', () => {
    const city = examples[id];
    const snapshot = exampleSnapshot(id);
    assert.ok(validTravel(snapshot));
    assert.equal(city.legs.length, city.stops.length - 1);
    assert.deepEqual(snapshot.places.map(entry => entry.place.name), city.stops.map(stop => stop.name));
    city.stops.forEach((stop, i) => {
      const [hours, minutes] = stop.time.split(':').map(Number);
      assert.equal(parseTimeRange(snapshot.records[i].cells[snapshot.mapping.time].v).start, hours * 60 + minutes);
      if (i) {
        assert.equal(travelPlan(snapshot.records, i - 1, i, snapshot.mapping).planned, city.legs[i - 1].minutes);
        assert.equal(snapshot.records[i].cells[snapshot.mapping.mode].v, city.legs[i - 1].mode);
      }
    });
    snapshot.records[0].cells[0].v = '개인 수정';
    assert.equal(exampleSnapshot(id).records[0].cells[0].v, city.stops[0].name);
  });
}
test('unknown city never creates an example', () => {
  for (const id of ['unknown', '__proto__', 'constructor']) assert.equal(exampleSnapshot(id), null);
});
