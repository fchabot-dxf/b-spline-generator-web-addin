// fred-projects — unified KV-backed project store for all of Fred's apps.
//
// Routing dispatches on X-API-Key header presence:
//
// ── Bspline / Connery / CAM Studio (no X-API-Key) ───────────────────────────
//   Uses env.PRESETS KV. Name-keyed storage. No authentication.
//
//   GET    /projects              -> { names: [...], items: [{name, savedAt?, size?}, ...] }
//   GET    /projects/:name        -> snapshot JSON | 404
//   PUT    /projects/:name        -> body: snapshot JSON | 200 { ok: true, name, savedAt }
//   DELETE /projects/:name        -> 200 { ok: true, name }
//   GET    /presets               -> same as /projects (legacy alias)
//   GET/PUT/DELETE /presets/:name -> same as /projects/:name (legacy alias)
//   GET    /cam-profiles          -> { names: [...], items: [...] }
//   GET/PUT/DELETE /cam-profiles/:name
//
// ── Pen Plotter (X-API-Key required) ────────────────────────────────────────
//   Uses env.PENPLOTTER KV. UUID-keyed storage. Requires API key auth.
//
//   GET    /{projects|palettes}        -> list [{ id, customMeta.name, savedAt }]
//   POST   /{projects|palettes}        -> create  body: { name, project|palette }
//   GET    /{projects|palettes}/:id    -> fetch one
//   PUT    /{projects|palettes}/:id    -> overwrite or rename
//   DELETE /{projects|palettes}/:id    -> delete
//
// CORS open for all origins (Fusion file:// and web).
// Body size cap: 10 MB.

const MAX_BODY_BYTES = 10 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

    // Dispatch: penplotter routes require the API key, bspline routes don't.
    if (request.headers.get('X-API-Key')) {
      return handlePenplotter(request, env, method);
    }
    return handleBspline(request, env, method);
  },
};

// ── Penplotter handler ───────────────────────────────────────────────────────

function ppJson(d, s = 200) {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
const ppUnauthorized = () => new Response('unauthorized', { status: 401, headers: corsHeaders() });
const ppNotFound     = () => new Response('not found',    { status: 404, headers: corsHeaders() });

async function handlePenplotter(request, env, method) {
  const key = request.headers.get('X-API-Key');
  if (!env.API_KEY || key !== env.API_KEY) return ppUnauthorized();

  const url   = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const [kind, id] = parts;
  if (kind !== 'palettes' && kind !== 'projects') return ppNotFound();

  try {
    if (!id) {
      if (method === 'GET')  return ppJson(await ppList(env.PENPLOTTER, kind));
      if (method === 'POST') return ppJson(await ppCreate(env.PENPLOTTER, kind, await request.json()));
    } else {
      if (method === 'GET') {
        const data = await ppGet(env.PENPLOTTER, kind, id);
        return data ? ppJson(data) : ppNotFound();
      }
      if (method === 'PUT') {
        const r = await ppUpdate(env.PENPLOTTER, kind, id, await request.json());
        return r ? ppJson(r) : ppNotFound();
      }
      if (method === 'DELETE') {
        await env.PENPLOTTER.delete(kind + '/' + id);
        return ppJson({ ok: true });
      }
    }
  } catch (e) {
    return ppJson({ error: e.message }, 500);
  }
  return ppNotFound();
}

async function ppList(kv, kind) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: kind + '/', cursor, limit: 1000 });
    for (const k of page.keys) {
      const meta = k.metadata || {};
      out.push({ id: k.name.slice(kind.length + 1), customMeta: { name: meta.name || '' }, savedAt: meta.savedAt || null });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

async function ppCreate(kv, kind, body) {
  const id   = crypto.randomUUID();
  const meta = { name: String(body.name || 'untitled').slice(0, 100), savedAt: new Date().toISOString() };
  await kv.put(kind + '/' + id, JSON.stringify(body), { metadata: meta });
  return { id, name: meta.name };
}

async function ppUpdate(kv, kind, id, body) {
  const existing = await kv.getWithMetadata(kind + '/' + id);
  if (existing.value == null) return null;
  const oldMeta  = existing.metadata || {};
  const dataKey  = kind === 'palettes' ? 'palette' : 'project';
  const meta     = { name: String(body.name || oldMeta.name || 'untitled').slice(0, 100), savedAt: new Date().toISOString() };
  const value    = body[dataKey] !== undefined ? JSON.stringify(body) : existing.value;
  await kv.put(kind + '/' + id, value, { metadata: meta });
  return { id, name: meta.name };
}

async function ppGet(kv, kind, id) {
  const raw = await kv.get(kind + '/' + id);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ── Bspline / Connery / CAM handler ─────────────────────────────────────────

async function handleBspline(request, env, method) {
  const url  = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // Health check
  if (path === '/' && method === 'GET') {
    return json({
      service: 'projects-dansemur',
      apps: ['bspline', 'connery', 'cam-studio', 'penplotter'],
      endpoints: {
        bspline: {
          list:        'GET /projects',
          load:        'GET /projects/:name',
          save:        'PUT /projects/:name',
          remove:      'DELETE /projects/:name',
          camProfiles: 'GET|PUT|DELETE /cam-profiles/:name',
          note:        'No auth required.',
        },
        penplotter: {
          list:   'GET /{projects|palettes}',
          create: 'POST /{projects|palettes}',
          load:   'GET /{projects|palettes}/:id',
          update: 'PUT /{projects|palettes}/:id',
          remove: 'DELETE /{projects|palettes}/:id',
          note:   'Requires X-API-Key header.',
        },
      },
    });
  }

  // List: GET /projects or /presets
  if ((path === '/projects' || path === '/presets') && method === 'GET') {
    try {
      const list  = await env.PRESETS.list();
      const items = list.keys.map((k) => ({ name: k.name, ...(k.metadata || {}) }));
      return json({ names: items.map((i) => i.name), items });
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
      return new Response(value, { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }
    if (method === 'PUT') {
      const body = await request.text();
      if (body.length === 0)            return json({ error: 'empty body' }, 400);
      if (body.length > MAX_BODY_BYTES) return json({ error: 'body too large', maxBytes: MAX_BODY_BYTES }, 413);
      try { JSON.parse(body); } catch   { return json({ error: 'invalid JSON' }, 400); }
      const savedAt = Date.now();
      await env.PRESETS.put(name, body, { metadata: { savedAt, size: body.length } });
      return json({ ok: true, name, savedAt });
    }
    if (method === 'DELETE') {
      await env.PRESETS.delete(name);
      return json({ ok: true, name });
    }
    return json({ error: 'method not allowed' }, 405);
  }

  // CAM profiles (/cam-profiles)
  const CAM_PREFIX = 'cam-profile::';

  if (path === '/cam-profiles' && method === 'GET') {
    try {
      const list  = await env.PRESETS.list({ prefix: CAM_PREFIX });
      const items = list.keys.map((k) => ({ name: k.name.slice(CAM_PREFIX.length), ...(k.metadata || {}) }));
      return json({ names: items.map((i) => i.name), items });
    } catch (e) {
      return json({ error: 'list failed', detail: String(e) }, 500);
    }
  }

  const cp = path.match(/^\/cam-profiles\/([^/]+)$/);
  if (cp) {
    const name = decodeURIComponent(cp[1]);
    if (!name)             return json({ error: 'name required' }, 400);
    if (name.length > 200) return json({ error: 'name too long' }, 400);
    const key = CAM_PREFIX + name;

    if (method === 'GET') {
      const value = await env.PRESETS.get(key);
      if (value === null) return json({ error: 'not found' }, 404);
      return new Response(value, { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }
    if (method === 'PUT') {
      const body = await request.text();
      if (body.length === 0)            return json({ error: 'empty body' }, 400);
      if (body.length > MAX_BODY_BYTES) return json({ error: 'body too large', maxBytes: MAX_BODY_BYTES }, 413);
      try { JSON.parse(body); } catch   { return json({ error: 'invalid JSON' }, 400); }
      const savedAt = Date.now();
      await env.PRESETS.put(key, body, { metadata: { savedAt, size: body.length } });
      return json({ ok: true, name, savedAt });
    }
    if (method === 'DELETE') {
      await env.PRESETS.delete(key);
      return json({ ok: true, name });
    }
    return json({ error: 'method not allowed' }, 405);
  }

  return json({ error: 'not found', path }, 404);
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age':       '86400',
  };
}
