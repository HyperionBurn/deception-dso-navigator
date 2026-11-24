import assert from 'node:assert/strict';
import { test } from 'node:test';
import route from '../api/route.mjs';
import { FLOOR_MAP } from '../lib/floor-map.mjs';
import { planRoute } from '../lib/route-planner.mjs';

// T4 and T5 from qa/sim/SIM_REPORT.md, plus the Arabic forms of T1 and T3, on the real demo map.
const plan = request => planRoute(FLOOR_MAP, { destination_id: 'kitchen', ...request });

test('T4: likely_start says it is only for the first question of a trip', () => {
  const result = plan({});
  assert.deepEqual(result.likely_start, { landmark: 'the pitch room door', facing: 'reception' });
  assert.match(result.likely_start_note, /first question/);
});

test('T4: a facing or heading with no place means the trip may be under way, so no start guess', () => {
  for (const request of [{ facing: 'reception' }, { facing: 'team tables' }, { heading: 'north' }]) {
    const result = plan(request);
    assert.equal(result.status, 'needs_anchor', JSON.stringify(request));
    assert.equal(result.reason, 'current_anchor_required', JSON.stringify(request));
    assert.equal('likely_start' in result, false, JSON.stringify(request));
  }
});

test('T5: the route tool answers a facing with no place with a question, not HTTP 400', async t => {
  const environment = { NAVIGATOR_ROUTE_TOOL_KEY: 'route-key-for-tests', NAVIGATOR_ACCESS_CODE: 'other-1', ELEVENLABS_API_KEY: 'other-2' };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, environment);
  const call = body => route.fetch(new Request('https://example.invalid/api/route', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-navigator-route-key': 'route-key-for-tests' },
    body: JSON.stringify(body),
  }));
  for (const body of [{ destination_id: 'kitchen', facing: 'reception' }, { destination_id: 'kitchen', heading: 'north' }]) {
    const response = await call(body);
    assert.equal(response.status, 200, JSON.stringify(body));
    const result = await response.json();
    assert.equal(result.status, 'needs_anchor');
    assert.equal(result.reason, 'current_anchor_required');
  }
  for (const body of [{}, { facing: 'reception' }, { destination_id: 'kitchen', facing: 'reception', heading: 'north' }]) {
    assert.equal((await call(body)).status, 400, JSON.stringify(body));
  }
});

test('T1 in Arabic: place and facing in one sentence', () => {
  const result = plan({ current_landmark: 'عند العمود الأصفر، مواجه طاولات الفرق' });
  assert.equal(result.status, 'step');
  assert.equal(result.command, 'Turn around. Walk straight and stop at the cafeteria menu boards.');
  const unknownFacing = plan({ current_landmark: 'عند العمود الأصفر، مواجه قاعة العروض' });
  assert.equal(unknownFacing.reason, 'current_orientation_required', 'the place is found; the map has no route for that facing');
});

test('T3 in Arabic: the cafeteria on one side or only in view is not an arrival', () => {
  for (const text of ['الكافتيريا على يساري', 'الكافتيريا على اليمين', 'اشوف الكافتيريا', 'شايف المطبخ']) {
    const result = plan({ current_landmark: text });
    assert.equal(result.status, 'needs_anchor', text);
    assert.equal(result.reason, 'current_anchor_required', text);
  }
  for (const text of ['عند الكافتيريا', 'وصلنا المطبخ']) {
    assert.equal(plan({ current_landmark: text }).status, 'at_destination', text);
  }
});
