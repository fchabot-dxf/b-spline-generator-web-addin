// B-Spline project Worker — KV-backed project store.
//
// Primary API ("projects" namespace):
//   GET    /projects              -> { names: [...], items: [{name, savedAt?, size?}, ...] }
//   GET    /projects/:name        -> snapshot JSON | 404
//   PUT    /projects/:name        -> body: snapshot JSON | 200 { ok: true, name, savedAt }
//   DELETE /projects/:name        -> 200 { ok: true, name }
//
// Legacy aliases (same KV, same keys — backwards compat):
//   GET    /presets, GET/PUT/DELETE /presets/:name
//
// CAM profile API (isolated with 'cam-profile::' key prefix):
//   GET    /cam-profiles          -> { names: [...], items: [{name, savedAt?, size?}, ...] }
//   GET    /cam-profiles/:name    -> profile JSON | 404
//   PUT    /cam-profiles/:name    -> body: profile JSON | 200 { ok: true, name, savedAt }
//   DELETE /cam-profiles/:name    -> 200 { ok: true, name }
//
// CAM profile JSON schema (stored as-is, UI owns the shape):
//   { stockMode, flipY, clearanceHeight, retractHeight, boxPoint, operations: [...] }
//   Each operation: { type, tool, feedrate, spindleSpeed, stepdown, stepover, stockLeave, rampType }
//
// Per-key metadata stored on PUT: { savedAt: <epoch-ms>, size: <bytes> }
// Surfaced via list() so the UI can render dates without a per-key fetch.
// Old keys (written before metadata was wired in) simply lack savedAt/size.
//
// No authentication. Single-user public deploy.
// CORS open so the palette can call from a Fusion file:// origin or any web origin.
// Body size cap: 10 MB (KV per-value limit is 25 MB).

const MAX_BODY_BYTES = 10 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();
    const path   = url.pathname.replace(/\/+$/, '') || '/';

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // List: GET /projects or /presets
    if ((path === '/projects' || path === '/presets') && method === 'GET') {
      try {
        const list  = await env.PRESETS.list();
        const items = list.keys.map((k) => ({
          name: k.name,
          ...(k.metadata || {}),
        }));
        return json({
          names: items.map((i) => i.name),
          items,
        });
      } catch (e) {
        return json({ error: 'list failed', detail: String(e) }, 500);
      }
    }

    // Single item: /projects/:name or /presets/:name
    const m = path.match(/^\/(projects|presets)\/([^/]+)$/);
    if (m) {
      const name = decodeURIComponent(m[2]);
      if (!name)             return json({ error: 'name required' }, 400);
      if (name.length > 200) return json({ error: 'name too long' }, 400);

      if (method === 'GET') {
        const value = await env.PRESETS.get(name);
        if (value === null) return json({ error: 'not found' }, 404);
        return new Response(value, {
          status:  200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }

      if (method === 'PUT') {
        const body = await request.text();
        if (body.length === 0)            return json({ error: 'empty body' }, 400);
        if (body.length > MAX_BODY_BYTES) return json({ error: 'body too large', maxBytes: MAX_BODY_BYTES }, 413);
        try { JSON.parse(body); } catch   { return json({ error: 'invalid JSON' }, 400); }
        // Store savedAt/size as KV metadata. KV's list endpoint surfaces
        // metadata alongside names without an extra round-trip per project,
        // which is what the project manager UI needs to render dates.
        const savedAt = Date.now();
        await env.PRESETS.put(name, body, {
          metadata: { savedAt, size: body.length },
        });
        return json({ ok: true, name, savedAt });
      }

      if (method === 'DELETE') {
        await env.PRESETS.delete(name);
        return json({ ok: true, name });
      }

      return json({ error: 'method not allowed' }, 405);
    }

    // ── CAM profiles (/cam-profiles) ────────────────────────────────────────
    const CAM_PREFIX = 'cam-profile::';

    // List: GET /cam-profiles
    if (path === '/cam-profiles' && method === 'GET') {
      try {
        const list  = await env.PRESETS.list({ prefix: CAM_PREFIX });
        const items = list.keys.map((k) => ({
          name: k.name.slice(CAM_PREFIX.length),
          ...(k.metadata || {}),
        }));
        return json({
          names: items.map((i) => i.name),
          items,
        });
      } catch (e) {
        return json({ error: 'list failed', detail: String(e) }, 500);
      }
    }

    // Single profile: /cam-profiles/:name
    const cp = path.match(/^\/cam-profiles\/([^/]+)$/);
    if (cp) {
      const name = decodeURIComponent(cp[1]);
      if (!name)             return json({ error: 'name required' }, 400);
      if (name.length > 200) return json({ error: 'name too long' }, 400);
      const key = CAM_PREFIX + name;

      if (method === 'GET') {
        const value = await env.PRESETS.get(key);
        if (value === null) return json({ error: 'not found' }, 404);
        return new Response(value, {
          status:  200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
      }

      if (method === 'PUT') {
        const body = await request.text();
        if (body.length === 0)            return json({ error: 'empty body' }, 400);
        if (body.length > MAX_BODY_BYTES) return json({ error: 'body too large', maxBytes: MAX_BODY_BYTES }, 413);
        try { JSON.parse(body); } catch   { return json({ error: 'invalid JSON' }, 400); }
        const savedAt = Date.now();
        await env.PRESETS.put(key, body, {
          metadata: { savedAt, size: body.length },
        });
        return json({ ok: true, name, savedAt });
      }

      if (method === 'DELETE') {
        await env.PRESETS.delete(key);
        return json({ ok: true, name });
      }

      return json({ error: 'method not allowed' }, 405);
    }

    // Health check
    if (path === '/' && method === 'GET') {
      return json({
        service:   'bspline-projects',
        endpoints: {
          list:           'GET /projects',
          load:           'GET /projects/:name',
          save:           'PUT /projects/:name',
          remove:         'DELETE /projects/:name',
          camProfiles:    'GET /cam-profiles',
          loadProfile:    'GET /cam-profiles/:name',
          saveProfile:    'PUT /cam-profiles/:name',
          removeProfile:  'DELETE /cam-profiles/:name',
        },
      });
    }

    return json({ error: 'not found', path }, 404);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}
