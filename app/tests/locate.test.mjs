import assert from 'node:assert/strict';
import { test } from 'node:test';
import locate from '../api/locate.mjs';

const ORIGIN = 'https://navigator.example';
const CODE = 'fixture-access-code';
const OPENROUTER_KEY = 'fixture-openrouter-key';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');

function configure(t, values = {}) {
  const env = {
    NAVIGATOR_ACCESS_CODE: CODE, OPENROUTER_API_KEY: OPENROUTER_KEY,
    LOCATE_MODEL: undefined, ...values,
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const locateRequest = ({ body = { image: JPEG }, code = CODE, method = 'POST', type = 'application/json', raw } = {}) =>
  new Request(`${ORIGIN}/api/locate`, {
    method,
    headers: { 'content-type': type, ...(code !== null ? { 'x-access-code': code } : {}) },
    body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined,
  });

const upstreamReply = (content) => Response.json({
  choices: [{ message: { role: 'assistant', content } }],
});

test('locate route gates method, content type and auth', async t => {
  configure(t);
  assert.equal((await locate.fetch(locateRequest({ method: 'GET' }))).status, 405);
  const plain = new Request(`${ORIGIN}/api/locate`, { method: 'POST', body: '{}' });
  assert.equal((await locate.fetch(plain)).status, 415);
  for (const code of [null, 'wrong', CODE + 'x']) {
    assert.equal((await locate.fetch(locateRequest({ code }))).status, 401, String(code));
  }
});

test('locate route rejects oversized and invalid images', async t => {
  configure(t);
  const big = { image: 'A'.repeat(700001) };
  assert.equal((await locate.fetch(locateRequest({ body: big }))).status, 413);
  for (const body of [{}, { image: 7 }, { image: '!!!not-base64!!!' },
    { image: Buffer.from('not a jpeg').toString('base64') },
    { image: '' }]) {
    assert.equal((await locate.fetch(locateRequest({ body }))).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await locate.fetch(locateRequest({ raw: '{' }))).status, 400);
});

test('locate route is unavailable without the key', async t => {
  configure(t, { OPENROUTER_API_KEY: undefined });
  assert.equal((await locate.fetch(locateRequest())).status, 503);
});

test('locate route maps a high-confidence reply to landmark and facing', async t => {
  configure(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), init });
    return upstreamReply('{"at":"A","facing":"reception","visible":[],"confidence":"high"}');
  });
  const response = await locate.fetch(locateRequest());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.at, 'A');
  assert.equal(result.landmark, 'the pitch room door');
  assert.equal(result.facing, 'reception');
  assert.equal(result.confidence, 'high');
  assert.equal(typeof result.ms, 'number');

  const { init } = calls[0];
  const sent = JSON.parse(init.body);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(sent.model, 'particle-ai/particle-1:free');
  assert.equal(sent.temperature, 0);
  assert.equal(init.headers.authorization, `Bearer ${OPENROUTER_KEY}`);
  assert.ok(sent.messages[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,'));
  assert.ok(!JSON.stringify(sent).includes(CODE));
});

test('locate route drops untrusted at and facing values', async t => {
  configure(t);
  for (const [reply, expected] of [
    ['{"at":"A","facing":"reception","confidence":"low"}', { at: null, facing: null }],
    ['{"at":"garage","facing":"reception","confidence":"high"}', { at: null, facing: null }],
    ['{"at":"team_tables","facing":"upstairs","confidence":"high"}', { at: 'team_tables', facing: null }],
    ['{"at":"B","facing":"team tables","confidence":"high"}', { at: 'B', facing: 'team tables' }],
  ]) {
    t.mock.method(globalThis, 'fetch', () => Promise.resolve(upstreamReply(reply)));
    const response = await locate.fetch(locateRequest());
    assert.equal(response.status, 200, reply);
    const result = await response.json();
    assert.equal(result.at, expected.at, reply);
    assert.equal(result.facing, expected.facing, reply);
    t.mock.reset();
  }
});

test('locate route parses fenced JSON and survives garbage', async t => {
  configure(t);
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(
    upstreamReply('Sure!\n```json\n{"at":"kitchen","facing":"menu boards","confidence":"high"}\n```\nDone.')));
  let result = await (await locate.fetch(locateRequest())).json();
  assert.equal(result.at, 'kitchen');
  assert.equal(result.landmark, 'the cafeteria menu boards');
  assert.equal(result.facing, 'menu boards');

  t.mock.method(globalThis, 'fetch', () => Promise.resolve(upstreamReply('no json here at all')));
  result = await (await locate.fetch(locateRequest())).json();
  assert.equal(result.at, null);
  assert.equal(result.landmark, null);
});

test('locate route returns 502 on upstream failure without leaking details', async t => {
  configure(t);
  for (const failure of [
    () => Promise.resolve(new Response('rate limited secret body', { status: 429 })),
    () => Promise.reject(new Error('socket hang up')),
  ]) {
    t.mock.method(globalThis, 'fetch', failure);
    const response = await locate.fetch(locateRequest());
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'Locator failed.' });
    t.mock.reset();
  }
});
