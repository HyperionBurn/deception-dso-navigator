const DEFAULT_AGENT_ID = 'agent_0101m86hthvjfm6vqeymg81may5e';

export function validAccessCode(value) {
  return typeof value === 'string' && value.length <= 256 && value.trim().length >= 12;
}

export function getConfig(env = process.env) {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  const accessCode = env.NAVIGATOR_ACCESS_CODE;
  const agentId = env.ELEVENLABS_AGENT_ID?.trim() || DEFAULT_AGENT_ID;
  return { apiKey, accessCode, agentId, liveReady: Boolean(apiKey && accessCode) };
}

export function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}
