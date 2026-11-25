// Create the stage agent for the Doers Summit demo, cloned from the
// production navigator agent with only the stage changes applied.
// Idempotent: the new agent id is kept in .private/stage-agent-id.txt and a
// second run PATCHes that agent instead of creating another.
// Run from app/: node --env-file=.env.local scripts/create-stage-agent.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');
const sourceId = process.env.ELEVENLABS_AGENT_ID?.trim() || 'agent_0101m86hthvjfm6vqeymg81may5e';
const idFile = new URL('../.private/stage-agent-id.txt', import.meta.url);
const privateDir = new URL('../.private/', import.meta.url);

const prompt = (await readFile(new URL('../../agent/stage-prompt.txt', import.meta.url), 'utf8')).trim();
const headers = { 'xi-api-key': apiKey, 'content-type': 'application/json' };
const api = 'https://api.elevenlabs.io/v1/convai/agents';

async function getAgent(id) {
  const response = await fetch(`${api}/${id}`, { headers });
  if (!response.ok) throw new Error(`GET agent ${id} failed: ${response.status}`);
  return response.json();
}

const source = await getAgent(sourceId);
const conversationConfig = JSON.parse(JSON.stringify(source.conversation_config));
conversationConfig.agent.first_message = '';
conversationConfig.agent.prompt.prompt = prompt;
conversationConfig.agent.prompt.tool_ids = [];
conversationConfig.agent.prompt.tools = [];   // inline defs would re-register as tool_ids
for (const key of Object.keys(conversationConfig.agent.prompt.built_in_tools ?? {})) {
  conversationConfig.agent.prompt.built_in_tools[key] = null;
}
conversationConfig.language_presets = {};
conversationConfig.conversation.max_duration_seconds = 1800;
// No stall nudges or filler on stage: silence and long pauses are the show.
conversationConfig.turn.turn_timeout = -1;
conversationConfig.turn.soft_timeout_config = {
  ...(conversationConfig.turn.soft_timeout_config ?? {}),
  timeout_seconds: -1,
};

const body = {
  name: 'Deception Stage - Doers Summit',
  conversation_config: conversationConfig,
  platform_settings: source.platform_settings,
};

let existing = null;
try {
  existing = (await readFile(idFile, 'utf8')).trim() || null;
} catch { /* first run */ }

let agentId = existing;
if (agentId) {
  const response = await fetch(`${api}/${agentId}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`PATCH agent ${agentId} failed: ${response.status} ${await response.text()}`);
} else {
  const response = await fetch(`${api}/create`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`create agent failed: ${response.status} ${await response.text()}`);
  agentId = (await response.json()).agent_id;
  await mkdir(privateDir, { recursive: true });
  await writeFile(idFile, `${agentId}\n`);
}

// Verify what was actually saved.
const saved = await getAgent(agentId);
const cfg = saved.conversation_config;
const checks = [
  ['prompt', cfg.agent.prompt.prompt === prompt],
  ['first_message empty', cfg.agent.first_message === ''],
  ['tool_ids empty', Array.isArray(cfg.agent.prompt.tool_ids) && cfg.agent.prompt.tool_ids.length === 0],
  ['built_in_tools null', Object.values(cfg.agent.prompt.built_in_tools ?? {}).every(v => v === null)],
  ['language_presets empty', Object.keys(cfg.language_presets ?? {}).length === 0],
  ['max_duration 1800', cfg.conversation.max_duration_seconds === 1800],
  ['turn_timeout -1', cfg.turn?.turn_timeout === -1],
  ['soft_timeout -1', cfg.turn?.soft_timeout_config?.timeout_seconds === -1],
  ['tts pcm_16000', JSON.stringify(cfg.tts ?? {}).includes('pcm_16000')],
  ['asr pcm_16000', JSON.stringify(cfg.asr ?? {}).includes('pcm_16000')],
];
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) throw new Error(`verification failed: ${failed.join(', ')}`);
console.log(`agent_id: ${agentId}`);
console.log(`prompt: ${cfg.agent.prompt.prompt.length} chars (verified)`);
