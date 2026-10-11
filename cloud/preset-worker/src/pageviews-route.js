/**
 * Page-view counter — server side.
 *
 * Drop-in route handler for Fred's shared worker (projects-dansemur). It is a
 * self-contained module: copy this file next to the worker's src/index.js and
 * import it, or paste the body into handleBspline. See cloud/README.md.
 *
 * Routes (all under /views/, which collides with nothing existing):
 *   POST /views/:site/:page   record one hit   -> { counted, reason, views, uniques }
 *   GET  /views/:site         all pages        -> { site, pages: [...], totals, dropped }
 *   GET  /views/:site/:page   one page         -> { page, views, uniques, views90, ... }
 *
 * Storage: D1 (binding PAGE_VIEWS_DB, schema in migrations/0001_page_views.sql)
 *   pv_pages (site, page)          running views / uniques / first_seen / last_seen
 *   pv_days  (site, page, day)     daily buckets, DAY_RETENTION days
 *   pv_seen  (visitor)             dedupe hash, purged once older than today
 *   pv_drops (site, day, reason)   what got excluded, and why
 * Until 2026-10-11 this lived in KV (2 writes per counted view + 1 per drop, against the free tier's shared
 * 1,000 writes a day, plus list() on every stats read). Page views now do ZERO KV writes and ZERO KV list()
 * after the one-time legacy fold below.
 *
 * Legacy KV (binding PAGE_VIEWS, READ-ONLY now): pv::stats::<site>::<page> and pv::drops::<site>::<date>
 * are folded into D1 ONCE, by the first /views request after deploy (foldLegacyKv): 2 list() sequences +
 * one get per key, additive upserts, and the 'done' mark in the same D1 transaction. A failed fold is
 * retried at most once per LEGACY_RETRY_MS. pv::seen markers are not carried over (they expire in 48 h).
 *
 * Privacy: no IP and no user-agent is ever stored. The dedupe marker is a
 * SHA-256 of (date + IP + UA + page), so it rotates every midnight UTC and
 * cannot be walked back to a visitor.
 */

const DAY_RETENTION = 120;                 // daily buckets kept (>= the 90-day window)
const MAX_BODY_BYTES = 4096;               // a hit payload is a few hundred bytes
export const LEGACY_KEY = 'legacy-kv-import';  // pv_meta row of the one-time KV fold
export const LEGACY_RETRY_MS = 3600 * 1000;    // a claimed-but-unfinished fold is retaken after this

// Origins allowed to report hits. Everything else — a preview deploy, someone
// else's site embedding the beacon, curl with no Origin — is dropped.
const ALLOWED_ORIGINS = [
  'https://triangle-frame-calc.pages.dev',
];

// Bots, crawlers, headless browsers, HTTP clients, and AI/agent fetchers.
// This is the server-side twin of isAutomated() in shared/analytics/pageViews.js:
// the client refuses to send, and the worker refuses to count even if it does.
const BOT_UA = new RegExp([
  'bot\\b', 'crawler', 'crawling', 'spider', 'slurp', 'scrap(er|ing)',
  'headless', 'playwright', 'puppeteer', 'selenium', 'phantomjs', 'webdriver',
  'lighthouse', 'pagespeed', 'pingdom', 'uptimerobot', 'monitoring',
  'curl/', 'wget/', 'python-requests', 'python-urllib', 'node-fetch', 'axios/',
  'go-http-client', 'okhttp', 'java/', 'libwww-perl', 'httpclient', 'postman',
  'claude', 'anthropic', 'gptbot', 'chatgpt', 'oai-searchbot', 'openai',
  'perplexity', 'ccbot', 'ai2bot', 'bytespider', 'diffbot', 'meta-external',
  'ahrefs', 'semrush', 'dataforseo', 'mj12', 'dotbot', 'petalbot', 'yandex',
].join('|'), 'i');

const today = () => new Date().toISOString().slice(0, 10);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders() },
  });
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Empty stats document. */
function blankStats() {
  return { views: 0, uniques: 0, firstSeen: null, lastSeen: null, days: {} };
}

/** 'YYYY-MM-DD' of `n` days ago (UTC): day buckets / drops older than DAY_RETENTION are purged and never served. */
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/** Sums the day buckets inside a trailing window. */
function windowTotals(days, windowDays) {
  const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
  let views = 0, uniques = 0;
  for (const [date, bucket] of Object.entries(days || {})) {
    if (date < cutoff) continue;
    views += bucket.v || 0;
    uniques += bucket.u || 0;
  }
  return { views, uniques };
}

/** Public shape for one page. */
function summarize(page, stats) {
  const d90 = windowTotals(stats.days, 90);
  const d30 = windowTotals(stats.days, 30);
  return {
    page,
    views: stats.views || 0,
    uniques: stats.uniques || 0,
    views90: d90.views,
    uniques90: d90.uniques,
    views30: d30.views,
    uniques30: d30.uniques,
    firstSeen: stats.firstSeen || null,
    lastSeen: stats.lastSeen || null,
    days: stats.days || {},
  };
}

/** Best-effort tally of what we refused to count, so exclusions stay visible. */
async function recordDrop(db, site, reason) {
  try {
    await db.prepare(
      `INSERT INTO pv_drops (site, day, reason, n) VALUES (?, ?, ?, 1)
       ON CONFLICT (site, day, reason) DO UPDATE SET n = n + 1`,
    ).bind(site, today(), reason).run();
  } catch { /* a dropped hit is never worth a 500 */ }
}

/** One page's running totals (0/0 when it was never counted). */
async function pageTotals(db, site, page) {
  const row = await db.prepare('SELECT views, uniques FROM pv_pages WHERE site = ? AND page = ?').bind(site, page).first();
  return { views: row ? row.views : 0, uniques: row ? row.uniques : 0 };
}

/**
 * Stats documents in the legacy KV shape ({ views, uniques, firstSeen, lastSeen, days:{date:{v,u}} }), keyed by
 * page, for one site (or one page of it). Two D1 reads in one round trip.
 */
async function readStats(db, site, page) {
  const one = page !== undefined;
  const [pages, days] = await db.batch([
    db.prepare(`SELECT page, views, uniques, first_seen, last_seen FROM pv_pages WHERE site = ?${one ? ' AND page = ?' : ''} ORDER BY page`)
      .bind(...(one ? [site, page] : [site])),
    db.prepare(`SELECT page, day, views, uniques FROM pv_days WHERE site = ?${one ? ' AND page = ?' : ''} AND day >= ? ORDER BY page, day`)
      .bind(...(one ? [site, page] : [site]), daysAgo(DAY_RETENTION)),
  ]);
  const out = new Map();
  for (const r of pages.results) {
    out.set(r.page, { views: r.views, uniques: r.uniques, firstSeen: r.first_seen, lastSeen: r.last_seen, days: {} });
  }
  for (const r of days.results) {
    const stats = out.get(r.page);
    if (stats) stats.days[r.day] = { v: r.views, u: r.uniques };
  }
  return out;
}

// ── One-time fold of the legacy KV counters into D1 ─────────────────────────

const folded = new WeakSet();   // D1 bindings already seen 'done' in this isolate: no further check

async function listAll(kv, prefix) {
  const names = [];
  let cursor;
  do {
    const page = await kv.list(cursor ? { prefix, cursor } : { prefix });
    for (const k of page.keys) names.push(k.name);
    cursor = page.list_complete === false ? page.cursor : undefined;
  } while (cursor);
  return names;
}

/** Reads every legacy pv::stats / pv::drops key (KV reads + 2 list() sequences; no KV write). */
export async function readLegacyKv(kv) {
  const keep = daysAgo(DAY_RETENTION);
  const pages = [], days = [], drops = [];
  const statsNames = await listAll(kv, 'pv::stats::');
  const dropNames = (await listAll(kv, 'pv::drops::')).filter((n) => n.slice(-10) >= keep);
  const [statsDocs, dropDocs] = await Promise.all([
    Promise.all(statsNames.map((n) => kv.get(n, 'json'))),
    Promise.all(dropNames.map((n) => kv.get(n, 'json'))),
  ]);
  statsNames.forEach((name, i) => {
    const s = statsDocs[i];
    const [site, page] = name.slice('pv::stats::'.length).split('::');
    if (!s || !site || !page) return;
    pages.push({ site, page, views: Number(s.views) || 0, uniques: Number(s.uniques) || 0, first: s.firstSeen || null, last: s.lastSeen || null });
    for (const [day, b] of Object.entries(s.days || {})) {
      if (day >= keep) days.push({ site, page, day, v: Number(b && b.v) || 0, u: Number(b && b.u) || 0 });
    }
  });
  dropNames.forEach((name, i) => {
    const rest = name.slice('pv::drops::'.length);        // <site>::<date>
    const site = rest.slice(0, -12), day = rest.slice(-10);
    for (const [reason, n] of Object.entries(dropDocs[i] || {})) drops.push({ site, day, reason, n: Number(n) || 0 });
  });
  return { pages, days, drops };
}

/**
 * Folds the legacy KV totals into D1 exactly once (additive, so hits D1 counted before the fold are kept).
 * Claim -> read KV -> one D1 batch (the three upserts + the 'done' mark, atomic). Concurrent requests see the
 * claim and skip; a fold that died or failed is retaken after LEGACY_RETRY_MS, so a persistent KV error costs
 * at most ~2 list() an hour, never one per request.
 */
export async function foldLegacyKv(env) {
  const db = env.PAGE_VIEWS_DB;
  if (folded.has(db) || !env.PAGE_VIEWS) return;
  const row = await db.prepare('SELECT value FROM pv_meta WHERE key = ?').bind(LEGACY_KEY).first();
  if (row && String(row.value).startsWith('done:')) { folded.add(db); return; }

  const now = Date.now();
  const claim = await db.prepare(
    `INSERT INTO pv_meta (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value
     WHERE pv_meta.value LIKE 'running:%' AND CAST(substr(pv_meta.value, 9) AS INTEGER) < ?`,
  ).bind(LEGACY_KEY, `running:${now}`, now - LEGACY_RETRY_MS).run();
  if (!claim.meta || !claim.meta.changes) return;      // someone else is folding (or a recent attempt failed)

  const { pages, days, drops } = await readLegacyKv(env.PAGE_VIEWS);
  const f = (field) => `json_extract(value, '$.${field}')`;
  await db.batch([
    db.prepare(
      `INSERT INTO pv_pages (site, page, views, uniques, first_seen, last_seen)
       SELECT ${f('site')}, ${f('page')}, ${f('views')}, ${f('uniques')}, ${f('first')}, ${f('last')} FROM json_each(?) WHERE true
       ON CONFLICT (site, page) DO UPDATE SET
         views = views + excluded.views,
         uniques = uniques + excluded.uniques,
         first_seen = min(COALESCE(first_seen, excluded.first_seen), COALESCE(excluded.first_seen, first_seen)),
         last_seen  = max(COALESCE(last_seen, excluded.last_seen), COALESCE(excluded.last_seen, last_seen))`,
    ).bind(JSON.stringify(pages)),
    db.prepare(
      `INSERT INTO pv_days (site, page, day, views, uniques)
       SELECT ${f('site')}, ${f('page')}, ${f('day')}, ${f('v')}, ${f('u')} FROM json_each(?) WHERE true
       ON CONFLICT (site, page, day) DO UPDATE SET views = views + excluded.views, uniques = uniques + excluded.uniques`,
    ).bind(JSON.stringify(days)),
    db.prepare(
      `INSERT INTO pv_drops (site, day, reason, n)
       SELECT ${f('site')}, ${f('day')}, ${f('reason')}, ${f('n')} FROM json_each(?) WHERE true
       ON CONFLICT (site, day, reason) DO UPDATE SET n = n + excluded.n`,
    ).bind(JSON.stringify(drops)),
    db.prepare('UPDATE pv_meta SET value = ? WHERE key = ?').bind(`done:${Date.now()}`, LEGACY_KEY),
  ]);
  folded.add(db);
}

/**
 * Server-side exclusion. Runs on headers we control, not on anything the page
 * claims about itself — a scripted browser that fakes the client checks still
 * has to get past this.
 * @returns {string|null} drop reason, or null to count
 */
function screen(request, body) {
  const origin = request.headers.get('Origin') || '';
  if (!ALLOWED_ORIGINS.includes(origin)) return 'bad-origin';

  const ua = request.headers.get('User-Agent') || '';
  if (!ua) return 'no-user-agent';
  if (BOT_UA.test(ua)) return 'bot-user-agent';

  // The client reports navigator.webdriver honestly; an automated run that
  // reached this far is still an automated run.
  if (body && body.webdriver === true) return 'webdriver';

  // A real browser always has a viewport.
  if (!body || !(body.w > 0) || !(body.h > 0)) return 'no-viewport';

  // Cloudflare's own bot score, when the zone provides one (0 = certainly bot,
  // 100 = certainly human). Absent on plans without Bot Management — then this
  // check simply doesn't fire.
  const score = request.cf && request.cf.botManagement && request.cf.botManagement.score;
  if (typeof score === 'number' && score > 0 && score <= 30) return 'cf-bot-score';

  return null;
}

async function handleRecord(request, env, site, page) {
  let body = null;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ counted: false, reason: 'body-too-large' }, 413);
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ counted: false, reason: 'invalid-json' }, 400);
  }

  const db = env.PAGE_VIEWS_DB;
  const reason = screen(request, body);
  if (reason) {
    await recordDrop(db, site, reason);
    return json({ counted: false, reason });
  }

  // Dedupe: one count per visitor, per page, per UTC day. The hash is salted
  // with the date so nothing durable about the visitor is ever stored.
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';
  const date = today();
  const visitor = await sha256Hex(`${date}|${site}|${page}|${ip}|${ua}`);

  // The insert IS the check: a second hit from the same visitor-page-day changes no row.
  const seen = await db.prepare('INSERT INTO pv_seen (visitor, day) VALUES (?, ?) ON CONFLICT (visitor) DO NOTHING')
    .bind(visitor, date).run();
  if (!seen.meta.changes) {
    await recordDrop(db, site, 'repeat-visit');
    return json({ counted: false, reason: 'repeat-visit', ...(await pageTotals(db, site, page)) });
  }

  // deduped above, so every counted hit is a unique-of-the-day. One transaction: both counters + the purges.
  const now = new Date().toISOString();
  const keep = daysAgo(DAY_RETENTION);
  const [, totals] = await db.batch([
    db.prepare(
      `INSERT INTO pv_days (site, page, day, views, uniques) VALUES (?, ?, ?, 1, 1)
       ON CONFLICT (site, page, day) DO UPDATE SET views = views + 1, uniques = uniques + 1`,
    ).bind(site, page, date),
    db.prepare(
      `INSERT INTO pv_pages (site, page, views, uniques, first_seen, last_seen) VALUES (?, ?, 1, 1, ?, ?)
       ON CONFLICT (site, page) DO UPDATE SET views = views + 1, uniques = uniques + 1,
         first_seen = COALESCE(first_seen, excluded.first_seen), last_seen = excluded.last_seen
       RETURNING views, uniques`,
    ).bind(site, page, now, now),
    db.prepare('DELETE FROM pv_seen WHERE day < ?').bind(date),
    db.prepare('DELETE FROM pv_days WHERE day < ?').bind(keep),
    db.prepare('DELETE FROM pv_drops WHERE day < ?').bind(keep),
  ]);
  const row = totals.results[0];
  return json({ counted: true, reason: 'ok', views: row.views, uniques: row.uniques });
}

async function handleSite(env, site) {
  const db = env.PAGE_VIEWS_DB;
  const pages = [];
  for (const [page, stats] of await readStats(db, site)) pages.push(summarize(page, stats));
  pages.sort((a, b) => b.views - a.views);

  const totals = pages.reduce((acc, p) => ({
    views: acc.views + p.views,
    uniques: acc.uniques + p.uniques,
    views90: acc.views90 + p.views90,
    uniques90: acc.uniques90 + p.uniques90,
    views30: acc.views30 + p.views30,
    uniques30: acc.uniques30 + p.uniques30,
  }), { views: 0, uniques: 0, views90: 0, uniques90: 0, views30: 0, uniques30: 0 });

  // Last 90 days of exclusions, so the dev/agent traffic that was filtered out
  // is auditable rather than invisible.
  const dropped = {};
  const drops = await db.prepare('SELECT reason, SUM(n) AS n FROM pv_drops WHERE site = ? AND day >= ? GROUP BY reason')
    .bind(site, daysAgo(90)).all();
  for (const r of drops.results) dropped[r.reason] = r.n;

  return json({ site, generatedAt: new Date().toISOString(), window: 90, pages, totals, dropped });
}

/**
 * Entry point. Returns null when the path isn't ours, so the caller can fall
 * through to its existing routes.
 * @param {Request} request
 * @param {{PAGE_VIEWS_DB: D1Database, PAGE_VIEWS?: KVNamespace}} env  PAGE_VIEWS = legacy, read once by foldLegacyKv
 * @param {URL} url
 * @returns {Promise<Response|null>}
 */
export async function handlePageViews(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean);   // ['views', site, page?]
  if (parts[0] !== 'views') return null;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (!env.PAGE_VIEWS_DB) return json({ error: 'PAGE_VIEWS_DB D1 binding missing' }, 500);

  const [, site, page] = parts;
  if (!site || !SLUG.test(site)) return json({ error: 'bad site' }, 400);
  if (page !== undefined && !SLUG.test(page)) return json({ error: 'bad page' }, 400);

  if (request.method === 'POST' || request.method === 'GET') {
    try { await foldLegacyKv(env); } catch { /* retried after LEGACY_RETRY_MS; a hit or a read never fails on it */ }
  }

  if (request.method === 'POST') {
    if (!page) return json({ error: 'POST needs /views/:site/:page' }, 400);
    return handleRecord(request, env, site, page);
  }

  if (request.method === 'GET') {
    if (!page) return handleSite(env, site);
    const stats = (await readStats(env.PAGE_VIEWS_DB, site, page)).get(page);
    return json(summarize(page, stats || blankStats()));
  }

  return json({ error: 'method not allowed' }, 405);
}
