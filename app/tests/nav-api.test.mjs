import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import nav from '../api/nav.mjs';
import { createStore, memoryStore, upstashStore } from '../lib/nav/store.mjs';
import { DTEC_MAP } from '../lib/nav/dtec-map.mjs';
import { mapReady } from '../lib/nav/maps.mjs';
import { validateMap } from '../lib/nav/map.mjs';

const KEY = 'tool-key-for-tests-1234';
const SESSION = 'sess-api-0001';
const saved = {};
const names = ['NAVIGATOR_ROUTE_TOOL_KEY', 'NAVIGATOR_ACCESS_CODE', 'ELEVENLABS_API_KEY', 'NAVIGATOR_USE_DEMO_MAP',
  'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];

beforeEach(() => {
  for (const name of names) { saved[name] = process.env[name]; delete process.env[name]; }
  process.env.NAVIGATOR_ROUTE_TOOL_KEY = KEY;
  process.env.NAVIGATOR_USE_DEMO_MAP = '1';
});
afterEach(() => {
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
  }
});

const call = (tool, body = {}, { key = KEY, method = 'POST', type = 'application/json', raw } = {}) => nav.fetch(new Request(
  `https://example.test/api/nav?tool=${tool}`,
  {
    method,
    headers: { 'content-type': type, ...(key ? { 'x-navigator-route-key': key } : {}) },
    body: method === 'GET' ? undefined : (raw ?? JSON.stringify(body)),
  },
));
const out = async response => ({ status: response.status, body: await response.json() });

test('only POST with the tool key and JSON is accepted', async () => {
  assert.equal((await call('get_state', {}, { method: 'GET' })).status, 405);
  assert.equal((await call('get_state', { session_id: SESSION }, { key: 'wrong-key-1234567' })).status, 401);
  assert.equal((await call('get_state', { session_id: SESSION }, { key: null })).status, 401);
  assert.equal((await call('get_state', { session_id: SESSION }, { type: 'text/plain' })).status, 415);
  delete process.env.NAVIGATOR_ROUTE_TOOL_KEY;
  assert.equal((await call('get_state', { session_id: SESSION })).status, 503);
  process.env.NAVIGATOR_ROUTE_TOOL_KEY = KEY;
  process.env.NAVIGATOR_ACCESS_CODE = KEY;
  assert.equal((await call('get_state', { session_id: SESSION })).status, 503, 'the tool key must not equal the access code');
});

test('bad bodies are rejected before any tool runs', async () => {
  assert.equal((await call('get_state', {}, { raw: '{bad json' })).status, 400);
  assert.equal((await call('get_state', { session_id: 'short' })).status, 400);
  assert.equal((await call('get_state', { session_id: SESSION, surprise: 1 })).status, 400);
  assert.equal((await call('get_state', { session_id: SESSION, result: 'x'.repeat(500) })).status, 400);
  assert.equal((await call('get_state', { session_id: SESSION, pad: 'x'.repeat(5000) })).status, 400);
  assert.equal((await call('fly_to_moon', { session_id: SESSION })).status, 400);
  assert.equal((await call('plan_route', { session_id: SESSION, destination_id: 'Kitchen!' })).status, 400);
});

test('without a measured map the tools say so and give no directions', async () => {
  delete process.env.NAVIGATOR_USE_DEMO_MAP;
  const { status, body } = await out(await call('plan_route', { session_id: SESSION, destination_id: 'kitchen', lang: 'en' }));
  assert.equal(status, 200);
  assert.equal(body.status, 'no_map');
  assert.equal(body.say_operator, null);
  assert.match(body.message, /do not know/i);
  assert.equal(mapReady(DTEC_MAP), false, 'the real map is empty until someone measures the floor');
  assert.equal(validateMap(DTEC_MAP).ok, true);
});

test('a whole route works through the endpoint and the state is kept between calls', async () => {
  const ask = (await out(await call('plan_route', { session_id: SESSION, destination_id: 'call_booth_2', lang: 'ar' }))).body;
  assert.equal(ask.status, 'need_start');
  assert.equal(ask.demo, true);
  const first = (await out(await call('confirm_step', { session_id: SESSION, step_id: ask.step_id, result: 'yes' }))).body;
  assert.equal(first.say_operator, 'Operator, walk straight until the booth corridor opens on your right.');
  const state = (await out(await call('get_state', { session_id: SESSION }))).body;
  assert.equal(state.step_id, first.step_id);
  const other = (await out(await call('get_state', { session_id: 'sess-api-0002' }))).body;
  assert.equal(other.step_id, null, 'another session starts fresh');
});

test('the memory store forgets old sessions; the redis store speaks the Upstash REST protocol', async () => {
  const mem = memoryStore(1000);
  await mem.set('abc', { v: 1 }, 0);
  assert.deepEqual(await mem.get('abc', 500), { v: 1 });
  assert.equal(await mem.get('abc', 2000), null);

  const sent = [];
  const fake = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return Response.json({ result: sent.at(-1).body[0] === 'GET' ? JSON.stringify({ v: 2 }) : 'OK' });
  };
  const redis = upstashStore({ url: 'https://kv.example.test', token: 'tok', ttlSeconds: 60, fetchImpl: fake });
  await redis.set('s1', { v: 2 });
  assert.deepEqual(sent[0].body, ['SET', 'nav:s1', '{"v":2}', 'EX', '60']);
  assert.equal(sent[0].auth, 'Bearer tok');
  assert.deepEqual(await redis.get('s1'), { v: 2 });
  const broken = upstashStore({ url: 'https://kv.example.test', token: 'tok', fetchImpl: async () => new Response('no', { status: 500 }) });
  await assert.rejects(() => broken.get('s1'));

  assert.equal(createStore({}).kind, 'memory');
  assert.equal(createStore({ KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: 't' }).kind, 'redis');
  assert.equal(createStore({ UPSTASH_REDIS_REST_URL: 'https://kv.example.test', UPSTASH_REDIS_REST_TOKEN: 't' }).kind, 'redis');
});
