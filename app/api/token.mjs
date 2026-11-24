import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { createVoiceKit } from '@workhub/voice-kit';
import { accessCodeOk, getConfig, json, sameOrigin } from '../lib/session-config.mjs';

const NAVIGATOR_AGENT_ID = 'agent_0101m86hthvjfm6vqeymg81may5e';

// Preset name → pinned agent id. Never auto-provisions: the kit's ensureAgent
// would create or overwrite agents by name, so we only mint tokens for ids
// we already own. AGENT_ID_* envs pin the ids per environment; only the
// navigator agent exists in production.
function agentFor(preset, env = process.env) {
  const ids = {
    'navigator': env.AGENT_ID_NAVIGATOR || NAVIGATOR_AGENT_ID,
    'deception-navigator': env.AGENT_ID_NAVIGATOR || NAVIGATOR_AGENT_ID,
    'rehearsal': env.AGENT_ID_REHEARSAL,
  };
  return ids[preset];
}

export default {
  async fetch(request) {
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
    // Browsers omit Origin on plain GET fetches; reject only a present, foreign
    // Origin. The access code is the actual gate.
    if (!sameOrigin(request, { allowMissing: true })) return json({ error: 'Origin not allowed.' }, 403);
    const config = getConfig();
    if (!accessCodeOk(request.headers.get('x-access-code'), config.accessCode)) {
      return json({ error: 'Invalid access code.' }, 401);
    }
    const preset = new URL(request.url).searchParams.get('preset') ?? 'navigator';
    const agentId = agentFor(preset);
    if (!agentId) return json({ error: 'Unknown preset.' }, 404);
    if (!config.apiKey) return json({ error: 'Live voice unavailable.' }, 503);
    try {
      const client = new ElevenLabsClient({
        apiKey: config.apiKey,
        baseUrl: 'https://api.elevenlabs.io',
        timeoutInSeconds: Number(process.env.ELEVENLABS_TIMEOUT_S) || 8,
        maxRetries: 0,
        fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }),
      });
      const token = await createVoiceKit({ client }).conversationToken(agentId);
      if (typeof token === 'string' && token && !token.includes(config.apiKey)) {
        return json({ token, agentId });
      }
    } catch {
      // Do not log provider errors. They can contain credentials.
    }
    return json({ error: 'Unable to mint a conversation token.' }, 502);
  },
};
