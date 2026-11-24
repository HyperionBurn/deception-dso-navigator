// Where session state lives between tool calls.
// memory: fine for tests and one warm server, but Vercel may start a fresh instance between calls.
// redis: any Upstash-style REST Redis (add the Upstash integration in Vercel; it sets the two env vars).

const SESSION_TTL_SECONDS = 2 * 60 * 60;

export function memoryStore(ttlMs = SESSION_TTL_SECONDS * 1000) {
  const sessions = new Map();
  let last = null;
  return {
    kind: 'memory',
    async latest() { return last; },
    async get(id, now = Date.now()) {
      const hit = sessions.get(id);
      if (!hit) return null;
      if (now - hit.at > ttlMs) { sessions.delete(id); return null; }
      return structuredClone(hit.state);
    },
    async set(id, state, now = Date.now()) {
      sessions.set(id, { at: now, state: structuredClone(state) });
      last = id;
    },
  };
}

export function upstashStore({ url, token, ttlSeconds = SESSION_TTL_SECONDS, fetchImpl = fetch }) {
  const run = async command => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(3000), // a hung store must not hold up the operator
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
      await run(['SET', 'nav:latest', id, 'EX', String(ttlSeconds)]);
    },
    async latest() {
      return (await run(['GET', 'nav:latest'])) || null;
    },
  };
}

const shared = memoryStore();

export function createStore(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return upstashStore({ url, token });
  // A fresh Vercel instance forgets everything, which would leave the operator walking with no plan.
  if (env.VERCEL && !env.NAVIGATOR_ALLOW_MEMORY_STORE) {
    throw new Error('no Redis state store is set on this deployment (add the Upstash Redis integration)');
  }
  return shared;
}
