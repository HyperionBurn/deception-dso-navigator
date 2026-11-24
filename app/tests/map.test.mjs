import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COURSE_DESTINATIONS } from '../lib/floor-map.mjs';
import { auditMap, planFullRoute, planRoute } from '../lib/route-planner.mjs';

// Fictional labels, evidence, and topology. Never load this map in production.
const evidence = {
  checked_at: 'Synthetic time',
  checked_by: 'Synthetic verifier',
  reference: 'Synthetic record only',
};
const anchor = (id, landmark, aliases) => ({
  id, landmark, ...(aliases ? { aliases } : {}), evidence,
});
const edge = (from, to, action, entry_pose, exit_pose) => ({
  from, to, action, entry_pose, exit_pose, evidence,
});
const north = { heading: 'north' };

const map = {
  anchors: [
    anchor('gate', 'the palm gate', ['main gate', 'بوابة النخيل']),
    anchor('hall', 'the main hall sign', ['big sign']),
    anchor('call_booth_1', 'call booth one', ['booth 1', 'كابينة ١']),
    anchor('call_booth_2', 'call booth two', ['booth 2', 'كابينة ٢']),
    anchor('kitchen', 'the kitchen', ['galley']),
    anchor('kitchen_annex', 'kitchen entrance'),
  ],
  edges: [
    edge('gate', 'hall', 'walk_straight', north, { facing: 'the main hall sign' }),
    edge('hall', 'call_booth_1', 'left_then_straight', { facing: 'the main hall sign' }, null),
    edge('call_booth_1', 'call_booth_2', 'approach_visible', null, null),
    edge('hall', 'kitchen', 'right_then_straight', { facing: 'the main hall sign' }, null),
    edge('kitchen', 'call_booth_2', 'walk_straight', north, null),
    edge('kitchen_annex', 'call_booth_2', 'approach_visible', null, null),
  ],
};

const route = (m, request) => planRoute(m, { destination_id: 'call_booth_2', ...request });

test('exact landmark and alias observations both resolve', () => {
  assert.equal(route(map, { current_landmark: 'the palm gate', ...north }).status, 'step');
  const viaAlias = route(map, { current_landmark: 'the main gate', ...north });
  assert.equal(viaAlias.status, 'step');
  assert.equal(viaAlias.next_id, 'hall');
  const viaStopwords = route(map, { current_landmark: 'I am standing at the main gate', ...north });
  assert.equal(viaStopwords.next_id, 'hall');
});

test('Arabic aliases match through tashkeel, alef variants, and leading ال', () => {
  for (const observed of ['بوابة النخيل', 'بَوَابَةُ النَّخِيل', 'بوابه النخيل', 'عند بوابة النخيل']) {
    assert.equal(route(map, { current_landmark: observed, ...north }).status, 'step', observed);
  }
});

test('English and Arabic numerals resolve to the matching booth only', () => {
  for (const observed of ['booth two', 'second booth', 'booth 2', '2nd booth']) {
    assert.equal(route(map, { current_landmark: observed }).status, 'at_destination', observed);
  }
  for (const observed of ['booth one', 'first booth', 'booth 1', '1st booth']) {
    const result = route(map, { current_landmark: observed });
    assert.equal(result.status, 'step', observed);
    assert.equal(result.next_id, 'call_booth_2');
  }
  // Arabic digit alias on booth 2; Arabic ordinal word in the observation.
  assert.equal(route(map, { current_landmark: 'الكابينة الثاني' }).status, 'at_destination');
  assert.equal(route(map, { current_landmark: 'الكابينة الاول' }).status, 'step');
  // Spoken booth-3 matches neither booth.
  assert.equal(route(map, { current_landmark: 'booth three' }).status, 'needs_anchor');
});

test('the longest matching phrase wins across anchors', () => {
  // "kitchen" resolves to the kitchen anchor, whose only leg needs a heading.
  assert.deepEqual(route(map, { current_landmark: 'kitchen' }), {
    status: 'needs_anchor',
    reason: 'current_orientation_required',
    known_facings: ['north'],
  });
  // "kitchen entrance" scores higher on the annex anchor, which routes freely.
  assert.equal(route(map, { current_landmark: 'the kitchen entrance' }).status, 'step');
});

test('a top-score tie is reported as ambiguous with candidate landmarks', () => {
  const tied = {
    ...map,
    anchors: [...map.anchors, anchor('desk_a', 'team desk'), anchor('desk_b', 'the team desk')],
  };
  assert.deepEqual(route(tied, { current_landmark: 'team desk' }), {
    status: 'needs_anchor',
    reason: 'ambiguous_landmark',
    candidates: ['team desk', 'the team desk'],
  });
});

test('an unmatched observation lists known landmarks, start anchor first', () => {
  const withStart = { ...map, start: { anchor: 'kitchen', heading: 'east' } };
  const result = route(withStart, { current_landmark: 'the fountain' });
  assert.equal(result.status, 'needs_anchor');
  assert.equal(result.reason, 'current_anchor_required');
  assert.equal(result.known_landmarks[0], 'the kitchen');
  assert.deepEqual(result.known_landmarks.slice(1),
    ['the palm gate', 'the main hall sign', 'call booth one', 'call booth two', 'kitchen entrance']);
});

test('an observed facing resolves to a canonical label through an alias', () => {
  const result = route(map, { current_id: 'hall', facing: 'the big sign' });
  assert.equal(result.status, 'step');
  assert.equal(result.command, 'Turn left. Walk straight and stop at call booth one.');
  // An unrecognizable facing behaves like no pose at all.
  const unknown = route(map, { current_id: 'hall', facing: 'the red door' });
  assert.deepEqual(unknown, {
    status: 'needs_anchor',
    reason: 'current_orientation_required',
    known_facings: ['the main hall sign'],
  });
});

test('step responses carry exit_pose, remaining_steps, and destination_landmark', () => {
  const first = route(map, { current_id: 'gate', ...north });
  assert.equal(first.exit_pose?.facing, 'the main hall sign');
  assert.equal(first.remaining_steps, 3);
  assert.equal(first.destination_landmark, 'call booth two');
  const last = route(map, { current_id: 'call_booth_1' });
  assert.equal(last.exit_pose, null);
  assert.equal(last.remaining_steps, 1);
});

test('planFullRoute returns the full route whose first leg is the step', () => {
  const request = { destination_id: 'call_booth_2', current_id: 'gate', ...north };
  const full = planFullRoute(map, request);
  const step = planRoute(map, request);
  assert.equal(full.status, 'route');
  assert.equal(full.legs.length, 3);
  assert.equal(full.legs[0].command, step.command);
  assert.equal(full.legs[0].to, step.next_id);
  assert.equal(full.legs[0].exit_pose, step.exit_pose);
  assert.deepEqual(full.legs.map(leg => leg.to), ['hall', 'call_booth_1', 'call_booth_2']);
  // Non-step statuses pass through unchanged.
  assert.deepEqual(planFullRoute(map, { destination_id: 'call_booth_2' }),
    planRoute(map, { destination_id: 'call_booth_2' }));
});

test('a map-level survey supplies evidence to records that lack it', () => {
  const surveyed = {
    survey: evidence,
    anchors: [{ id: 'gate', landmark: 'the palm gate' }, map.anchors[3]],
    edges: [{
      from: 'gate', to: 'call_booth_2', action: 'approach_visible',
      entry_pose: null, exit_pose: null,
    }],
  };
  assert.equal(planRoute(surveyed, { destination_id: 'call_booth_2', current_id: 'gate' }).status, 'step');
  // Explicit (but invalid) evidence is kept, not replaced by the survey.
  const explicitBad = {
    ...surveyed,
    anchors: [{ id: 'gate', landmark: 'the palm gate', evidence: { checked_at: '' } }, map.anchors[3]],
  };
  assert.equal(planRoute(explicitBad, { destination_id: 'call_booth_2', current_id: 'gate' }).status,
    'needs_anchor');
});

test('auditMap reports each silently dropped record with its reason', () => {
  const dirty = {
    anchors: [
      { id: 'BAD ID', landmark: 'x', evidence },
      anchor('gate', 'the palm gate'),
      anchor('post', 'the sign post'),
      anchor('post', 'another post'),
      { id: 'noland', evidence },
      { id: 'noevid', landmark: 'the dark corner' },
      map.anchors[3],
    ],
    edges: [
      { from: 'gate', to: 'gate', action: 'walk_straight', entry_pose: north, exit_pose: null, evidence },
      { from: 'gate', to: 'ghost', action: 'walk_straight', entry_pose: north, exit_pose: null, evidence },
      edge('gate', 'call_booth_2', 'teleport', north, null),
      edge('gate', 'call_booth_2', 'walk_straight', 'upside_down', null),
      edge('gate', 'call_booth_2', 'walk_straight', null, null),
      { from: 'gate', to: 'call_booth_2', action: 'approach_visible', entry_pose: null, exit_pose: null },
      edge('gate', 'call_booth_2', 'approach_visible', null, null),
    ],
  };
  const { rejected } = auditMap(dirty);
  const reasons = rejected.map(record => `${record.kind}:${record.reason}`);
  for (const expected of [
    'anchor:bad id', 'anchor:duplicate id', 'anchor:bad landmark', 'anchor:missing evidence',
    'edge:from equals to', 'edge:unknown anchor', 'edge:bad action', 'edge:invalid pose',
    'edge:null entry_pose on non-approach action', 'edge:missing evidence',
  ]) {
    assert.ok(reasons.includes(expected), expected);
  }
  assert.equal(rejected.length, 11);
});

test('auditMap warns about gaps and phrase collisions', () => {
  const { warnings, routes } = auditMap(map);
  for (const destination of COURSE_DESTINATIONS) {
    if (!['call_booth_1', 'call_booth_2', 'kitchen'].includes(destination)) {
      assert.ok(warnings.some(warning => warning.includes(destination)), destination);
    }
  }
  assert.ok(warnings.some(warning => warning.includes('no reverse edge')));
  const colliding = { ...map, anchors: [...map.anchors, anchor('desk_a', 'team desk'), anchor('desk_b', 'the team desk')] };
  assert.ok(auditMap(colliding).warnings.some(warning => warning.includes('collides')));
  // The audit walks every destination from every anchor pose.
  const gateRow = routes.find(row => row.from === 'gate' && row.destination === 'call_booth_2');
  assert.equal(gateRow.legs.length, 3);
  assert.ok(routes.every(row => 'legs' in row || typeof row.status === 'string'));
});
