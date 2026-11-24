import assert from 'node:assert/strict';
import { test } from 'node:test';
import status from '../api/status.mjs';
import session from '../api/session.mjs';

const ORIGIN = 'https://navigator.example';
const DEFAULT_AGENT = 'agent_0101m86hthvjfm6vqeymg81may5e';
const AGENT = 'agent_test';
const KEY = 'fixture-api-key-not-real';
const CODE = 'fixture-access-code';
const SOCKET = 'wss://api.elevenlabs.io/v1/convai/conversation';
const SIGNED = `${SOCKET}?agent_id=${AGENT}&conversation_signature=fixture-signature`;

function configure(t, values = {}) {
  const config = {
    ELEVENLABS_API_KEY: KEY, NAVIGATOR_ACCESS_CODE: CODE, ELEVENLABS_AGENT_ID: AGENT, ...values,
  };
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  function set(values) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  set(config);
  t.after(() => set(previous));
}

function request({ method = 'POST', origin = ORIGIN, url = ORIGIN, headers, body = JSON.stringify({ access_code: CODE }) } = {}) {
  const allHeaders = new Headers({ 'content-type': 'application/json', ...headers });
  if (origin !== null) allHeaders.set('origin', origin);
  return new Request(`${url}/api/session`, { method, headers: allHeaders, body: method === 'POST' ? body : undefined });
}

async function expectError(response, code) {
  assert.equal(response.status, code);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(typeof body.error, 'string');
  assert.ok(!body.error.includes(KEY) && !body.error.includes(CODE));
  return body.error;
}

test('status exposes readiness and agent ID only', async t => {
  for (const [vars, expected] of [
    [{ ELEVENLABS_API_KEY: undefined, NAVIGATOR_ACCESS_CODE: undefined, ELEVENLABS_AGENT_ID: undefined }, { live_ready: false, agent_id: DEFAULT_AGENT }],
    [{ NAVIGATOR_ACCESS_CODE: undefined }, { live_ready: false, agent_id: AGENT }],
    [{ ELEVENLABS_API_KEY: undefined }, { live_ready: false, agent_id: AGENT }],
    [{}, { live_ready: true, agent_id: AGENT }],
  ]) {
    await t.test(JSON.stringify(expected) + ` (${Object.keys(vars).length} overrides)`, async sub => {
      configure(sub, vars);
      const response = await status.fetch(new Request(`${ORIGIN}/api/status`));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(await response.json(), expected);
      await expectError(await status.fetch(new Request(`${ORIGIN}/api/status`, { method: 'POST' })), 405);
    });
  }
});

test('wrong origin, method, media type, body, or access code never reaches signing', async t => {
  configure(t);
  const upstream = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected signing call'); });
  for (const [options, code] of [
    [{ method: 'OPTIONS' }, 405],
    [{ origin: 'https://rogue.example', headers: { 'x-forwarded-host': 'rogue.example' } }, 403],
    [{ origin: 'https://navigator.example:444' }, 403],
    [{ origin: 'http://navigator.example' }, 403],
    [{ origin: null }, 403],
    [{ origin: 'null' }, 403],
    [{ headers: { host: 'rogue.example' } }, 403],
    [{ headers: { 'content-type': 'text/plain' } }, 415],
    [{ body: '{' }, 400],
    [{ body: `{"large":"${'x'.repeat(4096)}"}` }, 400],
    [{ body: '[]' }, 400],
    [{ body: '{}' }, 401],
    [{ body: '{"access_code":"short"}' }, 401],
    [{ body: JSON.stringify({ access_code: `${CODE}x` }) }, 401],
  ]) {
    await expectError(await session.fetch(request(options)), code);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('offline session never reaches signing', async t => {
  configure(t, { NAVIGATOR_ACCESS_CODE: undefined });
  const upstream = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected signing call'); });
  await expectError(await session.fetch(request()), 503);
  assert.equal(upstream.mock.callCount(), 0);
});

test('a short access code is rejected even if it matches the configured value', async t => {
  configure(t, { NAVIGATOR_ACCESS_CODE: 'abc' });
  const upstream = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected signing call'); });
  await expectError(await session.fetch(request({ body: '{"access_code":"abc"}' })), 401);
  assert.equal(upstream.mock.callCount(), 0);
});

test('authorized HTTPS origin can sign through Vercel TLS termination', async t => {
  configure(t);
  const upstream = t.mock.method(globalThis, 'fetch', async () => Response.json({ signed_url: SIGNED }));
  const response = await session.fetch(request({
    url: 'http://navigator.example',
    headers: { host: 'navigator.example', 'x-forwarded-proto': 'https', 'content-type': 'application/json; charset=utf-8' },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await response.json(), { signed_url: SIGNED });
  assert.equal(upstream.mock.callCount(), 1);
  const [url, options] = upstream.mock.calls[0].arguments;
  assert.equal(new URL(url).href, `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${AGENT}`);
  assert.equal(options.method, 'GET');
  assert.equal(new Headers(options.headers).get('xi-api-key'), KEY);
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal && !options.signal.aborted);
});

test('accepts the documented alternate token query name', async t => {
  configure(t);
  const signed = SIGNED.replace('conversation_signature', 'token');
  t.mock.method(globalThis, 'fetch', async () => Response.json({ signed_url: signed }));
  const response = await session.fetch(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { signed_url: signed });
});

test('provider failures and unsafe URLs all return the same generic error', async t => {
  configure(t);
  const upstream = t.mock.method(globalThis, 'fetch');
  const invalid = [
    null, `https${SIGNED.slice(3)}`, SIGNED.replace('api.elevenlabs.io', 'rogue.example'),
    SIGNED.replace('api.elevenlabs.io', 'api.elevenlabs.io@rogue.example'),
    SIGNED.replace('api.elevenlabs.io', 'api.elevenlabs.io:444'),
    SIGNED.replace('/conversation?', '/other?'), `${SIGNED}#`, `${SIGNED}&extra=surprise`,
    `${SIGNED}&conversation_signature=duplicate`, `${SIGNED}&token=duplicate`,
    SIGNED.replace(AGENT, 'agent_other'), SIGNED.replace('fixture-signature', ''),
    SIGNED.replace('fixture-signature', encodeURIComponent(`echo=${KEY}`)),
    SIGNED.replace('fixture-signature', encodeURIComponent(CODE)),
  ];
  for (const reply of [
    () => { throw new Error(KEY); },
    () => { throw new DOMException('Timeout', 'TimeoutError'); },
    () => new Response(KEY, { status: 401 }),
    () => new Response(null, { status: 302, headers: { location: 'https://rogue.example/' } }),
    () => new Response('not JSON'),
    ...invalid.map(signed_url => () => Response.json({ signed_url })),
  ]) {
    upstream.mock.mockImplementationOnce(reply);
    assert.equal(await expectError(await session.fetch(request()), 502), 'Unable to start live voice.');
  }
});
