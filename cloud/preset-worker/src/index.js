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
// ── Loader (no auth) ────────────────────────────────────────────────────────
//   Uses env.LOADER_APPS KV. Single document under key "registry".
//
//   GET    /loader/apps                -> { apps: [...] } | { apps: [] } if unset
//   PUT    /loader/apps                -> body: { apps: [...] } | 200 { ok, savedAt, count }
//
// CORS open for all origins (Fusion file:// and web).
// Body size cap: 10 MB.

const MAX_BODY_BYTES = 10 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

    // Appreciation Arts Plastiques: commits straight to GitHub (separate auth).
    const url = new URL(request.url);
    if (url.pathname.startsWith('/appreciation-arts-plastiques/')) {
      return handleArt(request, env, method, url);
    }

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
      apps: ['bspline', 'connery', 'cam-studio', 'penplotter', 'loader'],
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
        loader: {
          load: 'GET /loader/apps',
          save: 'PUT /loader/apps',
          note: 'Single document { apps: [...] }. No auth.',
        },
      },
    });
  }

  // ── Loader: single-document registry ──────────────────────────────────────
  if (path === '/loader/apps') {
    if (method === 'GET') {
      const value = await env.LOADER_APPS.get('registry');
      if (value === null) return json({ apps: [] });
      return new Response(value, { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }
    if (method === 'PUT') {
      const body = await request.text();
      if (body.length === 0)            return json({ error: 'empty body' }, 400);
      if (body.length > MAX_BODY_BYTES) return json({ error: 'body too large', maxBytes: MAX_BODY_BYTES }, 413);
      let parsed;
      try { parsed = JSON.parse(body); } catch { return json({ error: 'invalid JSON' }, 400); }
      if (!parsed || !Array.isArray(parsed.apps)) {
        return json({ error: 'expected { apps: [...] }' }, 400);
      }
      const savedAt = Date.now();
      await env.LOADER_APPS.put('registry', body, {
        metadata: { savedAt, size: body.length, count: parsed.apps.length },
      });
      return json({ ok: true, savedAt, count: parsed.apps.length });
    }
    return json({ error: 'method not allowed' }, 405);
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

// ── Appreciation Arts Plastiques (commit via GitHub) ────────────────────────
// No auth — same pattern as bspline / loader. The GITHUB_PAT lives only as a
// worker secret, never reaches the browser. Uses the Git Data API so multi-
// file commits (data.json + new image) are one atomic commit.

const ART_GH_OWNER  = 'fchabot-dxf';
const ART_GH_REPO   = 'appreciation-arts-plastiques';
const ART_GH_BRANCH = 'main';

async function handleArt(request, env, method, url) {
  // No auth on this route, matching the bspline / loader / cam-profile pattern.
  // If abuse ever shows up, add an origin check or X-API-Key gate here; the
  // GITHUB_PAT secret stays server-side regardless.
  if (!env.GITHUB_PAT) {
    return json({ error: 'GITHUB_PAT not configured on worker' }, 500);
  }

  const path = url.pathname;

  // Resolve a dataset slug to its repo file. 'main' (or none) = the original data.json.
  const datasetPath = (set) => {
    if (!set || set === 'main') return 'html/core/data.json';
    const slug = String(set).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    return slug ? `html/core/datasets/${slug}.json` : 'html/core/data.json';
  };

  // GET /appreciation-arts-plastiques/datasets → manifest of available datasets
  if (path === '/appreciation-arts-plastiques/datasets' && method === 'GET') {
    try {
      const raw = await ghReadFile(env.GITHUB_PAT, 'html/core/datasets/index.json');
      return new Response(raw, { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    } catch (e) {
      return json([{ slug: 'main', title: 'Collection principale' }]);
    }
  }

  // GET /appreciation-arts-plastiques/data?set=<slug> → that dataset's JSON (live from GitHub main)
  if (path === '/appreciation-arts-plastiques/data' && method === 'GET') {
    try {
      const raw = await ghReadFile(env.GITHUB_PAT, datasetPath(url.searchParams.get('set')));
      return new Response(raw, { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    } catch (e) {
      // A not-yet-created dataset reads as an empty collection.
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
    }
  }

  // POST /appreciation-arts-plastiques/commit
  // Body: { dataJson?: <stringified JSON>, set?: <slug>, manifest?: <stringified JSON>, image?: { name, base64 }, message? }
  if (path === '/appreciation-arts-plastiques/commit' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }

    const files = [];
    if (typeof body.dataJson === 'string') {
      try { JSON.parse(body.dataJson); } catch { return json({ error: 'dataJson must be valid JSON' }, 400); }
      files.push({ path: datasetPath(body.set), content: body.dataJson });
    }
    if (typeof body.manifest === 'string') {
      try { JSON.parse(body.manifest); } catch { return json({ error: 'manifest must be valid JSON' }, 400); }
      files.push({ path: 'html/core/datasets/index.json', content: body.manifest });
    }

    if (body.image) {
      const { name, base64 } = body.image;
      if (typeof name !== 'string' || typeof base64 !== 'string') {
        return json({ error: 'image.name and image.base64 required' }, 400);
      }
      if (!/^[A-Za-z0-9._-]+\.(png|jpg|jpeg|webp|gif)$/i.test(name)) {
        return json({ error: 'image.name must be a simple filename ending in .png/.jpg/.jpeg/.webp/.gif' }, 400);
      }
      files.push({ path: `html/assets/images/${name}`, contentBase64: base64 });
    }

    if (!files.length) return json({ error: 'nothing to commit (dataJson, manifest, or image required)' }, 400);
    const message = (typeof body.message === 'string' && body.message.trim())
      ? body.message.trim().slice(0, 200)
      : (body.image ? `tracer: add ${body.image.name}` : ('tracer: update ' + (body.set || 'main')));

    try {
      const result = await ghCommitFiles(env.GITHUB_PAT, message, files);
      return json({ ok: true, ...result, files: files.map(f => f.path) });
    } catch (e) {
      return json({ error: 'github commit failed', detail: String(e.message || e) }, 502);
    }
  }

  // GET /appreciation-arts-plastiques/freesound-search?q=...&page=...
  // Proxies Freesound search through the worker so the API key stays server-side.
  // Filtered to Creative Commons 0 (public domain) — no attribution required.
  if (path === '/appreciation-arts-plastiques/freesound-search' && method === 'GET') {
    if (!env.FREESOUND_API_KEY) return json({ error: 'FREESOUND_API_KEY not configured on worker' }, 500);
    const q = url.searchParams.get('q');
    if (!q) return json({ error: 'q (query) required' }, 400);
    const page = url.searchParams.get('page') || '1';

    const fsUrl = new URL('https://freesound.org/apiv2/search/text/');
    fsUrl.searchParams.set('query', q);
    fsUrl.searchParams.set('page', page);
    fsUrl.searchParams.set('page_size', '20');
    fsUrl.searchParams.set('filter', 'license:"Creative Commons 0"');
    fsUrl.searchParams.set('fields', 'id,name,previews,duration,license,username');
    fsUrl.searchParams.set('token', env.FREESOUND_API_KEY);

    try {
      const r = await fetch(fsUrl.toString());
      if (!r.ok) return json({ error: 'freesound search failed', status: r.status, body: (await r.text()).slice(0, 500) }, 502);
      const data = await r.json();
      return json(data);
    } catch (e) {
      return json({ error: 'freesound fetch error', detail: String(e.message || e) }, 502);
    }
  }

  // POST /appreciation-arts-plastiques/sound-import  { freesound_id }
  // Fetches the high-quality preview mp3 from Freesound and commits it to
  // html/assets/sounds/{id}-{slug}.mp3 via the Git Data API. Returns the
  // sound_path the tracer should set on the concept (and the commit SHA).
  if (path === '/appreciation-arts-plastiques/sound-import' && method === 'POST') {
    if (!env.FREESOUND_API_KEY) return json({ error: 'FREESOUND_API_KEY not configured on worker' }, 500);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
    const id = body.freesound_id;
    if (!id || !/^\d+$/.test(String(id))) return json({ error: 'freesound_id (numeric) required' }, 400);

    try {
      // 1. Sound details (to get the preview URL + name for the filename)
      const detailsUrl = `https://freesound.org/apiv2/sounds/${id}/?fields=id,name,previews,license,username&token=${env.FREESOUND_API_KEY}`;
      const dr = await fetch(detailsUrl);
      if (!dr.ok) return json({ error: 'freesound details failed', status: dr.status }, 502);
      const details = await dr.json();

      const previewUrl = details.previews && (details.previews['preview-hq-mp3'] || details.previews['preview-lq-mp3']);
      if (!previewUrl) return json({ error: 'no preview available' }, 502);

      // 2. Fetch the audio bytes
      const ar = await fetch(previewUrl);
      if (!ar.ok) return json({ error: 'preview fetch failed', status: ar.status }, 502);
      const audioBytes = await ar.arrayBuffer();
      const base64 = arrayBufferToBase64(audioBytes);

      // 3. Slugified filename
      const slug = String(details.name || 'sound')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'sound';
      const filename = `${id}-${slug}.mp3`;
      const targetPath = `html/assets/sounds/${filename}`;

      // 4. Commit
      const result = await ghCommitFiles(
        env.GITHUB_PAT,
        `tracer: import sound "${details.name}" (Freesound #${id})`,
        [{ path: targetPath, contentBase64: base64 }],
      );

      return json({
        ok: true,
        commit: result.commit,
        filename,
        sound_path: `assets/sounds/${filename}`,
        attribution: details.username,
        name: details.name,
      });
    } catch (e) {
      return json({ error: 'sound import failed', detail: String(e.message || e) }, 502);
    }
  }

  return json({ error: 'not found', path }, 404);
}

// Convert an ArrayBuffer of binary data to a base64 string (no btoa newlines).
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

// Read a file from the GitHub repo at the configured branch (returns raw text).
async function ghReadFile(pat, filePath) {
  const u = `https://api.github.com/repos/${ART_GH_OWNER}/${ART_GH_REPO}/contents/${filePath}?ref=${ART_GH_BRANCH}`;
  const r = await fetch(u, {
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github.raw',
      'User-Agent': 'projects-dansemur-worker',
    },
  });
  if (!r.ok) throw new Error(`GET ${filePath}: ${r.status} ${await r.text()}`);
  return await r.text();
}

// Commit multiple files in a single commit via the Git Data API.
// files: [{ path, content? (utf8 string), contentBase64? }]
async function ghCommitFiles(pat, message, files) {
  const api = `https://api.github.com/repos/${ART_GH_OWNER}/${ART_GH_REPO}`;
  const h = {
    'Authorization': `Bearer ${pat}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'projects-dansemur-worker',
    'Content-Type': 'application/json',
  };
  const gh = async (subpath, init = {}) => {
    const r = await fetch(api + subpath, { ...init, headers: { ...h, ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`${init.method || 'GET'} ${subpath}: ${r.status} ${await r.text()}`);
    return r.json();
  };

  // 1) current HEAD of branch
  const ref = await gh(`/git/refs/heads/${ART_GH_BRANCH}`);
  const parentSha = ref.object.sha;

  // 2) tree SHA of that commit
  const parentCommit = await gh(`/git/commits/${parentSha}`);
  const baseTreeSha = parentCommit.tree.sha;

  // 3) create a blob per file (sequential — small file count)
  const treeItems = [];
  for (const f of files) {
    const body = f.contentBase64 !== undefined
      ? { content: f.contentBase64, encoding: 'base64' }
      : { content: f.content, encoding: 'utf-8' };
    const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify(body) });
    treeItems.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 4) new tree on top of the base tree
  const newTree = await gh('/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });

  // 5) new commit
  const newCommit = await gh('/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [parentSha] }),
  });

  // 6) move the branch ref to the new commit
  await gh(`/git/refs/heads/${ART_GH_BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return { commit: newCommit.sha };
}
