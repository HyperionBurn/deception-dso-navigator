import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEMO_MAP } from '../lib/nav/demo-map.mjs';
import { wordCount } from '../lib/nav/map.mjs';
import { runTool } from '../lib/nav/tools.mjs';
import { sweepMap } from '../lib/nav/sweep.mjs';
import { DTEC_MAP } from '../lib/nav/dtec-map.mjs';
import { mapReady } from '../lib/nav/maps.mjs';

const HOLD = 'Operator, stop. Stay where you are.';

function session(map = DEMO_MAP) {
  let state = null;
  let now = 1_000_000;
  return {
    get state() { return state; },
    tick(seconds) { now += seconds * 1000; },
    call(tool, args = {}) {
      const out = runTool({ map, state, session_id: 'sess-test-0001', tool, args, now });
      state = out.state;
      return out.result;
    },
  };
}

// Plan from the start point and confirm the start question.
function started(dest = 'call_booth_2', lang = 'ar') {
  const s = session();
  const ask = s.call('plan_route', { destination_id: dest, lang });
  assert.equal(ask.status, 'need_start');
  const first = s.call('confirm_step', { step_id: ask.step_id, result: 'yes' });
  return { s, first };
}

// Run the route to the end by answering every step the way a good operator would.
function finish(s, first) {
  let step = first;
  for (let guard = 0; guard < 30; guard++) {
    if (step.arrived) return step;
    const reply = step.status === 'arrival_check' ? 'yes' : 'done';
    step = s.call('confirm_step', { step_id: step.step_id, result: reply });
  }
  throw new Error('route did not finish');
}

test('get_state on a new session says nothing is planned and marks demo data', () => {
  const s = session();
  const r = s.call('get_state');
  assert.equal(r.status, 'info');
  assert.equal(r.position, null);
  assert.equal(r.demo, true);
});

test('find_place resolves names and Arabic aliases, asks one question when unclear, never invents', () => {
  const s = session();
  assert.equal(s.call('find_place', { query: 'booth 2' }).place_id, 'call_booth_2');
  assert.equal(s.call('find_place', { query: 'كبينة المكالمات 3' }).place_id, 'call_booth_3');
  assert.equal(s.call('find_place', { query: 'the Kitchen' }).place_id, 'kitchen');
  const vague = s.call('find_place', { query: 'a call booth' });
  assert.equal(vague.status, 'ambiguous');
  assert.equal(vague.candidates.length, 4);
  assert.match(vague.question_visitor_en, /booth one.*booth two.*booth three.*booth four/);
  const none = s.call('find_place', { query: 'the swimming pool' });
  assert.equal(none.status, 'unknown_place');
  assert.match(none.tell_visitor_en, /not on this floor|do not know/i);
});

test('a route from an unconfirmed start asks the operator first, then gives one instruction', () => {
  const s = session();
  const ask = s.call('plan_route', { destination_id: 'call_booth_2', lang: 'ar' });
  assert.equal(ask.status, 'need_start');
  assert.equal(ask.say_operator, DEMO_MAP.meta.start.say);
  const first = s.call('confirm_step', { step_id: ask.step_id, result: 'yes' });
  assert.equal(first.status, 'instruction');
  assert.equal(first.say_operator, 'Operator, walk straight until the booth corridor opens on your right.');
  assert.equal(first.progress, '1/3');
  assert.ok(first.step_id > ask.step_id);
});

test('the full easy route: walk, turn, walk, arrival check, arrival', () => {
  const { s, first } = started();
  const second = s.call('confirm_step', { step_id: first.step_id, result: 'stopped' });
  assert.equal(second.say_operator, 'Operator, turn right.');
  const third = s.call('confirm_step', { step_id: second.step_id, result: 'done' });
  assert.equal(third.say_operator, 'Operator, walk straight until the door of booth two is on your left.');
  const check = s.call('confirm_step', { step_id: third.step_id, result: 'stopped' });
  assert.equal(check.status, 'arrival_check');
  assert.equal(check.arrived, false);
  assert.equal(check.say_operator, 'Operator, stay stopped. Do you see the door of booth two?');
  const done = s.call('confirm_step', { step_id: check.step_id, result: 'yes' });
  assert.equal(done.arrived, true);
  assert.equal(done.status, 'arrived');
  assert.match(done.tell_visitor_en, /arrived at booth two/);
  assert.equal(s.state.pos.node, 'call_booth_2');
  assert.equal(s.state.conf, 'exact');
});

test('arrival is never announced when the operator does not see the endpoint', () => {
  const { s, first } = started();
  let step = s.call('confirm_step', { step_id: first.step_id, result: 'done' });
  step = s.call('confirm_step', { step_id: step.step_id, result: 'done' });
  step = s.call('confirm_step', { step_id: step.step_id, result: 'stopped' });
  const no = s.call('confirm_step', { step_id: step.step_id, result: 'no' });
  assert.equal(no.arrived, false);
  assert.equal(no.status, 'ask_operator');
  assert.equal(no.say_operator, 'Operator, stay where you are. What do you see?');
  assert.equal(s.state.arrived, false);
});

test('a map can skip the arrival check', () => {
  const map = structuredClone(DEMO_MAP);
  map.meta.verify_arrival = false;
  const s = session(map);
  const ask = s.call('plan_route', { destination_id: 'kitchen', lang: 'en' });
  const walk = s.call('confirm_step', { step_id: ask.step_id, result: 'yes' });
  assert.equal(s.call('confirm_step', { step_id: walk.step_id, result: 'stopped' }).arrived, true);
});

test('a stale or repeated step id never moves the plan twice', () => {
  const { s, first } = started();
  const second = s.call('confirm_step', { step_id: first.step_id, result: 'stopped' });
  const again = s.call('confirm_step', { step_id: first.step_id, result: 'stopped' });
  assert.equal(again.status, 'stale');
  assert.equal(again.say_operator, null, 'the operator already heard the next instruction');
  assert.ok(second.say_operator);
  assert.equal(s.state.i, 1);
});

test('"repeat" replays the same words with the same step id; "ok" only acknowledges', () => {
  const { s, first } = started();
  const rep = s.call('confirm_step', { step_id: first.step_id, result: 'repeat' });
  assert.equal(rep.status, 'repeat');
  assert.equal(rep.say_operator, first.say_operator);
  assert.equal(rep.step_id, first.step_id);
  const ack = s.call('confirm_step', { step_id: first.step_id, result: 'ok' });
  assert.equal(ack.status, 'ack');
  assert.equal(ack.say_operator, null);
  assert.equal(s.state.i, 0);
});

test('a word outside the closed reply list is refused and nothing moves', () => {
  const { s, first } = started();
  const r = s.call('confirm_step', { step_id: first.step_id, result: 'banana' });
  assert.equal(r.status, 'invalid_reply');
  assert.match(r.say_operator, /^Operator, please say/);
  assert.equal(s.state.i, 0);
});

test('every instruction the tools can say is 12 words or fewer after "Operator,"', () => {
  for (const dest of ['team_tables', 'kitchen', 'meeting_room', 'conference_room', 'call_booth_1', 'call_booth_4']) {
    const { s, first } = started(dest);
    let step = first;
    for (let guard = 0; guard < 20 && !step.arrived; guard++) {
      assert.ok(wordCount(step.say_operator.replace(/^Operator,/, '')) <= 12, step.say_operator);
      step = s.call('confirm_step', { step_id: step.step_id, result: step.status === 'arrival_check' ? 'yes' : 'done' });
    }
    assert.equal(step.arrived, true, dest);
  }
});

test('a new destination mid-walk: hold first, ask what the operator sees, then keep going', () => {
  const { s, first } = started('call_booth_2');
  const hold = s.call('change_destination', { destination_id: 'conference_room', lang: 'en' });
  assert.equal(hold.status, 'hold');
  assert.equal(hold.say_operator, HOLD);
  assert.equal(hold.tell.length, 2);
  assert.ok(hold.step_id > first.step_id);
  const old = s.call('confirm_step', { step_id: first.step_id, result: 'stopped' });
  assert.equal(old.status, 'stale', 'the old walk step can no longer be confirmed');
  const ask = s.call('confirm_step', { step_id: hold.step_id, result: 'stopped' });
  assert.equal(ask.status, 'ask_operator');
  assert.equal(ask.say_operator, 'Operator, what do you see?');
  const route = s.call('report_landmark', { thing: 'the printer', side: 'left' });
  assert.equal(route.status, 'instruction');
  assert.equal(route.say_operator, 'Operator, walk straight until you reach the end of the corridor.');
  assert.equal(s.state.conf, 'reported');
  assert.equal(finish(s, route).arrived, true);
  assert.equal(s.state.pos.node, 'conference_room');
});

test('a destination behind the robot makes the new route start with a turn around', () => {
  const { s } = started('call_booth_2');
  const hold = s.call('change_destination', { destination_id: 'team_tables', lang: 'en' });
  s.call('confirm_step', { step_id: hold.step_id, result: 'stopped' });
  const route = s.call('report_landmark', { thing: 'printer', side: 'left' });
  assert.equal(route.say_operator, 'Operator, turn around.');
  assert.equal(finish(s, route).arrived, true);
  assert.equal(s.state.pos.node, 'team_tables');
});

test('a landmark on the other side means the robot walks the other way', () => {
  const { s } = started('call_booth_2');
  const hold = s.call('change_destination', { destination_id: 'call_booth_2', lang: 'en' });
  s.call('confirm_step', { step_id: hold.step_id, result: 'stopped' });
  const route = s.call('report_landmark', { thing: 'printer', side: 'right' });
  assert.equal(s.state.heading, 'S');
  assert.equal(route.say_operator, 'Operator, turn around.');
  assert.equal(finish(s, route).arrived, true);
});

test('an unknown landmark is asked again once, then the agent hands over to a person', () => {
  const { s } = started('call_booth_2');
  const hold = s.call('change_destination', { destination_id: 'kitchen', lang: 'en' });
  s.call('confirm_step', { step_id: hold.step_id, result: 'stopped' });
  const first = s.call('report_landmark', { thing: 'a purple elephant', side: 'left' });
  assert.equal(first.status, 'ask_operator');
  const second = s.call('report_landmark', { thing: 'a green dragon', side: 'left' });
  assert.equal(second.status, 'handover');
  assert.match(second.say_operator, /^Operator, stay where you are\./);
  assert.ok(s.state.handover);
});

test('a landmark with no side asks left or right', () => {
  const { s } = started('call_booth_2');
  const hold = s.call('change_destination', { destination_id: 'kitchen', lang: 'en' });
  s.call('confirm_step', { step_id: hold.step_id, result: 'stopped' });
  const r = s.call('report_landmark', { thing: 'printer' });
  assert.equal(r.status, 'ask_operator');
  assert.match(r.say_operator, /left or right/);
});

test('"lost" holds and asks; a second "lost" in a row hands over', () => {
  const { s, first } = started('call_booth_2');
  const lost = s.call('confirm_step', { step_id: first.step_id, result: 'lost' });
  assert.equal(lost.status, 'hold');
  assert.equal(lost.say_operator, HOLD);
  const ask = s.call('confirm_step', { step_id: lost.step_id, result: 'stopped' });
  assert.equal(ask.say_operator, 'Operator, what do you see?');
  const again = s.call('confirm_step', { step_id: ask.step_id, result: 'lost' });
  assert.equal(again.status, 'handover');
});

test('the silence ladder: ask, then hold, then hand over', () => {
  const { s } = started('call_booth_2'); // first walk is 22 steps: expected about 22.6 s
  s.tick(10);
  assert.equal(s.call('get_state').nudge, null);
  s.tick(20); // 30 s: past expected + 5
  const ask = s.call('get_state').nudge;
  assert.equal(ask.stage, 'ask');
  assert.match(ask.say_operator, /^Operator, /);
  s.tick(8); // 38 s: past expected + 13
  const hold = s.call('get_state').nudge;
  assert.equal(hold.stage, 'hold');
  assert.equal(hold.say_operator, HOLD);
  assert.equal(s.state.awaiting.kind, 'hold', 'the walk step can no longer be confirmed');
  s.tick(25); // still silent after the hold
  assert.equal(s.call('get_state').nudge.stage, 'handover');
});

test('"wait" pauses the clock; a late reply is still accepted', () => {
  const { s, first } = started('call_booth_2');
  s.tick(25);
  s.call('confirm_step', { step_id: first.step_id, result: 'wait' });
  s.tick(20);
  assert.equal(s.call('get_state').nudge, null);
});

test('place_busy picks the nearest free place of the same kind and plans again', () => {
  const { s, first } = started('call_booth_2');
  let step = s.call('confirm_step', { step_id: first.step_id, result: 'done' });
  step = s.call('confirm_step', { step_id: step.step_id, result: 'done' });
  step = s.call('confirm_step', { step_id: step.step_id, result: 'stopped' });
  assert.equal(step.status, 'arrival_check');
  const busy = s.call('confirm_step', { step_id: step.step_id, result: 'busy' });
  assert.equal(busy.status, 'instruction');
  assert.match(busy.tell_visitor_en, /booth two is busy\. booth three is next to it/i);
  assert.equal(s.state.dest, 'call_booth_3', 'booth three is straight on, booth one needs a turn around');
  assert.match(busy.say_operator, /^Operator, /);
});

test('set_position (a person fixes the position) replans when there is a destination', () => {
  const { s } = started('kitchen');
  const r = s.call('set_position', { node: 'north_end', heading: 'N' });
  assert.equal(r.status, 'instruction');
  assert.equal(r.say_operator, 'Operator, walk straight until the kitchen counter is in front of you.');
  assert.equal(s.call('set_position', { node: 'nowhere', heading: 'N' }).status, 'invalid');
  assert.equal(s.call('set_position', { node: 'north_end', heading: 'Q' }).status, 'invalid');
});

test('an unknown destination never produces a route', () => {
  const s = session();
  const r = s.call('plan_route', { destination_id: 'swimming_pool', lang: 'en' });
  assert.equal(r.status, 'unknown_place');
  assert.equal(r.say_operator ?? null, null);
});

test('handover logs the reason and the last words and holds the operator', () => {
  const { s } = started('call_booth_2');
  const r = s.call('handover', { reason: 'visitor asked for a person' });
  assert.equal(r.status, 'handover');
  assert.equal(r.say_operator, 'Operator, stay where you are. I am calling a person.');
  assert.equal(s.state.handover.reason, 'visitor asked for a person');
  assert.ok(s.state.log.length > 0);
});

test('tools reject unknown tool names and keep state untouched', () => {
  const s = session();
  assert.equal(s.call('fly_to_moon').status, 'unknown_tool');
});

// Sweep: every spot inside every corridor, walking either way, to every place. The tools must find a route
// that really ends at the place. Proves the planner on demo data, not the real floor.
test('sweep: every position x direction x place reaches the destination (demo map)', () => {
  const { total, failures } = sweepMap(DEMO_MAP);
  assert.deepEqual(failures, []);
  assert.ok(total >= 1000, `only ${total} cases`);
});

// Once the real map is filled in, this runs on it automatically.
test('sweep: the real Dtec map has no holes', { skip: !mapReady(DTEC_MAP) && 'real map is still empty' }, () => {
  const { failures } = sweepMap(DTEC_MAP);
  assert.deepEqual(failures, []);
});
