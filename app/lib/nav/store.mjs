// Where session state lives between tool calls.
// memory: fine for tests and one warm server, but Vercel may start a fresh instance between calls.
// redis: any Upstash-style REST Redis (add the Upstash integration in Vercel; it sets the two env vars).

const SESSION_TTL_SECONDS = 2 * 60 * 60;

export function memoryStore(ttlMs = SESSION_TTL_SECONDS * 1000) {
  const sessions = new Map();
  return {
    kind: 'memory',
    async get(id, now = Date.now()) {
      const hit = sessions.get(id);
      if (!hit) return null;
      if (now - hit.at > ttlMs) { sessions.delete(id); return null; }
      return structuredClone(hit.state);
    },
    async set(id, state, now = Date.now()) {
      sessions.set(id, { at: now, state: structuredClone(state) });
    },
  };
}

export function upstashStore({ url, token, ttlSeconds = SESSION_TTL_SECONDS, fetchImpl = fetch }) {
  const run = async command => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (!response.ok) throw new Error(`state store failed: ${response.status}`);
    return (await response.json()).result;
  };
  return {
    kind: 'redis',
    async get(id) {
      const raw = await run(['GET', `nav:${id}`]);
      return raw ? JSON.parse(raw) : null;
    },
    async set(id, state) {
      await run(['SET', `nav:${id}`, JSON.stringify(state), 'EX', String(ttlSeconds)]);
    },
  };
}

const shared = memoryStore();

export function createStore(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? upstashStore({ url, token }) : shared;
}
