import { createHash, timingSafeEqual } from 'node:crypto';
import { createStore } from '../lib/nav/store.mjs';
import { loadMap, mapReady } from '../lib/nav/maps.mjs';
import { HANDOVER_SAY, TOOL_NAMES, runTool, writesState } from '../lib/nav/tools.mjs';

// Webhook tools for the voice agent. POST /api/nav?tool=<name> with a flat JSON body: { session_id, ...args }.
// Same secret header as /api/route (NAVIGATOR_ROUTE_TOOL_KEY). Position and route state is kept per session_id.

const MAX_BODY_BYTES = 4096;
const secretFormat = /^[\x21-\x2b\x2d-\x7e]{1,256}$/u;
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/u;
const PLACE_ID = /^[a-z][a-z0-9_]{0,31}$/u;
const digest = value => createHash('sha256').update(value).digest();
const json = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});

const text = max => value => typeof value === 'string' && value.length > 0 && value.length <= max;
const fields = {
  session_id: value => typeof value === 'string' && SESSION_ID.test(value),
  destination_id: value => typeof value === 'string' && PLACE_ID.test(value),
  place_id: value => typeof value === 'string' && PLACE_ID.test(value),
  node: value => typeof value === 'string' && PLACE_ID.test(value),
  edge: value => typeof value === 'string' && PLACE_ID.test(value),
  lang: value => typeof value === 'string' && /^[A-Za-z-]{2,12}$/u.test(value),
  query: text(120),
  thing: text(80),
  reason: text(120),
  result: text(24),
  side: value => ['left', 'right', 'ahead'].includes(value),
  heading: value => ['N', 'E', 'S', 'W'].includes(value),
  dir: value => value === 1 || value === -1,
  step_id: value => Number.isSafeInteger(value) && value >= 0,
  done: value => Number.isSafeInteger(value) && value >= 0 && value <= 200,
};

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
      if (size > MAX_BODY_BYTES) return null;
      content += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function validBody(body) {
  return body && typeof body === 'object' && !Array.isArray(body) &&
    Object.entries(body).every(([key, value]) => Object.hasOwn(fields, key) && fields[key](value)) &&
    Object.hasOwn(body, 'session_id');
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });

    const secret = process.env.NAVIGATOR_ROUTE_TOOL_KEY;
    if (!secret || !secretFormat.test(secret) || secret === process.env.NAVIGATOR_ACCESS_CODE ||
      secret === process.env.ELEVENLABS_API_KEY?.trim()) {
      return json({ error: 'Navigation tools unavailable.' }, 503);
    }
    const supplied = request.headers.get('x-navigator-route-key');
    if (!supplied || !secretFormat.test(supplied) || !timingSafeEqual(digest(supplied), digest(secret))) {
      return json({ error: 'Invalid tool key.' }, 401);
    }
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return json({ error: 'JSON required.' }, 415);
    }

    const tool = new URL(request.url).searchParams.get('tool');
    if (!TOOL_NAMES.includes(tool)) return json({ error: 'Unknown tool.' }, 400);
    let body;
    try {
      body = await readJson(request);
    } catch {
      return json({ error: 'Invalid request.' }, 400);
    }
    if (!validBody(body)) return json({ error: 'Invalid request.' }, 400);

    const map = loadMap(process.env);
    if (!mapReady(map)) {
      return json({
        ok: false, status: 'no_map', say_operator: null,
        message: 'There is no measured floor map yet. Do not give directions. Say you do not know the way and ask for a person.',
      });
    }

    const { session_id: sessionId, ...args } = body;
    try {
      const store = createStore(process.env);
      const now = Date.now();
      const before = await store.get(sessionId, now);
      const { state, result } = runTool({ map, state: before, session_id: sessionId, tool, args, now });
      if (writesState(tool, result)) await store.set(sessionId, state, now);
      return json(result, 200, { 'X-Nav-Store': store.kind });
    } catch (error) {
      console.error('nav tool failed:', tool, error?.name, error?.message);
      // Never leave the operator without an instruction: tell them to stay put and ask for a person.
      return json({
        ok: false, status: 'handover', say_operator: HANDOVER_SAY,
        tell_visitor_en: 'I am not sure where we are. Please wait. I am calling a person to help.',
        message: 'The navigation service had a problem. Do not guess directions.',
      });
    }
  },
};
