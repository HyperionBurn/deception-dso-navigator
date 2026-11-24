import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import screen from '../api/nav-screen.mjs';
import nav from '../api/nav.mjs';
import { DEMO_MAP } from '../lib/nav/demo-map.mjs';
import { layoutMap, pointAt } from '../lib/nav/layout.mjs';
import { screenData } from '../lib/nav/screen.mjs';
import { memoryStore } from '../lib/nav/store.mjs';
import { runTool } from '../lib/nav/tools.mjs';

const CODE = 'team-access-code-123';
const KEY = 'tool-key-for-tests-1234';
const names = ['NAVIGATOR_ACCESS_CODE', 'NAVIGATOR_ROUTE_TOOL_KEY', 'NAVIGATOR_USE_DEMO_MAP', 'ELEVENLABS_API_KEY', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];
const saved = {};
beforeEach(() => {
  for (const name of names) { saved[name] = process.env[name]; delete process.env[name]; }
  process.env.NAVIGATOR_ACCESS_CODE = CODE;
  process.env.NAVIGATOR_ROUTE_TOOL_KEY = KEY;
  process.env.NAVIGATOR_USE_DEMO_MAP = '1';
});
afterEach(() => {
  for (const name of names) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
});

const post = body => screen.fetch(new Request('https://example.test/api/nav-screen', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const tool = (name, body) => nav.fetch(new Request(`https://example.test/api/nav?tool=${name}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-navigator-route-key': KEY }, body: JSON.stringify(body),
})).then(r => r.json());

test('layout places every node from headings and step counts (north is up)', () => {
  const layout = layoutMap(DEMO_MAP);
  assert.deepEqual(layout.nodes.start, { x: 0, y: 0 });
  assert.deepEqual(layout.nodes.team_corner, { x: 0, y: -12 });
  assert.deepEqual(layout.nodes.booth_corner, { x: 0, y: -22 });
  assert.deepEqual(layout.nodes.call_booth_2, { x: 10, y: -22 });
  assert.deepEqual(layout.nodes.meeting_room, { x: -10, y: -30 });
  assert.equal(Object.keys(layout.nodes).length, Object.keys(DEMO_MAP.nodes).length);
  assert.equal(layout.edges.length, DEMO_MAP.edges.length);
  assert.ok(layout.bounds.w > 0 && layout.bounds.h > 0);
});

test('pointAt finds the robot on a node or part way along a corridor', () => {
  const layout = layoutMap(DEMO_MAP);
  assert.deepEqual(pointAt(DEMO_MAP, layout, { node: 'kitchen' }), { x: 0, y: -36, kind: 'node' });
  assert.deepEqual(pointAt(DEMO_MAP, layout, { edge: 'e2', dir: 1, done: 5 }), { x: 0, y: -17, kind: 'edge' });
  assert.deepEqual(pointAt(DEMO_MAP, layout, { edge: 'e2', dir: -1, done: 3 }), { x: 0, y: -19, kind: 'edge' });
  assert.equal(pointAt(DEMO_MAP, layout, null), null);
});

test('screenData shows the steps, what was said, the position and a handover', () => {
  let state = null;
  const call = (name, args = {}) => { const out = runTool({ map: DEMO_MAP, state, session_id: 'sess-screen-0001', tool: name, args, now: 5000 }); state = out.state; return out.result; };
  const ask = call('plan_route', { destination_id: 'call_booth_2', lang: 'ar' });
  call('confirm_step', { step_id: ask.step_id, result: 'yes' });
  const data = screenData(DEMO_MAP, state);
  assert.equal(data.demo, true);
  assert.equal(data.say_operator, 'Operator, walk straight until the booth corridor opens on your right.');
  assert.equal(data.steps.length, 3);
  assert.deepEqual(data.steps.map(s => s.status), ['current', 'next', 'next']);
  assert.equal(data.destination, 'booth two');
  assert.equal(data.robot.kind, 'node');
  assert.deepEqual(data.labels.call_booth_2, { name: 'booth two', short: 'B2', type: 'place' });
  assert.equal(data.confidence, 'reported');
  call('handover', { reason: 'test' });
  assert.equal(screenData(DEMO_MAP, state).handover.reason, 'test');
});

test('the screen endpoint needs the team access code and returns the latest session', async () => {
  assert.equal((await post({ access_code: 'wrong-code-12345', session_id: 'latest' })).status, 401);
  assert.equal((await post({ access_code: CODE, session_id: 'bad id!' })).status, 400);
  assert.equal((await post({ access_code: CODE, session_id: 'latest' })).status, 404, 'nothing has happened yet');
  const ask = await tool('plan_route', { session_id: 'sess-screen-0002', destination_id: 'kitchen', lang: 'en' });
  await tool('confirm_step', { session_id: 'sess-screen-0002', step_id: ask.step_id, result: 'yes' });
  const response = await post({ access_code: CODE, session_id: 'latest' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.session_id, 'sess-screen-0002');
  assert.equal(body.destination, 'the kitchen');
  assert.ok(body.layout.nodes.kitchen);
  assert.ok(!JSON.stringify(body).includes(CODE) && !JSON.stringify(body).includes(KEY));
  delete process.env.NAVIGATOR_ACCESS_CODE;
  assert.equal((await post({ access_code: CODE, session_id: 'latest' })).status, 503);
});

test('the store remembers which session was used last', async () => {
  const store = memoryStore();
  assert.equal(await store.latest(), null);
  await store.set('abc-12345', { v: 1 });
  await store.set('def-67890', { v: 1 });
  assert.equal(await store.latest(), 'def-67890');
});
