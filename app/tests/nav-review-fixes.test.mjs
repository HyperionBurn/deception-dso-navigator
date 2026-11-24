import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import nav from '../api/nav.mjs';
import { DEMO_MAP } from '../lib/nav/demo-map.mjs';
import { validateMap } from '../lib/nav/map.mjs';
import { createStore } from '../lib/nav/store.mjs';
import { runTool, writesState } from '../lib/nav/tools.mjs';

// Each test below reproduces one finding from the fresh-context review of this branch.

const SID = 'sess-review-0001';
function session() {
  let state = null;
  let now = 1_000_000;
  const api = {
    call(tool, args = {}, afterSeconds = 0) {
      now += afterSeconds * 1000;
      const out = runTool({ map: DEMO_MAP, state, session_id: SID, tool, args, now });
      state = out.state;
      return out.result;
    },
    get state() { return state; },
  };
  return api;
}
const atNorthEnd = () => {
  const s = session();
  s.call('set_position', { node: 'north_end', heading: 'N' });
  return s;
};

test('the silence nudge at the arrival check asks the real question, so "yes, I am here" cannot confirm arrival', () => {
  const s = atNorthEnd();
  const walk = s.call('plan_route', { destination_id: 'kitchen', lang: 'en' });
  const check = s.call('confirm_step', { step_id: walk.step_id, result: 'done' });
  assert.equal(check.status, 'arrival_check');
  const nudge = s.call('get_state', {}, 12).nudge;
  assert.equal(nudge.stage, 'ask');
  assert.equal(nudge.say_operator, check.say_operator, 'the nudge repeats the arrival question, not "are you there?"');
});

test('the silence nudge at the start question repeats the start question', () => {
  const s = session();
  const need = s.call('plan_route', { destination_id: 'kitchen', lang: 'en' });
  assert.equal(need.status, 'need_start');
  assert.equal(s.call('get_state', {}, 12).nudge.say_operator, need.say_operator);
});

test('"I see the kitchen" does not move the robot to the kitchen or announce arrival', () => {
  const s = session();
  s.call('set_position', { node: 'start', heading: 'N' });
  s.call('plan_route', { destination_id: 'kitchen', lang: 'en' });
  const seen = s.call('confirm_step', { result: 'see', thing: 'the kitchen' });
  assert.notEqual(seen.status, 'arrival_check');
  assert.equal(s.state.pos.node, 'start', 'seeing something is not being at it');
  const at = s.call('confirm_step', { result: 'at', thing: 'the kitchen' });
  assert.equal(at.status, 'arrival_check', '"at" still places the robot');
});

test('a new destination after a handover asks what the operator sees instead of planning from an old position', () => {
  const s = session();
  s.call('set_position', { node: 'start', heading: 'N' });
  s.call('plan_route', { destination_id: 'call_booth_2', lang: 'en' });
  s.call('handover', { reason: 'test' });
  const again = s.call('plan_route', { destination_id: 'kitchen', lang: 'en' });
  assert.equal(again.status, 'ask_operator');
  assert.equal(s.state.pending_dest, 'kitchen');
  const route = s.call('confirm_step', { result: 'see', thing: 'the reception desk', side: 'right' });
  assert.equal(route.status, 'instruction', 'once the operator reports a landmark the route starts');
  assert.equal(s.state.handover, null, 'the handover is cleared by a confirmed position');
});

test('a guessed position also asks before a new route', () => {
  const s = session();
  s.call('set_position', { node: 'start', heading: 'N' });
  s.call('plan_route', { destination_id: 'call_booth_2', lang: 'en' });
  s.call('confirm_step', { result: 'lost', step_id: s.state.awaiting.step_id });
  s.call('change_destination', { destination_id: 'kitchen', lang: 'en' });
  assert.equal(s.state.conf, 'guess');
  assert.equal(s.call('plan_route', { destination_id: 'kitchen', lang: 'en' }).status, 'ask_operator');
});

test('a step id from the future means the saved state was lost: hold and hand over, never stay silent', () => {
  const s = session();
  const lost = s.call('confirm_step', { step_id: 9, result: 'done' });
  assert.equal(lost.status, 'handover');
  assert.match(lost.say_operator, /stay where you are/iu);
});

test('on Vercel the memory store is refused unless the team allows it', () => {
  assert.throws(() => createStore({ VERCEL: '1' }), /redis/iu);
  assert.equal(createStore({ VERCEL: '1', NAVIGATOR_ALLOW_MEMORY_STORE: '1' }).kind, 'memory');
  assert.equal(createStore({ VERCEL: '1', KV_REST_API_URL: 'https://x.example', KV_REST_API_TOKEN: 't' }).kind, 'redis');
  assert.equal(createStore({}).kind, 'memory');
});

test('a failing state store returns a hand-over instruction, not just an error', async () => {
  const names = ['NAVIGATOR_ROUTE_TOOL_KEY', 'NAVIGATOR_USE_DEMO_MAP', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'NAVIGATOR_ACCESS_CODE', 'ELEVENLABS_API_KEY'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    NAVIGATOR_ROUTE_TOOL_KEY: 'tool-key-for-tests-1234', NAVIGATOR_USE_DEMO_MAP: '1',
    KV_REST_API_URL: 'http://127.0.0.1:1', KV_REST_API_TOKEN: 'token-for-tests',
  });
  try {
    const response = await nav.fetch(new Request('https://example.test/api/nav?tool=get_state', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-navigator-route-key': 'tool-key-for-tests-1234' },
      body: JSON.stringify({ session_id: SID }),
    }));
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.status, 'handover');
    assert.match(body.say_operator, /stay where you are/iu);
  } finally {
    for (const name of names) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
  }
});

test('read-only calls do not write the session back', () => {
  assert.equal(writesState('find_place', { status: 'found' }), false);
  assert.equal(writesState('get_state', { nudge: null }), false);
  assert.equal(writesState('get_state', { nudge: { stage: 'ask' } }), false);
  assert.equal(writesState('get_state', { nudge: { stage: 'hold' } }), true);
  assert.equal(writesState('get_state', { nudge: { stage: 'handover' } }), true);
  assert.equal(writesState('confirm_step', { status: 'ack' }), true);
});

test('a repeated step id gets no second spoken instruction', () => {
  const s = atNorthEnd();
  const first = s.call('plan_route', { destination_id: 'meeting_room', lang: 'en' });
  s.call('confirm_step', { step_id: first.step_id, result: 'done' });
  const again = s.call('confirm_step', { step_id: first.step_id, result: 'done' });
  assert.equal(again.status, 'stale');
  assert.equal(again.say_operator, null, 'the operator already heard the next instruction');
});

test('the bare word "stop" never counts as a finished step', () => {
  const s = atNorthEnd();
  const first = s.call('plan_route', { destination_id: 'kitchen', lang: 'en' });
  const stopped = s.call('confirm_step', { step_id: first.step_id, result: 'stop' });
  assert.equal(stopped.status, 'waiting');
  assert.equal(s.state.i, 0, 'the plan did not advance');
});

test('"it is ahead" is counted as a miss and ends in a hand over', () => {
  const s = session();
  s.call('set_position', { node: 'start', heading: 'N' });
  const first = s.call('confirm_step', { result: 'see', thing: 'the reception desk', side: 'ahead' });
  assert.equal(first.status, 'ask_operator');
  assert.equal(s.call('confirm_step', { result: 'see', thing: 'the reception desk', side: 'ahead' }).status, 'handover');
});

test('map checks cover every sentence the operator hears', () => {
  const longSee = structuredClone(DEMO_MAP);
  longSee.nodes.kitchen.see = 'the large glass door of the kitchen on the far side';
  assert.equal(validateMap(longSee).ok, false);
  assert.ok(validateMap(longSee).errors.some(e => e.includes('kitchen') && e.includes('see')));
  const longStart = structuredClone(DEMO_MAP);
  longStart.meta.start.say = 'Operator, please confirm that you are standing at the start point and facing the glass wall now.';
  assert.equal(validateMap(longStart).ok, false);
  const compass = structuredClone(DEMO_MAP);
  compass.meta.start.say = 'Operator, are you at the start point facing north?';
  assert.equal(validateMap(compass).ok, false);
  assert.equal(validateMap(DEMO_MAP).ok, true);
});

test('a position named like an object property is not a place on the map', () => {
  const s = session();
  assert.equal(s.call('set_position', { node: 'constructor', heading: 'N' }).status, 'invalid');
  assert.equal(s.state.pos, null);
});
