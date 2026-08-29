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
 * KV (binding: PAGE_VIEWS)
 *   pv::stats::<site>::<page>          { views, uniques, firstSeen, lastSeen, days:{ 'YYYY-MM-DD': {v,u} } }
 *   pv::seen::<site>::<page>::<hash>   dedupe marker, 2-day TTL
 *   pv::drops::<site>::<date>          { reason: count }  — what got excluded, and why
 *
 * Privacy: no IP and no user-agent is ever stored. The dedupe marker is a
 * SHA-256 of (date + IP + UA + page), so it rotates every midnight UTC and
 * cannot be walked back to a visitor.
 */

const DAY_RETENTION = 120;                 // daily buckets kept (>= the 90-day window)
const SEEN_TTL = 60 * 60 * 48;             // dedupe marker lifetime, seconds
const DROPS_TTL = 60 * 60 * 24 * DAY_RETENTION;
const MAX_BODY_BYTES = 4096;               // a hit payload is a few hundred bytes

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

/** Drops day buckets older than DAY_RETENTION so the doc can't grow forever. */
function pruneDays(days) {
  const cutoff = new Date(Date.now() - DAY_RETENTION * 86400000).toISOString().slice(0, 10);
  for (const date of Object.keys(days)) {
    if (date < cutoff) delete days[date];
  }
  return days;
}

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
async function recordDrop(env, site, reason) {
  const key = `pv::drops::${site}::${today()}`;
  try {
    const drops = (await env.PAGE_VIEWS.get(key, 'json')) || {};
    drops[reason] = (drops[reason] || 0) + 1;
    await env.PAGE_VIEWS.put(key, JSON.stringify(drops), { expirationTtl: DROPS_TTL });
  } catch { /* a dropped hit is never worth a 500 */ }
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

  const reason = screen(request, body);
  if (reason) {
    await recordDrop(env, site, reason);
    return json({ counted: false, reason });
  }

  // Dedupe: one count per visitor, per page, per UTC day. The hash is salted
  // with the date so nothing durable about the visitor is ever stored.
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';
  const date = today();
  const visitor = await sha256Hex(`${date}|${site}|${page}|${ip}|${ua}`);
  const seenKey = `pv::seen::${site}::${page}::${visitor}`;

  const statsKey = `pv::stats::${site}::${page}`;
  const [seen, stored] = await Promise.all([
    env.PAGE_VIEWS.get(seenKey),
    env.PAGE_VIEWS.get(statsKey, 'json'),
  ]);
  const stats = stored || blankStats();

  if (seen) {
    await recordDrop(env, site, 'repeat-visit');
    return json({ counted: false, reason: 'repeat-visit', views: stats.views || 0, uniques: stats.uniques || 0 });
  }

  const bucket = stats.days[date] || { v: 0, u: 0 };
  bucket.v += 1;
  bucket.u += 1;                       // deduped above, so every counted hit is a unique-of-the-day
  stats.days[date] = bucket;
  stats.days = pruneDays(stats.days);
  stats.views = (stats.views || 0) + 1;
  stats.uniques = (stats.uniques || 0) + 1;
  stats.firstSeen = stats.firstSeen || new Date().toISOString();
  stats.lastSeen = new Date().toISOString();

  await Promise.all([
    env.PAGE_VIEWS.put(statsKey, JSON.stringify(stats), {
      metadata: { savedAt: Date.now(), views: stats.views },
    }),
    env.PAGE_VIEWS.put(seenKey, '1', { expirationTtl: SEEN_TTL }),
  ]);

  return json({ counted: true, reason: 'ok', views: stats.views, uniques: stats.uniques });
}

async function handleSite(env, site) {
  const prefix = `pv::stats::${site}::`;
  const listed = await env.PAGE_VIEWS.list({ prefix });
  const pages = [];
  for (const key of listed.keys) {
    const stats = await env.PAGE_VIEWS.get(key.name, 'json');
    if (stats) pages.push(summarize(key.name.slice(prefix.length), stats));
  }
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
  const dropDays = await env.PAGE_VIEWS.list({ prefix: `pv::drops::${site}::` });
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  for (const key of dropDays.keys) {
    if (key.name.slice(-10) < cutoff) continue;
    const day = await env.PAGE_VIEWS.get(key.name, 'json');
    for (const [reason, n] of Object.entries(day || {})) dropped[reason] = (dropped[reason] || 0) + n;
  }

  return json({ site, generatedAt: new Date().toISOString(), window: 90, pages, totals, dropped });
}

/**
 * Entry point. Returns null when the path isn't ours, so the caller can fall
 * through to its existing routes.
 * @param {Request} request
 * @param {{PAGE_VIEWS: KVNamespace}} env
 * @param {URL} url
 * @returns {Promise<Response|null>}
 */
export async function handlePageViews(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean);   // ['views', site, page?]
  if (parts[0] !== 'views') return null;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (!env.PAGE_VIEWS) return json({ error: 'PAGE_VIEWS KV binding missing' }, 500);

  const [, site, page] = parts;
  if (!site || !SLUG.test(site)) return json({ error: 'bad site' }, 400);
  if (page !== undefined && !SLUG.test(page)) return json({ error: 'bad page' }, 400);

  if (request.method === 'POST') {
    if (!page) return json({ error: 'POST needs /views/:site/:page' }, 400);
    return handleRecord(request, env, site, page);
  }

  if (request.method === 'GET') {
    if (!page) return handleSite(env, site);
    const stats = await env.PAGE_VIEWS.get(`pv::stats::${site}::${page}`, 'json');
    return json(summarize(page, stats || blankStats()));
  }

  return json({ error: 'method not allowed' }, 405);
}
