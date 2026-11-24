import { createHash, timingSafeEqual } from 'node:crypto';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { getConfig, json, validAccessCode } from '../lib/session-config.mjs';

const SOCKET_URL = 'wss://api.elevenlabs.io/v1/convai/conversation';
const MAX_BODY_BYTES = 4096;

function sameOrigin(request) {
  const target = new URL(request.url);
  const host = request.headers.get('host')?.toLowerCase();
  const localScheme = target.protocol.slice(0, -1);
  if (localScheme !== 'http' && localScheme !== 'https') return false;
  const defaultPort = localScheme === 'https' ? 443 : 80;
  if (host && host !== target.host && (target.port || host !== `${target.host}:${defaultPort}`)) {
    return false;
  }
  // Vercel terminates TLS before its adapter constructs the Request URL.
  const scheme = (host && request.headers.get('x-forwarded-proto')) || localScheme;
  if (scheme !== 'http' && scheme !== 'https') return false;
  return request.headers.get('origin') === new URL(`${scheme}://${host || target.host}`).origin;
}

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(text + decoder.decode());
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) return null;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    // Cancel unread input without holding the response open for more input.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function digest(value) {
  return createHash('sha256').update(value, 'utf16le').digest();
}

function safeSignedUrl(value, { agentId, apiKey, accessCode }) {
  if (typeof value !== 'string' || value.length > 8192 ||
      !value.startsWith(`${SOCKET_URL}?`) || /[\s#\p{Cc}]/u.test(value)) return false;

  const { searchParams } = new URL(value);
  const agents = searchParams.getAll('agent_id');
  const signatures = [...searchParams.getAll('conversation_signature'), ...searchParams.getAll('token')];
  if (searchParams.size !== 2 || agents.length !== 1 || agents[0] !== agentId || signatures.length !== 1) {
    return false;
  }
  const signature = signatures[0];
  return Boolean(signature) && !/[\s\p{Cc}]/u.test(signature) &&
    !signature.includes(apiKey) && !signature.includes(accessCode);
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
    }
    if (!sameOrigin(request)) return json({ error: 'Origin not allowed.' }, 403);
    const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (mediaType !== 'application/json') return json({ error: 'JSON required.' }, 415);

    const config = getConfig();
    if (!config.liveReady) return json({ error: 'Live voice unavailable.' }, 503);

    let payload;
    try {
      payload = await readBody(request);
    } catch {
      return json({ error: 'Invalid request.' }, 400);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return json({ error: 'Invalid request.' }, 400);
    }
    const code = Object.hasOwn(payload, 'access_code') ? payload.access_code : undefined;
    if (!validAccessCode(code) ||
      !timingSafeEqual(digest(code.trim()), digest(config.accessCode.trim()))) {
      return json({ error: 'Invalid access code.' }, 401);
    }

    try {
      const client = new ElevenLabsClient({
        apiKey: config.apiKey,
        baseUrl: 'https://api.elevenlabs.io',
        timeoutInSeconds: 8,
        maxRetries: 0,
        fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }),
      });
      const { signedUrl } = await client.conversationalAi.conversations.getSignedUrl({ agentId: config.agentId });
      if (safeSignedUrl(signedUrl, config)) return json({ signed_url: signedUrl });
    } catch {
      // Do not log provider errors. They can contain credentials or signed URLs.
    }
    return json({ error: 'Unable to start live voice.' }, 502);
  },
};
