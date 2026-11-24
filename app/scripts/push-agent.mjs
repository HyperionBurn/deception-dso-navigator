// Push agent/system-prompt.txt and the first message to the live ElevenLabs agent.
// Run from app/: node --env-file=.env.local scripts/push-agent.mjs [--dry-run]
import { readFile } from 'node:fs/promises';

const agentId = process.env.ELEVENLABS_AGENT_ID?.trim() || 'agent_0101m86hthvjfm6vqeymg81may5e';
const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

const prompt = (await readFile(new URL('../../agent/system-prompt.txt', import.meta.url), 'utf8')).trim();
const firstMessage = 'أهلًا، أنا دليل آلي بالذكاء الاصطناعي. Hi, I\'m an AI robot guide. Where would you like to go?';
const url = `https://api.elevenlabs.io/v1/convai/agents/${agentId}`;
const headers = { 'xi-api-key': apiKey, 'content-type': 'application/json' };

const current = await fetch(url, { headers });
if (!current.ok) throw new Error(`GET agent failed: ${current.status}`);
const agent = (await current.json()).conversation_config.agent;

const body = {
  conversation_config: {
    agent: {
      first_message: firstMessage,
      prompt: { prompt },
    },
  },
};
console.log(`Prompt: ${prompt.length} chars. Previous: ${agent.prompt.prompt.length} chars.`);
if (process.argv.includes('--dry-run')) process.exit(0);

const response = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
if (!response.ok) throw new Error(`PATCH agent failed: ${response.status} ${await response.text()}`);
const saved = (await response.json()).conversation_config.agent;
if (saved.prompt.prompt.trim() !== prompt) throw new Error('Saved prompt does not match the file');
console.log(`Pushed. LLM ${saved.prompt.llm}, tool_ids ${saved.prompt.tool_ids?.join(', ')}, built-in language_detection: ${Boolean(saved.prompt.built_in_tools?.language_detection)}.`);
