import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLOOR_MAP } from '../lib/floor-map.mjs';
import { planRoute } from '../lib/route-planner.mjs';

// Problems T1 to T3 from the role-play replays (qa/sim/SIM_REPORT.md), on the real demo map.
const plan = request => planRoute(FLOOR_MAP, { destination_id: 'kitchen', ...request });
const TURN_LEFT = 'Turn left. Walk straight and stop at the cafeteria.';
const TURN_AROUND = 'Turn around. Walk straight and stop at the cafeteria.';

test('T1: a facing said inside the position text does not change which place it is', () => {
  // "pitch room" in the facing used to win over "sign B" and put the operator at the pitch room door.
  const result = plan({ current_landmark: 'I am at sign B, facing toward the pitch room' });
  assert.equal(result.status, 'needs_anchor');
  assert.equal(result.reason, 'current_orientation_required', 'sign B was found, only the facing is unknown');
  assert.deepEqual(result.known_facings, ['reception', 'team tables']);
});

test('T1: a facing in the position text is used when no facing was sent', () => {
  assert.equal(plan({ current_landmark: 'I am at sign B, facing reception' }).command, TURN_LEFT);
  // "the team tables" now names a place as well as a facing, so it asks; "the purple pillar" still works.
  assert.equal(plan({ current_landmark: 'sign B looking at the purple pillar' }).command, TURN_AROUND);
});

test('T1: a facing that was sent on its own wins over the one in the text', () => {
  const result = plan({ current_landmark: 'sign B facing team tables', facing: 'reception' });
  assert.equal(result.command, TURN_LEFT);
});

test('T1: a facing with no place is not a position', () => {
  const result = plan({ current_landmark: 'facing the pitch room' });
  assert.equal(result.status, 'needs_anchor');
  assert.equal(result.reason, 'current_anchor_required');
});

test('T2: another name for the same place works as a facing', () => {
  // "team tables" is both a place and an edge facing label; the edge label wins the tie.
  const byLabel = plan({ current_landmark: 'sign B', facing: 'team tables' });
  assert.equal(byLabel.command, TURN_AROUND);
  for (const facing of ['the purple pillar', 'purple pillar', 'toward the purple pillar']) {
    const result = plan({ current_landmark: 'sign B', facing });
    assert.equal(result.command, TURN_AROUND, `"${facing}" is the team tables`);
  }
});

test('T2: the old facing answers still give the same steps', () => {
  assert.equal(plan({ current_landmark: 'sign B', facing: 'reception' }).command, TURN_LEFT);
  const viaLabel = plan({ current_id: 'sign_a', facing: 'reception' });
  const viaName = plan({ current_id: 'sign_a', facing: 'the purple pillar' });
  assert.equal(viaName.status, 'step');
  assert.equal(viaName.command, viaLabel.command, 'facing the next place on a straight walk is the same as the map facing');
});

test('T2: a facing the map has no route for is still a question, not a guess', () => {
  const result = plan({ current_landmark: 'sign B', facing: 'toward the pitch room' });
  assert.equal(result.status, 'needs_anchor');
  assert.equal(result.reason, 'current_orientation_required');
  assert.deepEqual(result.known_facings, ['reception', 'team tables']);
});

test('T3: a place on my left or right is not where the operator stands', () => {
  for (const text of [
    'the cafeteria is on my left',
    'the cafeteria menu boards are on the right',
    'the cafeteria is to my left',
    'the cafeteria menu boards are to the right of me',
  ]) {
    const result = plan({ current_landmark: text });
    assert.equal(result.status, 'needs_anchor', `"${text}" must not count as arrival`);
    assert.equal(result.reason, 'current_anchor_required', text);
  }
  const waypoint = plan({ current_landmark: 'the yellow pillar is on my left', facing: 'reception' });
  assert.notEqual(waypoint.status, 'step', 'a waypoint on the side is not a position either');
});

test('T3: seeing the destination is not arriving', () => {
  for (const text of ['I can see the cafeteria', 'I see the cafeteria menu boards', 'I can see the menu boards']) {
    const result = plan({ current_landmark: text });
    assert.equal(result.status, 'needs_anchor', `"${text}" must not count as arrival`);
  }
});

test('T3: saying you are at the destination still arrives', () => {
  for (const text of ['I am at the cafeteria menu boards', "I'm standing next to the cafeteria", 'the cafeteria']) {
    assert.equal(plan({ current_landmark: text }).status, 'at_destination', text);
  }
});

test('T3: "I see the waypoint" still finds the start, as the prompt asks', () => {
  const result = plan({ current_landmark: 'I see the yellow pillar', facing: 'reception' });
  assert.equal(result.status, 'step');
  assert.equal(result.command, TURN_LEFT);
});
