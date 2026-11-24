import { createHash, timingSafeEqual } from 'node:crypto';
import { FLOOR_MAP } from '../lib/floor-map.mjs';
import { REHEARSAL_MAP } from '../lib/rehearsal-map.mjs';
import { planRoute, validFacing, validHeading, validId, validObservedLandmark } from '../lib/route-planner.mjs';

const MAX_BODY_BYTES = 2048;
// Printable ASCII except comma, which also separates repeated HTTP headers.
const secretFormat = /^[\x21-\x2b\x2d-\x7e]{1,256}$/u;
const requestFields = new Set(['destination_id', 'current_id', 'current_landmark', 'heading', 'facing']);
const digest = value => createHash('sha256').update(value).digest();
const json = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});

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
    Object.keys(body).every(key => requestFields.has(key)) && validId(body.destination_id) &&
    (body.current_id == null || validId(body.current_id)) &&
    (body.current_landmark == null || validObservedLandmark(body.current_landmark)) &&
    !(body.current_id != null && body.current_landmark != null) &&
    (body.heading == null || validHeading(body.heading)) &&
    (body.facing == null || validFacing(body.facing)) &&
    !(body.heading != null && body.facing != null) &&
    (body.current_id != null || body.current_landmark != null || (body.heading == null && body.facing == null));
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });

    const secret = process.env.NAVIGATOR_ROUTE_TOOL_KEY;
    if (!secret || !secretFormat.test(secret) || secret === process.env.NAVIGATOR_ACCESS_CODE ||
      secret === process.env.ELEVENLABS_API_KEY?.trim()) {
      return json({ error: 'Route tool unavailable.' }, 503);
    }
    const supplied = request.headers.get('x-navigator-route-key');
    if (!supplied || !secretFormat.test(supplied) || !timingSafeEqual(digest(supplied), digest(secret))) {
      return json({ error: 'Invalid route key.' }, 401);
    }
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return json({ error: 'JSON required.' }, 415);
    }

    let body;
    try {
      body = await readJson(request);
    } catch {
      return json({ error: 'Invalid route request.' }, 400);
    }
    if (!validBody(body)) return json({ error: 'Invalid route request.' }, 400);
    const map = process.env.NAVIGATOR_MAP_VARIANT === 'rehearsal' ? REHEARSAL_MAP : FLOOR_MAP;
    return json(planRoute(map, body));
  },
};
