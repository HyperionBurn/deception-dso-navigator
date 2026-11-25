import { LOCATE_FACINGS, LOCATE_PLACES, LOCATE_PROMPT } from '../lib/locate-prompt.mjs';
import { accessCodeOk, getConfig, json } from '../lib/session-config.mjs';

const MAX_IMAGE_BYTES = 700000;
const UPSTREAM_TIMEOUT_MS = 20000;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Reads the JSON body, streaming so a large image is rejected at the cap
// instead of being buffered whole. Returns { body } or { status }.
async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return { status: 400 };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let content = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        try {
          return { body: JSON.parse(content + decoder.decode()) };
        } catch {
          return { status: 400 };
        }
      }
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) return { status: 413 };
      content += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function firstJson(text) {
  const cleaned = String(text).replace(/```[a-z]*\s*\n?/gi, ' ');
  const match = cleaned.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

const replyText = message => {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => part?.text ?? '').join('');
  }
  return '';
};

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return json({ error: 'JSON required.' }, 415);
    }
    if (!accessCodeOk(request.headers.get('x-access-code'), getConfig().accessCode)) {
      return json({ error: 'Not authorized.' }, 401);
    }

    const { body, status } = await readJson(request);
    if (status) return json({ error: status === 413 ? 'Image too large.' : 'Invalid request.' }, status);
    const image = body?.image;
    if (typeof image !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(image)) {
      return json({ error: 'Invalid image.' }, 400);
    }
    const bytes = Buffer.from(image, 'base64');
    if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return json({ error: 'Invalid image.' }, 400);
    }

    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return json({ error: 'Locator unavailable.' }, 503);

    const started = Date.now();
    let upstream;
    try {
      upstream = await globalThis.fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: process.env.LOCATE_MODEL || 'particle-ai/particle-1:free',
          temperature: 0,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: LOCATE_PROMPT },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      return json({ error: 'Locator failed.' }, 502);
    }
    if (!upstream.ok) return json({ error: 'Locator failed.' }, 502);
    const data = await upstream.json().catch(() => null);
    const ms = Date.now() - started;

    const parsed = firstJson(replyText(data?.choices?.[0]?.message));
    if (!parsed || typeof parsed !== 'object') {
      return json({ at: null, landmark: null, facing: null, confidence: null, ms });
    }
    const at = Object.hasOwn(LOCATE_PLACES, parsed.at) && parsed.confidence === 'high'
      ? parsed.at
      : null;
    return json({
      at,
      landmark: at ? LOCATE_PLACES[at] : null,
      facing: at && LOCATE_FACINGS.includes(parsed.facing) ? parsed.facing : null,
      confidence: parsed.confidence ?? null,
      ms,
    });
  },
};
