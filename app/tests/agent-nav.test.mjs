import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const read = name => readFileSync(new URL(`../../agent/nav/${name}`, import.meta.url), 'utf8');
const prompt = read('system-prompt.txt');
const tools = JSON.parse(read('tools.json'));

test('the navigation prompt stays short and keeps the safety lines', () => {
  assert.ok(prompt.length < 8000, `prompt is ${prompt.length} characters`);
  assert.match(prompt, /You are an AI/);
  assert.match(prompt, /12 words or fewer/);
  assert.match(prompt, /Never invent a place/);
  assert.match(prompt, /Operator, stop\. Stay where you are\./);
});

test('every tool is a webhook with the key header, a session id and a short timeout', () => {
  assert.equal(tools.length, 7);
  for (const t of tools) {
    assert.equal(t.type, 'webhook');
    assert.match(t.api_schema.url, new RegExp(`/api/nav\\?tool=${t.name}$`, 'u'));
    assert.equal(t.api_schema.method, 'POST');
    assert.ok(t.api_schema.request_headers['x-navigator-route-key'].secret_id, `${t.name} needs a secret id`);
    assert.equal(t.api_schema.request_body_schema.properties.session_id.dynamic_variable, 'session_id');
    assert.ok(t.api_schema.request_body_schema.required.includes('session_id'));
    assert.ok(t.response_timeout_secs <= 8);
  }
});

test('the prompt names every tool it uses, and every tool is used', () => {
  for (const t of tools) assert.ok(prompt.includes(t.name), `prompt never mentions ${t.name}`);
  const called = [...prompt.matchAll(/\b(find_place|plan_route|confirm_step|report_landmark|report_lost|change_destination|handover|get_state|place_busy|set_position|mark_arrived)\b/gu)].map(m => m[1]);
  for (const name of new Set(called)) assert.ok(tools.some(t => t.name === name), `${name} is in the prompt but not in tools.json`);
});

test('no secret value is in the tool files', () => {
  const text = JSON.stringify(tools);
  assert.match(text, /REPLACE_WITH_SECRET_ID/);
  assert.doesNotMatch(text, /sk_[A-Za-z0-9]{10,}/);
});

test('tools.json is up to date with make-tools.mjs', async () => {
  const { execFileSync } = await import('node:child_process');
  const before = read('tools.json');
  execFileSync(process.execPath, [fileURLToPath(new URL('../../agent/nav/make-tools.mjs', import.meta.url))]);
  assert.equal(read('tools.json'), before);
});
