// F35 item 34 (Fred: "a simple enter password to edit is fine, save it to cache so I never get asked").
// READS stay open; a WRITE to the B-spline projects store needs the password, sent as
// `Authorization: Bearer <password>` and checked against the worker secret EDIT_PASSWORD (set by Fred with
// `npx wrangler secret put EDIT_PASSWORD` in this folder -- the value never lives in the repo).
//
// What the gate covers is DECLARED here, nothing else is touched: the bus tracker, the page views, the loader,
// the CAM profiles, the pen plotter (its own X-API-Key) and the art commits keep their own rules.

export const EDIT_GATE = Object.freeze({
  secret: 'EDIT_PASSWORD',
  paths: /^\/(projects|presets)(\/|$)/,
  methods: Object.freeze(['PUT', 'DELETE', 'POST']),
  // Mathieu Connery's app (APPS/MathieuConnery, connery-project-manager.js) keeps its projects in the same
  // store under this prefix and has no password: its writes stay open, and they can never touch a B-spline key.
  exemptNamePrefixes: Object.freeze(['connery:']),
  // the password may be short: failed writes are rate-limited per IP
  failLimit: 3,
  failWindowSec: 600,
  failKeyPrefix: 'editfail::', // in the PRESETS store; the project list hides these keys
});

/** The item name a /projects/:name or /presets/:name path writes (null for the collection itself). */
function nameOf(path) {
  const m = path.match(/^\/(projects|presets)\/([^/]+)$/);
  if (!m) return null;
  try { return decodeURIComponent(m[2]); } catch { return m[2]; }
}

/** Does EDIT_GATE cover this request? */
export function gateApplies(method, path) {
  if (!EDIT_GATE.methods.includes(method) || !EDIT_GATE.paths.test(path)) return false;
  const name = nameOf(path);
  return !(name && EDIT_GATE.exemptNamePrefixes.some((p) => name.startsWith(p)));
}

/** A failed-write counter key is not a project. */
export const isGateKey = (key) => key.startsWith(EDIT_GATE.failKeyPrefix);

async function sameSecret(a, b) {
  // compare digests, so the time taken never depends on how much of the guess was right
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(da), y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * null = the request may go on; otherwise the Response to send back:
 *   503 the secret is not set (writes stay closed until Fred sets it), 429 too many failed writes from this IP,
 *   401 { error: 'password required' } (none sent) / { error: 'wrong password' } (counted).
 * `json(obj, status)` = the worker's own response helper (CORS headers).
 */
export async function checkEditGate(request, env, method, path, json) {
  if (!gateApplies(method, path)) return null;
  const secret = env[EDIT_GATE.secret];
  if (!secret) return json({ error: 'edit password not configured' }, 503);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const failKey = EDIT_GATE.failKeyPrefix + ip;
  const fails = Number(await env.PRESETS.get(failKey)) || 0;
  if (fails >= EDIT_GATE.failLimit) return json({ error: 'too many wrong passwords', retryAfterSec: EDIT_GATE.failWindowSec }, 429);
  const auth = request.headers.get('Authorization') || '';
  const given = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (!given) return json({ error: 'password required' }, 401);
  if (await sameSecret(given, secret)) return null;
  await env.PRESETS.put(failKey, String(fails + 1), { expirationTtl: EDIT_GATE.failWindowSec });
  return json({ error: 'wrong password' }, 401);
}
