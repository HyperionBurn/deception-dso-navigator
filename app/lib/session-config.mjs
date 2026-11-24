import { createHash, timingSafeEqual } from 'node:crypto';

const DEFAULT_AGENT_ID = 'agent_0101m86hthvjfm6vqeymg81may5e';
// Printable ASCII except comma, which also separates repeated HTTP headers.
const secretFormat = /^[\x21-\x2b\x2d-\x7e]{1,256}$/u;
const digest = value => createHash('sha256').update(value, 'utf16le').digest();
const safeEqual = (a, b) => a.length === b.length && timingSafeEqual(a, b);

export function validAccessCode(value) {
  return typeof value === 'string' && value.length <= 256 && value.trim().length >= 4;
}

/** Timing-safe, trim + case-insensitive access-code comparison. */
export function accessCodeOk(supplied, accessCode) {
  return validAccessCode(supplied) && typeof accessCode === 'string' && accessCode.trim() &&
    safeEqual(digest(supplied.trim().toLowerCase()), digest(accessCode.trim().toLowerCase()));
}

/** Timing-safe shared-secret comparison (e.g. the route tool key). */
export function secretOk(supplied, secret) {
  return typeof supplied === 'string' && typeof secret === 'string' &&
    secretFormat.test(supplied) && secretFormat.test(secret) &&
    safeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(secret).digest());
}

/** The request's Origin matches its host after Vercel's TLS termination.
 * `allowMissing` tolerates an absent Origin (browsers omit it on GET fetches). */
export function sameOrigin(request, { allowMissing = false } = {}) {
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
  const origin = request.headers.get('origin');
  if (origin === null) return allowMissing;
  return origin === new URL(`${scheme}://${host || target.host}`).origin;
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
