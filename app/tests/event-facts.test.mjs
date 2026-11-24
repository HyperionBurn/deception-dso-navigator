import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchFact } from '@workhub/voice-kit';
import { BUNDLED_FACTS } from '../node_modules/@workhub/voice-kit/dist/data/facts.js';
import research from '../api/research.mjs';
import { EVENT_FACTS } from '../lib/event-facts.mjs';

const CODE = 'fixture-access-code';

const ask = question => research.fetch(new Request('https://navigator.example/api/research', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-access-code': CODE },
  body: JSON.stringify({ question }),
}));

function configure(t) {
  const saved = { NAVIGATOR_ACCESS_CODE: process.env.NAVIGATOR_ACCESS_CODE };
  process.env.NAVIGATOR_ACCESS_CODE = CODE;
  t.after(() => {
    if (saved.NAVIGATOR_ACCESS_CODE === undefined) delete process.env.NAVIGATOR_ACCESS_CODE;
    else process.env.NAVIGATOR_ACCESS_CODE = saved.NAVIGATOR_ACCESS_CODE;
  });
  return t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected research call'); });
}

test('every event fact is short, sourced from the organiser guides and found by its own question', () => {
  for (const fact of EVENT_FACTS) {
    assert.ok(fact.answer.split(/\s+/).length <= 40, fact.question);
    assert.ok(fact.sources.length && fact.sources.every(s => /Voice of the Oasis Team Guide/.test(s)), fact.question);
    assert.equal(matchFact(fact.question, EVENT_FACTS), fact, fact.question);
  }
});

test('event facts do not take over the voice-kit facts', () => {
  for (const fact of BUNDLED_FACTS) {
    assert.equal(matchFact(fact.question, EVENT_FACTS), undefined, fact.question);
  }
});

test('research route answers event questions locally, in plain wording', async t => {
  const upstream = configure(t);
  const cases = [
    ['When are the winners announced?', /10:45/],
    ['Who is on the jury?', /George Shayeb/],
    ['What robot is this?', /AgiBot X2 Ultra/],
    ['Who controls the robot?', /operator/],
    ['Where do I get the WiFi details?', /registration/],
    ['What is HADI?', /226/],
  ];
  for (const [question, expected] of cases) {
    const response = await ask(question);
    assert.equal(response.status, 200, question);
    const body = await response.json();
    assert.match(body.answer, expected, question);
    assert.equal(body.cached, true, question);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('a question that only names HADI is not answered with the HADI fact', () => {
  assert.equal(matchFact('How do I request maintenance through the HADI chatbot?', EVENT_FACTS), undefined);
});
