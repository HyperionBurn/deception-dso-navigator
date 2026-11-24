import assert from 'node:assert/strict';
import { test } from 'node:test';
import token from '../api/token.mjs';
import research from '../api/research.mjs';

const ORIGIN = 'https://navigator.example';
const KEY = 'fixture-api-key-not-real';
const CODE = 'fixture-access-code';
const ROUTE_KEY = 'fixture-route-key';
const NAVIGATOR_ID = 'agent_0101m86hthvjfm6vqeymg81may5e';
const REHEARSAL_ID = 'agent_rehearsal_fixture';

function configure(t, values = {}) {
  const env = {
    ELEVENLABS_API_KEY: KEY, NAVIGATOR_ACCESS_CODE: CODE,
    NAVIGATOR_ROUTE_TOOL_KEY: ROUTE_KEY,
    AGENT_ID_NAVIGATOR: undefined, AGENT_ID_REHEARSAL: undefined,
    VOICE_KIT_RESEARCH_TIMEOUT_MS: '500', ELEVENLABS_TIMEOUT_S: '1',
    ...values,
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

const tokenRequest = ({ preset, code = CODE, origin = ORIGIN, method = 'GET' } = {}) => {
  const url = `${ORIGIN}/api/token${preset === undefined ? '' : `?preset=${preset}`}`;
  const headers = {};
  if (code !== null) headers['x-access-code'] = code;   // code: null → omit header
  if (origin !== null) headers.origin = origin;
  return new Request(url, { method, headers });
};

test('token route rejects non-GET, foreign origins and bad access codes', async t => {
  configure(t);
  const upstream = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('unexpected provider call');
  });
  assert.equal((await token.fetch(tokenRequest({ method: 'POST' }))).status, 405);
  assert.equal((await token.fetch(tokenRequest({ origin: 'https://evil.example' }))).status, 403);
  for (const code of [null, 'wrong', 'x'.repeat(300)]) {
    assert.equal((await token.fetch(tokenRequest({ code }))).status, 401, String(code));
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('token route maps presets to pinned agent ids', async t => {
  configure(t, { AGENT_ID_REHEARSAL: REHEARSAL_ID });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ token: 'fixture-token', conversation_id: 'conv_fixture' }));
  for (const [preset, agentId] of [
    ['navigator', NAVIGATOR_ID],
    ['deception-navigator', NAVIGATOR_ID],
    ['rehearsal', REHEARSAL_ID],
  ]) {
    const response = await token.fetch(tokenRequest({ preset }));
    assert.equal(response.status, 200, preset);
    assert.deepEqual(await response.json(), { token: 'fixture-token', agentId });
  }
});

test('token route accepts the code case-insensitively and defaults the preset', async t => {
  configure(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ token: 'fixture-token', conversation_id: 'conv_fixture' }));
  const response = await token.fetch(tokenRequest({ code: '  Fixture-Access-CODE  ' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { token: 'fixture-token', agentId: NAVIGATOR_ID });
});

test('token route 404s unknown or unconfigured presets', async t => {
  configure(t);
  const upstream = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('unexpected provider call');
  });
  assert.equal((await token.fetch(tokenRequest({ preset: 'hala' }))).status, 404);
  assert.equal((await token.fetch(tokenRequest({ preset: 'rehearsal' }))).status, 404);
  assert.equal(upstream.mock.callCount(), 0);
});

test('token route fails closed when the key is missing or the mint fails', async t => {
  configure(t, { ELEVENLABS_API_KEY: undefined });
  assert.equal((await token.fetch(tokenRequest())).status, 503);

  configure(t);
  t.mock.method(globalThis, 'fetch', () => Promise.reject(new Error('provider down')));
  assert.equal((await token.fetch(tokenRequest())).status, 502);
});

const researchRequest = ({ body = { question: 'q' }, code, key, method = 'POST' } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (code !== undefined) headers['x-access-code'] = code;
  if (key !== undefined) headers['x-navigator-route-key'] = key;
  return new Request(`${ORIGIN}/api/research`, {
    method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
};

test('research route gates method, content type and auth', async t => {
  configure(t);
  assert.equal((await research.fetch(researchRequest({ method: 'GET' }))).status, 405);
  const plain = new Request(`${ORIGIN}/api/research`, { method: 'POST', body: '{}' });
  assert.equal((await research.fetch(plain)).status, 415);
  for (const auth of [{}, { code: 'wrong' }, { key: 'wrong' }, { code: null, key: null }]) {
    assert.equal((await research.fetch(researchRequest(auth))).status, 401, JSON.stringify(auth));
  }
});

test('research route serves bundled facts for either credential', async t => {
  configure(t);
  const upstream = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('unexpected research call');
  });
  const body = { question: 'What are the Dtec office opening hours?' };
  for (const auth of [{ code: CODE }, { key: ROUTE_KEY }]) {
    const response = await research.fetch(researchRequest({ body, ...auth }));
    assert.equal(response.status, 200, JSON.stringify(auth));
    const result = await response.json();
    assert.equal(result.cached, true);
    assert.match(result.answer, /7:30|Dtec/i);
    assert.ok(Array.isArray(result.sources));
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('research route validates the question', async t => {
  configure(t);
  for (const body of [{}, { question: '' }, { question: '   ' },
    { question: 'x'.repeat(501) }, { question: 7 }, 'not-json']) {
    const request = new Request(`${ORIGIN}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-code': CODE },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    assert.equal((await research.fetch(request)).status, 400, JSON.stringify(body));
  }
});

test('research route passes through hosted answers and degrades on failure', async t => {
  configure(t);
  const upstream = t.mock.method(globalThis, 'fetch', async url => {
    assert.ok(String(url).includes('/research'));
    return Response.json({ answer: 'Zeppelins dock on the roof of TechnoHub 1.', sources: ['s1'] });
  });
  let response = await research.fetch(researchRequest({
    body: { question: 'Where do the zeppelins dock?' }, code: CODE,
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    answer: 'Zeppelins dock on the roof of TechnoHub 1.', sources: ['s1'], cached: false,
  });
  assert.equal(upstream.mock.callCount(), 1);

  upstream.mock.mockImplementation(() => Promise.reject(new Error('research down')));
  response = await research.fetch(researchRequest({
    body: { question: 'An unbundled question about zeppelins?' }, code: CODE,
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    answer: 'I could not verify that; a human should confirm.', sources: [], cached: false,
  });
});
