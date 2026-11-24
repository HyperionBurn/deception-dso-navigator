import assert from 'node:assert/strict';
import { test } from 'node:test';
import route from '../api/route.mjs';
import { COURSE_DESTINATIONS } from '../lib/floor-map.mjs';
import { REHEARSAL_MAP } from '../lib/rehearsal-map.mjs';
import { auditMap, planFullRoute } from '../lib/route-planner.mjs';

test('rehearsal map audits clean: nothing rejected, all destinations reachable from start', () => {
  const audit = auditMap(REHEARSAL_MAP);
  assert.deepEqual(audit.rejected, []);
  for (const warning of audit.warnings) {
    assert.ok(!warning.includes('no checked anchor'), warning);
    assert.ok(!warning.includes('no reverse'), warning);
  }
  const startRows = audit.routes.filter(row => row.from === 'sign_a');
  assert.equal(startRows.length, COURSE_DESTINATIONS.length);
  for (const row of startRows) {
    assert.ok(Array.isArray(row.legs), `${row.destination}: ${row.status ?? 'no legs'}`);
  }
});

test('rehearsal map spans multi-leg routes in both directions', () => {
  const out = planFullRoute(REHEARSAL_MAP, {
    destination_id: 'meeting_room', current_landmark: 'sign A', facing: 'stage',
  });
  assert.equal(out.status, 'route');
  assert.deepEqual(out.legs.map(leg => leg.to), ['sign_b', 'sign_d', 'meeting_room']);
  assert.equal(out.legs[0].command, 'Turn left. Walk straight and stop at sign B.');

  const back = planFullRoute(REHEARSAL_MAP, {
    destination_id: 'call_booth_1', current_landmark: 'conference room', facing: 'hall',
  });
  assert.equal(back.status, 'route');
  assert.deepEqual(back.legs.map(leg => leg.to), ['sign_d', 'sign_b', 'call_booth_1']);
});

test('rehearsal map resolves spoken numeral aliases to distinct booths', () => {
  // "booth two" and "booth one" resolve to different anchors: the first leg
  // out of each reports its own from-id on the way to the kitchen.
  const one = planFullRoute(REHEARSAL_MAP, {
    destination_id: 'kitchen', current_landmark: 'booth one', facing: 'booths',
  });
  const two = planFullRoute(REHEARSAL_MAP, {
    destination_id: 'kitchen', current_landmark: 'booth two', facing: 'booths',
  });
  assert.equal(one.status, 'route');
  assert.equal(two.status, 'route');
  assert.equal(one.legs[0].from, 'call_booth_1');
  assert.equal(two.legs[0].from, 'call_booth_2');
  assert.equal(one.legs[0].to, 'sign_b');
  assert.equal(two.legs[0].to, 'sign_b');

  const arabic = planFullRoute(REHEARSAL_MAP, {
    destination_id: 'call_booth_3', current_landmark: 'اللافتة إي', facing: 'windows',
  });
  assert.equal(arabic.status, 'route');
  assert.deepEqual(arabic.legs.map(leg => leg.to), ['call_booth_3']);
});

const routeKey = 'synthetic-route-key';
const callRoute = body => route.fetch(new Request('https://example.invalid/api/route', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-navigator-route-key': routeKey },
  body: JSON.stringify(body),
}));

function withEnv(overrides, fn) {
  const keys = ['NAVIGATOR_ROUTE_TOOL_KEY', 'NAVIGATOR_MAP_VARIANT'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) {
    if (key in overrides) {
      if (overrides[key] === undefined) delete process.env[key];
      else process.env[key] = overrides[key];
    }
  }
  return fn().finally(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

const atSignA = { destination_id: 'call_booth_1', current_landmark: 'sign A', facing: 'stage' };

test('route API uses FLOOR_MAP by default and without the env var', async () => {
  for (const variant of [undefined, 'production']) {
    await withEnv({ NAVIGATOR_ROUTE_TOOL_KEY: routeKey, NAVIGATOR_MAP_VARIANT: variant }, async () => {
      const response = await callRoute(atSignA);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.status, 'needs_anchor');
      assert.equal(body.reason, 'current_anchor_required');
    });
  }
});

test('route API serves the rehearsal map only under NAVIGATOR_MAP_VARIANT=rehearsal', async () => {
  await withEnv({ NAVIGATOR_ROUTE_TOOL_KEY: routeKey, NAVIGATOR_MAP_VARIANT: 'rehearsal' }, async () => {
    const response = await callRoute(atSignA);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'step');
    assert.equal(body.command, 'Turn left. Walk straight and stop at sign B.');
    assert.equal(body.remaining_steps, 2);
    assert.equal(body.destination_landmark, 'call booth 1 sign');
  });
});
