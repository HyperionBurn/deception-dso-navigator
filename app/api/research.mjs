import { createResearchClient } from '@workhub/voice-kit';
import { accessCodeOk, getConfig, json, secretOk } from '../lib/session-config.mjs';

const MAX_QUESTION = 500;
const FALLBACK = 'I could not verify that; a human should confirm.';
// Lazy singleton; fetchFn delegates at call time so tests can stub fetch.
let research;
const researcher = () => (research ??= createResearchClient({
  fetchFn: (url, init) => fetch(url, init),
  timeoutMs: Number(process.env.VOICE_KIT_RESEARCH_TIMEOUT_MS) || 25000,
}));

async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let content = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(content + decoder.decode());
      size += value.byteLength;
      if (size > 2048) return null;
      content += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return json({ error: 'JSON required.' }, 415);
    }
    // Callers authenticate either as a teammate (access code) or as the
    // ElevenLabs webhook tool (route key); either alone is sufficient.
    const config = getConfig();
    const byCode = accessCodeOk(request.headers.get('x-access-code'), config.accessCode);
    const byKey = secretOk(request.headers.get('x-navigator-route-key'), process.env.NAVIGATOR_ROUTE_TOOL_KEY);
    if (!byCode && !byKey) return json({ error: 'Not authorized.' }, 401);

    let body;
    try {
      body = await readJson(request);
    } catch {
      body = null;
    }
    const question = body?.question;
    if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION) {
      return json({ error: 'Invalid research request.' }, 400);
    }

    const result = await researcher()(question).catch(() => null);
    if (!result || typeof result.answer !== 'string' || /could not verify/i.test(result.answer)) {
      return json({ answer: FALLBACK, sources: [], cached: false });
    }
    return json({
      answer: result.answer,
      sources: Array.isArray(result.sources) ? result.sources : [],
      cached: Boolean(result.cached),
    });
  },
};
