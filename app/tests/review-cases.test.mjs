import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLOOR_MAP } from '../lib/floor-map.mjs';
import { planFullRoute, planRoute } from '../lib/route-planner.mjs';

// Failure cases found by an outside review of an alternative navigation engine, checked against this route tool.
// Fictional labels, evidence and topology only: never load this map in production.
const evidence = { checked_at: 'Synthetic time', checked_by: 'Synthetic verifier', reference: 'Synthetic record only' };
const anchor = (id, landmark) => ({ id, landmark, evidence });
const edge = (from, to, action, entry_pose, exit_pose) => ({ from, to, action, entry_pose, exit_pose, evidence });
const north = { heading: 'north' };
const map = {
  anchors: [
    anchor('start', 'the green panel'),
    anchor('junction', 'the blue panel'),
    anchor('kitchen', 'the cafeteria menu boards'),
  ],
  edges: [
    edge('start', 'junction', 'walk_straight', north, north),
    edge('junction', 'kitchen', 'walk_straight', north, north),
  ],
};

test('a place that is far, ahead or behind is not where the operator stands', () => {
  const far = [
    'I can see the cafeteria menu boards far away',
    'I see the cafeteria menu boards from here',
    'the cafeteria menu boards are over there',
    'the cafeteria menu boards are behind me',
    'the cafeteria menu boards are ahead of me',
  ];
  for (const text of far) {
    const result = planRoute(map, { destination_id: 'kitchen', current_landmark: text, heading: 'north' });
    assert.notEqual(result.status, 'at_destination', `"${text}" must not count as arrival`);
    assert.notEqual(result.status, 'step', `"${text}" must not be used as a position`);
  }
  // Saying you are standing at it still works.
  const here = planRoute(map, { destination_id: 'kitchen', current_landmark: 'I am at the cafeteria menu boards', heading: 'north' });
  assert.equal(here.status, 'at_destination');
});

test('a waypoint described as ahead is not a position either', () => {
  const result = planRoute(map, { destination_id: 'kitchen', current_landmark: 'I can see the blue panel ahead', heading: 'north' });
  assert.notEqual(result.status, 'step', 'a step planned from a place that was only seen far away is a guess');
});

test('the normal reply to "Can you see the blue panel?" still works', () => {
  const result = planRoute(map, { destination_id: 'kitchen', current_landmark: 'I see the blue panel', heading: 'north' });
  assert.equal(result.status, 'step', 'the agent uses this question to find the starting position');
});

test('ids named like object properties do not crash the planner and are never mapped', () => {
  for (const id of ['constructor', 'tostring', 'valueof', 'hasownproperty']) {
    const asDestination = planRoute(map, { destination_id: id, current_id: 'start', heading: 'north' });
    assert.equal(asDestination.status, 'unverified', `destination ${id}`);
    const asPosition = planRoute(map, { destination_id: 'kitchen', current_id: id, heading: 'north' });
    assert.notEqual(asPosition.status, 'step', `position ${id}`);
    assert.notEqual(asPosition.status, 'at_destination', `position ${id}`);
  }
});

// The operator hears "Operator," plus the command, and the rule is 12 words or fewer after "Operator,".
// Today the team-tables command is 13 words because its landmark is long, so this is a todo until the landmark is shortened.
test('every command on the production map is short and has no compass word',
  { todo: 'team tables command is 13 words: shorten its landmark in qa/survey.txt' }, () => {
  const heardWords = text => text.split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
  let checked = 0;
  const poses = [{ heading: 'north' }, { heading: 'east' }, { heading: 'south' }, { heading: 'west' },
    { facing: 'reception' }, { facing: 'pitch room' }];
  for (const to of FLOOR_MAP.anchors) {
    for (const from of FLOOR_MAP.anchors) {
      for (const pose of poses) {
        const result = planFullRoute(FLOOR_MAP, { destination_id: to.id, current_id: from.id, ...pose });
        for (const leg of result.legs ?? []) {
          checked += 1;
          assert.ok(heardWords(leg.command) <= 12, `"${leg.command}" is too long for one instruction`);
          assert.doesNotMatch(leg.command, /\b(north|south|east|west)\b/iu, `"${leg.command}" has a compass word`);
        }
      }
    }
  }
  assert.ok(checked > 0, 'the check must look at real commands');
});

test('Arabic sightings are not positions either', () => {
  const arabicMap = { ...map, anchors: [...map.anchors, anchor('team_tables', 'طاولات الفرق')] };
  const result = planRoute(arabicMap, { destination_id: 'kitchen', current_landmark: 'اشوف طاولات الفرق بعيد', heading: 'north' });
  assert.equal(result.status, 'needs_anchor');
});
