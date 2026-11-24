import assert from 'node:assert/strict';
import { test } from 'node:test';
import route from '../api/route.mjs';
import { COURSE_DESTINATIONS, FLOOR_MAP } from '../lib/floor-map.mjs';
import { auditMap, planRoute, tokenize } from '../lib/route-planner.mjs';

// Fictional labels, evidence, and topology. Never load this map in production.
const evidence = {
  checked_at: 'Synthetic time',
  checked_by: 'Synthetic verifier',
  reference: 'Synthetic record only',
};
const anchor = (id, landmark) => ({ id, landmark, evidence });
const edge = (from, to, action, entry_pose, exit_pose) => ({
  from, to, action, entry_pose, exit_pose, evidence,
});
const north = { heading: 'north' };
const east = { heading: 'east' };
const west = { heading: 'west' };
const facing = { facing: 'the blue panel' };
const anchors = [
  anchor('start', 'the green panel'),
  anchor('junction', 'the blue panel'),
  anchor('alternate', 'the orange panel'),
  anchor('meeting_room', 'the fictional meeting sign'),
  anchor('conference_room', 'the fictional conference sign'),
];
const map = {
  anchors,
  edges: [
    edge('start', 'junction', 'walk_straight', north, facing),
    edge('junction', 'meeting_room', 'left_then_straight', facing, west),
    edge('junction', 'conference_room', 'right_then_straight', facing, east),
    edge('alternate', 'conference_room', 'approach_visible', null, null),
  ],
};

test('guide destinations do not establish anchors, routes, or arrival', () => {
  assert.equal(COURSE_DESTINATIONS.length, 8);
  const empty = { anchors: [], edges: [] };
  for (const id of COURSE_DESTINATIONS) {
    assert.deepEqual(planRoute(empty, { destination_id: id, current_id: id }), {
      status: 'unverified', reason: 'destination_not_checked',
    });
  }
});

test('a capital sign letter joins the word sign into one token', () => {
  assert.ok(tokenize('Sign B.').has('signb'));
  assert.ok(!tokenize('Sign B.').has('sign'));
  assert.deepEqual(tokenize('sign A'), new Set(['signa']));
  const plain = tokenize('a sign a few metres on');
  assert.ok(plain.has('sign'));
  assert.ok(!plain.has('signa'));
});

test('needs_anchor offers the checked start as likely_start only when position is unknown', () => {
  const local = {
    anchors: [
      anchor('kitchen', 'the kitchen sign'),
      anchor('team_tables', 'the team tables sign'),
    ],
    edges: [],
    start: { anchor: 'kitchen', facing: 'window' },
  };
  const result = planRoute(local, { destination_id: 'team_tables' });
  assert.equal(result.status, 'needs_anchor');
  assert.deepEqual(result.likely_start, { landmark: 'the kitchen sign', facing: 'window' });
  const supplied = planRoute(local, {
    destination_id: 'team_tables', current_landmark: 'the fountain',
  });
  assert.equal(supplied.status, 'needs_anchor');
  assert.equal('likely_start' in supplied, false);
  const noStart = { anchors: local.anchors, edges: [] };
  assert.equal('likely_start' in planRoute(noStart, { destination_id: 'team_tables' }), false);
});

test('a destination without a checked anchor is unverified before position is asked', () => {
  const local = {
    anchors: [
      anchor('kitchen', 'the kitchen sign'),
      anchor('team_tables', 'the team tables sign'),
      anchor('waypoint', 'the waypoint sign'),
    ],
    edges: [],
  };
  const expected = {
    status: 'unverified', reason: 'destination_not_checked',
    mapped_destinations: ['team_tables', 'kitchen'],
  };
  assert.deepEqual(planRoute(local, { destination_id: 'meeting_room' }), expected);
  assert.deepEqual(planRoute(local, {
    destination_id: 'meeting_room', current_landmark: 'the fountain',
  }), expected);
  const missing = planRoute(local, { destination_id: 'kitchen' });
  assert.equal(missing.status, 'needs_anchor');
  assert.equal(missing.reason, 'current_anchor_required');
  assert.equal(missing.known_landmarks.length, 3);
});

test('facing the next stop of a straight leg implies its entry pose', () => {
  const local = {
    anchors: [
      anchor('start', 'the start line'),
      anchor('team_tables', 'the team tables sign'),
      anchor('kitchen', 'the kitchen sign'),
    ],
    edges: [
      edge('start', 'team_tables', 'walk_straight', { facing: 'window' }, { facing: 'window' }),
      edge('team_tables', 'kitchen', 'left_then_straight', { facing: 'window' }, { facing: 'counter' }),
    ],
  };
  const implied = planRoute(local, {
    destination_id: 'kitchen', current_id: 'start', facing: 'the team tables sign',
  });
  assert.equal(implied.status, 'step');
  assert.equal(implied.command, 'Walk straight and stop at the team tables sign.');
  assert.equal(implied.next_id, 'team_tables');
  assert.deepEqual(planRoute(local, {
    destination_id: 'kitchen', current_id: 'team_tables', facing: 'the kitchen sign',
  }), {
    status: 'needs_anchor', reason: 'current_orientation_required', known_facings: ['window'],
  });
  const twoPoses = {
    ...local,
    edges: [...local.edges,
      edge('start', 'team_tables', 'walk_straight', { facing: 'door' }, { facing: 'window' })],
  };
  const ambiguous = planRoute(twoPoses, {
    destination_id: 'kitchen', current_id: 'start', facing: 'the team tables sign',
  });
  assert.equal(ambiguous.status, 'needs_anchor');
  assert.equal(ambiguous.reason, 'current_orientation_required');
  const directLabel = {
    ...local,
    edges: [...local.edges,
      edge('start', 'kitchen', 'walk_straight', { facing: 'the team tables sign' }, { facing: 'counter' })],
  };
  const direct = planRoute(directLabel, {
    destination_id: 'kitchen', current_id: 'start', facing: 'the team tables sign',
  });
  assert.equal(direct.status, 'step');
  assert.equal(direct.command, 'Walk straight and stop at the kitchen sign.');
});

test('the shipped FLOOR_MAP audits clean', () => {
  const audit = auditMap(FLOOR_MAP);
  assert.deepEqual(audit.rejected, []);
  if (FLOOR_MAP.anchors.length) {
    assert.ok(FLOOR_MAP.survey.checked_at);
    assert.ok(FLOOR_MAP.survey.checked_by);
    assert.ok(FLOOR_MAP.survey.reference);
  }
});

test('unverified results list the other mapped destinations', () => {
  const local = {
    anchors: [
      anchor('kitchen', 'the kitchen sign'),
      anchor('team_tables', 'the team tables sign'),
      anchor('waypoint', 'the waypoint sign'),
    ],
    edges: [],
  };
  const expected = ['team_tables', 'kitchen'];
  assert.deepEqual(planRoute(local, {
    destination_id: 'meeting_room', current_id: 'kitchen',
  }), {
    status: 'unverified', reason: 'destination_not_checked',
    mapped_destinations: expected,
  });
  assert.deepEqual(planRoute(local, {
    destination_id: 'outside', current_id: 'kitchen',
  }), {
    status: 'unverified', reason: 'unknown_destination',
    mapped_destinations: expected,
  });
  const empty = { anchors: [], edges: [] };
  const result = planRoute(empty, { destination_id: 'outside', current_id: 'kitchen' });
  assert.deepEqual(result, { status: 'unverified', reason: 'unknown_destination' });
  assert.equal('mapped_destinations' in result, false);
});

test('plans one step and reroutes from the last confirmed or newly observed anchor', () => {
  const original = planRoute(map, { destination_id: 'meeting_room', current_id: 'start', ...north });
  assert.deepEqual(original, {
    status: 'step', command: 'Walk straight and stop at the blue panel.',
    next_id: 'junction', expected_landmark: 'the blue panel',
    exit_pose: facing, remaining_steps: 2,
    destination_landmark: 'the fictional meeting sign',
  });
  assert.deepEqual(planRoute(map, { destination_id: 'conference_room', current_id: 'start', ...north }), {
    ...original, destination_landmark: 'the fictional conference sign',
  });
  assert.deepEqual(planRoute(map, { destination_id: 'conference_room', current_id: 'junction', ...facing }), {
    status: 'step', command: 'Turn right. Walk straight and stop at the fictional conference sign.',
    next_id: 'conference_room', expected_landmark: 'the fictional conference sign',
    exit_pose: east, remaining_steps: 1,
    destination_landmark: 'the fictional conference sign',
  });
  assert.equal(planRoute(map, { destination_id: 'conference_room', current_id: 'alternate' }).next_id, 'conference_room');
  assert.equal(planRoute(map, { destination_id: 'conference_room' }).status, 'needs_anchor');
});

test('wrong or unknown observed orientation cannot authorize a pose-sensitive step', () => {
  for (const badPose of [{}, west]) {
    assert.deepEqual(planRoute(map, { destination_id: 'meeting_room', current_id: 'start', ...badPose }), {
      status: 'needs_anchor', reason: 'current_orientation_required', known_facings: ['north'],
    });
  }
  for (const badPose of [{}, east, { facing: 'the red panel' }]) {
    assert.equal(planRoute(map, {
      destination_id: 'meeting_room', current_id: 'junction', ...badPose,
    }).status, 'needs_anchor');
  }
});

test('raw observations resolve only by a unique exact normalized checked landmark', () => {
  const input = { destination_id: 'conference_room', current_landmark: '  THE   BLUE PANEL ', ...facing };
  assert.deepEqual(planRoute(map, input), planRoute(map, {
    destination_id: 'conference_room', current_id: 'junction', ...facing,
  }));
  assert.equal(planRoute(map, { ...input, current_landmark: 'blue panel' }).status, 'step');
  assert.equal(planRoute(map, { ...input, current_landmark: 'the bleu panel' }).status, 'needs_anchor');
  const duplicate = anchor('other_junction', 'The Blue Panel');
  assert.equal(planRoute({ ...map, anchors: [...anchors, duplicate] }, input).status, 'needs_anchor');
  assert.equal(planRoute({ ...map, anchors: [...anchors, { ...duplicate, evidence: null }] }, input).status, 'step');
  assert.equal(planRoute(map, {
    destination_id: 'conference_room', current_landmark: 'THE FICTIONAL CONFERENCE SIGN',
  }).status, 'at_destination');
});

test('checks pose at intermediate nodes and can revisit nodes in distinct poses', () => {
  const bad = edge('start', 'junction', 'walk_straight', north, east);
  const good = edge('start', 'junction', 'left_then_straight', north, facing);
  const final = map.edges[1];
  const input = { destination_id: 'meeting_room', current_id: 'start', ...north };
  for (const badExit of [bad, { ...bad, exit_pose: null }]) {
    assert.deepEqual(planRoute({ anchors, edges: [badExit, final] }, input), {
      status: 'unverified', reason: 'no_checked_route',
      mapped_destinations: ['conference_room'],
    });
  }
  assert.equal(planRoute({ anchors, edges: [bad, good, final] }, input).command,
    'Turn left. Walk straight and stop at the blue panel.');
});

test('ignores unchecked, undirected, unknown-pose, and unsupported route data', () => {
  const first = map.edges[0];
  const input = { destination_id: 'meeting_room', current_id: 'start', ...north };
  for (const invalid of [
    { ...first, evidence: { ...evidence, reference: '' } },
    { ...first, action: 'coordinate_move' },
    { ...first, entry_pose: null },
    { ...first, from: first.to, to: first.from },
  ]) {
    assert.equal(planRoute({ anchors, edges: [invalid, map.edges[1]] }, input).status, 'unverified');
  }
  assert.equal(planRoute({ ...map, anchors: anchors.filter(a => a.id !== 'junction') }, input).status, 'unverified');
  assert.equal(planRoute(map, { ...input, destination_id: 'outside' }).status, 'unverified');
});

test('arrival requires the observed, checked destination ID', () => {
  const destination_id = 'conference_room';
  const input = { destination_id, current_id: destination_id };
  assert.deepEqual(planRoute(map, input), {
    status: 'at_destination', destination_id, expected_landmark: 'the fictional conference sign',
    requires_physical_confirmation: true,
  });
  assert.equal(planRoute(map, { ...input, current_id: 'junction', ...facing }).status, 'step');
  const unchecked = { ...map, anchors: anchors.map(a => a.id === destination_id ? { ...a, evidence: null } : a) };
  assert.equal(planRoute(unchecked, input).status, 'unverified');
});

test('route API accepts only its dedicated header and valid observation input', async t => {
  const routeKey = 'synthetic-route-key';
  const accessCode = 'synthetic-browser-code';
  const providerKey = 'synthetic-provider-key';
  const environment = { NAVIGATOR_ROUTE_TOOL_KEY: routeKey, NAVIGATOR_ACCESS_CODE: accessCode, ELEVENLABS_API_KEY: providerKey };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, environment);
  const body = { destination_id: 'meeting_room', current_id: 'meeting_room' };
  const request = (key, payload = body, contentType = 'application/json') => route.fetch(new Request(
    'https://example.invalid/api/route', {
      method: 'POST',
      headers: { 'content-type': contentType, ...(key ? { 'x-navigator-route-key': key } : {}) },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    },
  ));

  const get = await route.fetch(new Request('https://example.invalid/api/route'));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  for (const wrongKey of [null, accessCode, providerKey, `${routeKey}, ${routeKey}`]) {
    assert.equal((await request(wrongKey, { ...body, access_code: accessCode })).status, 401);
  }
  assert.equal((await request(routeKey, body, 'text/plain')).status, 415);
  for (const invalid of [
    '{', { ...body, heading: 'left' }, { ...body, ...north, ...facing },
    { ...body, current_landmark: 'the meeting sign' }, { destination_id: 'meeting_room', current_landmark: ' ' },
    { ...body, next_id: 'meeting_room' }, { ...body, map: {} }, ' '.repeat(2049),
  ]) assert.equal((await request(routeKey, invalid)).status, 400);

  const result = await request(routeKey);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const planned = await result.json();
  assert.equal(planned.status, 'unverified');
  assert.equal(planned.reason, 'destination_not_checked');
  const raw = await request(routeKey, {
    destination_id: 'kitchen', current_landmark: 'the unknown marker', ...north,
  });
  assert.equal(raw.status, 200);
  assert.equal((await raw.json()).status, 'needs_anchor');
  process.env.NAVIGATOR_ROUTE_TOOL_KEY = accessCode;
  assert.equal((await request(accessCode)).status, 503);
  delete process.env.NAVIGATOR_ROUTE_TOOL_KEY;
  assert.equal((await request(routeKey)).status, 503);
});
