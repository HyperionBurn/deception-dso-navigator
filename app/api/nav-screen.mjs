import { createHash, timingSafeEqual } from 'node:crypto';
import { createStore } from '../lib/nav/store.mjs';
import { loadMap, mapReady } from '../lib/nav/maps.mjs';
import { screenData } from '../lib/nav/screen.mjs';
import { validAccessCode } from '../lib/session-config.mjs';

// The second screen asks this every second or two. Read only. Same team access code as the voice page.
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/u;
const MAX_BODY_BYTES = 1024;
const digest = value => createHash('sha256').update(value, 'utf16le').digest();
const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    const accessCode = process.env.NAVIGATOR_ACCESS_CODE;
    if (!validAccessCode(accessCode)) return json({ error: 'Screen unavailable.' }, 503);
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return json({ error: 'JSON required.' }, 415);
    }
    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return json({ error: 'Invalid request.' }, 400);
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'Invalid request.' }, 400);
    }
    if (!body || typeof body.access_code !== 'string' || !validAccessCode(body.access_code) ||
      !timingSafeEqual(digest(body.access_code), digest(accessCode))) {
      return json({ error: 'The access code was rejected.' }, 401);
    }
    const wanted = body.session_id;
    if (wanted !== 'latest' && !(typeof wanted === 'string' && SESSION_ID.test(wanted))) {
      return json({ error: 'Invalid request.' }, 400);
    }

    const map = loadMap(process.env);
    if (!mapReady(map)) return json({ map_ready: false, demo: map.meta.demo });
    try {
      const store = createStore(process.env);
      const id = wanted === 'latest' ? await store.latest() : wanted;
      const state = id ? await store.get(id) : null;
      if (!state) return json({ error: 'No session yet.' }, 404);
      return json({ map_ready: true, ...screenData(map, state) });
    } catch {
      return json({ error: 'Screen unavailable.' }, 503);
    }
  },
};
