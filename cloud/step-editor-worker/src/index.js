// step-editor file Worker — KV-backed STEP file store.
//
// SELF-CONTAINED: this Worker does not share code with cloud/preset-worker.
// Yes, the wire shape is similar — but copying is the policy here so the
// two services can evolve independently.
//
// API:
//   GET    /files              -> { items: [{name, savedAt?, size?}, ...] }
//   GET    /files/:name        -> raw .stp text  |  404
//   PUT    /files/:name        -> body: .stp text  ->  { ok, name, savedAt }
//   DELETE /files/:name        -> { ok, name }
//
// Per-key metadata stored on PUT: { savedAt: <epoch-ms>, size: <bytes> }
// surfaced via list() so the UI can render dates without per-key fetches.
//
// Auth: none. Single-user public deploy.
// CORS: open so the palette can call from a Fusion file:// origin or
//       from step-editor.pages.dev.
// Body cap: 25 MB (KV per-value limit). STEP files can be hefty for
//           tessellated bodies, so we set this higher than preset-worker.

const MAX_BODY_BYTES = 25 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();
    const path   = url.pathname.replace(/\/+$/, '') || '/';

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // List
    if (path === '/files' && method === 'GET') {
      try {
        const list  = await env.STEP_FILES.list();
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

    // Single item: /files/:name
    const m = path.match(/^\/files\/([^/]+)$/);
    if (m) {
      const name = decodeURIComponent(m[1]);
      if (!name)             return json({ error: 'name required' }, 400);
      if (name.length > 200) return json({ error: 'name too long' }, 400);

      if (method === 'GET') {
        const value = await env.STEP_FILES.get(name);
        if (value === null) return json({ error: 'not found' }, 404);
        return new Response(value, {
          status:  200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders() },
        });
      }

      if (method === 'PUT') {
        const body = await request.text();
        if (body.length === 0)            return json({ error: 'empty body' }, 400);
        if (body.length > MAX_BODY_BYTES) return json({ error: 'body too large', maxBytes: MAX_BODY_BYTES }, 413);
        // Light validation: STEP files always start with ISO-10303-21;
        if (!/^\s*ISO-10303-21\s*;/.test(body)) {
          return json({ error: 'not a STEP file (missing ISO-10303-21 header)' }, 400);
        }
        const savedAt = Date.now();
        await env.STEP_FILES.put(name, body, {
          metadata: { savedAt, size: body.length },
        });
        return json({ ok: true, name, savedAt });
      }

      if (method === 'DELETE') {
        await env.STEP_FILES.delete(name);
        return json({ ok: true, name });
      }

      return json({ error: 'method not allowed' }, 405);
    }

    // Health check
    if (path === '/' && method === 'GET') {
      return json({
        service:   'step-editor-files',
        endpoints: {
          list:   'GET /files',
          load:   'GET /files/:name',
          save:   'PUT /files/:name',
          remove: 'DELETE /files/:name',
        },
        maxBytes: MAX_BODY_BYTES,
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
