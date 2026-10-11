// @vitest-environment node
/**
 * 2026-10-11 (KV usage cut): page views moved from KV (2 puts per counted view + 1 per drop, list() on every stats
 * read) to D1 (cloud/preset-worker/src/pageviews-route.js, schema migrations/0001_page_views.sql). Drives the real
 * worker fetch handler on a D1 stand-in backed by REAL SQLite (node:sqlite, the shipped migration applied), so the
 * SQL itself runs, and on a KV that counts every put / list.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloud/preset-worker/src/index.js';
import { LEGACY_KEY, LEGACY_RETRY_MS } from '../cloud/preset-worker/src/pageviews-route.js';

const MIGRATION = readFileSync(new URL('../cloud/preset-worker/migrations/0001_page_views.sql', import.meta.url), 'utf8');

/** The D1 API surface the worker uses (prepare/bind/run/first/all, batch = one transaction), on node:sqlite. */
function d1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(MIGRATION);
  const exec = (q, args) => {
    const st = sql.prepare(q);
    if (/^\s*SELECT\b|\bRETURNING\b/i.test(q)) {
      const results = st.all(...args).map((r) => ({ ...r }));
      return { success: true, results, meta: { changes: /^\s*SELECT\b/i.test(q) ? 0 : results.length } };
    }
    const r = st.run(...args);
    return { success: true, results: [], meta: { changes: Number(r.changes) } };
  };
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    exec: () => exec(q, args),
    async run() { return exec(q, args); },
    async all() { return exec(q, args); },
    async first() { return exec(q, args).results[0] ?? null; },
  });
  return {
    sql,
    prepare: (q) => stmt(q),
    async batch(list) {
      sql.exec('BEGIN');
      try { const out = list.map((s) => s.exec()); sql.exec('COMMIT'); return out; } catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
}

/** KV that counts every op; `failList` makes list() throw (the free tier's "limit exceeded"). */
function kv() {
  const m = new Map();
  const store = {
    m, puts: 0, lists: 0, deletes: 0, failList: false,
    async get(k, type) { if (!m.has(k)) return null; const v = m.get(k).v; return type === 'json' ? JSON.parse(v) : v; },
    async getWithMetadata(k) { return m.has(k) ? { value: m.get(k).v, metadata: m.get(k).meta || null } : { value: null, metadata: null }; },
    async put(k, v, opts = {}) { store.puts++; m.set(k, { v: String(v), meta: opts.metadata }); },
    async delete(k) { store.deletes++; m.delete(k); },
    async list({ prefix = '' } = {}) {
      store.lists++;
      if (store.failList) throw new Error('KV list() limit exceeded for the day.');
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ name: k, metadata: m.get(k).meta })), list_complete: true };
    },
  };
  return store;
}
const seed = (store, k, v) => store.m.set(k, { v: JSON.stringify(v) }); // seeding is not a counted put

const envWith = ({ legacy = true } = {}) => ({ PRESETS: kv(), LOADER_APPS: kv(), BUS_DATA: kv(), PENPLOTTER: kv(), PAGE_VIEWS_DB: d1(), ...(legacy ? { PAGE_VIEWS: kv() } : {}) });

const ORIGIN = 'https://triangle-frame-calc.pages.dev';
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const hit = (env, path, { ip = '1.1.1.1', ua = BROWSER, origin = ORIGIN, body = { w: 1200, h: 800 } } = {}) =>
  worker.fetch(new Request(`https://w.test/views/${path}`, {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip, 'User-Agent': ua, ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env).then((r) => r.json());
const read = (env, path) => worker.fetch(new Request(`https://w.test/views/${path}`), env).then((r) => r.json());
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const TODAY = day(0);

describe('page views on D1', () => {
  it('a hit is counted; a repeat visit (same visitor, page, day) is not; another visitor is', async () => {
    const env = envWith();
    expect(await hit(env, 'calc/home')).toEqual({ counted: true, reason: 'ok', views: 1, uniques: 1 });
    expect(await hit(env, 'calc/home')).toEqual({ counted: false, reason: 'repeat-visit', views: 1, uniques: 1 });
    expect(await hit(env, 'calc/home', { ip: '2.2.2.2' })).toEqual({ counted: true, reason: 'ok', views: 2, uniques: 2 });
    expect(await hit(env, 'calc/other')).toMatchObject({ counted: true, views: 1 }); // dedupe is per page
  });

  it('dropped hits are refused, tallied by reason, and never counted', async () => {
    const env = envWith();
    expect(await hit(env, 'calc/home', { origin: 'https://evil.example' })).toEqual({ counted: false, reason: 'bad-origin' });
    expect(await hit(env, 'calc/home', { ua: 'curl/8.0' })).toEqual({ counted: false, reason: 'bot-user-agent' });
    expect(await hit(env, 'calc/home', { ua: 'curl/8.0', ip: '3.3.3.3' })).toEqual({ counted: false, reason: 'bot-user-agent' });
    expect(await hit(env, 'calc/home', { body: { webdriver: true, w: 1, h: 1 } })).toEqual({ counted: false, reason: 'webdriver' });
    expect(await hit(env, 'calc/home', { body: {} })).toEqual({ counted: false, reason: 'no-viewport' });
    const site = await read(env, 'calc');
    expect(site.pages).toEqual([]);
    expect(site.dropped).toEqual({ 'bad-origin': 1, 'bot-user-agent': 2, webdriver: 1, 'no-viewport': 1 });
  });

  it('the stats read keeps the same JSON shape (site, one page, an unknown page)', async () => {
    const env = envWith();
    await hit(env, 'calc/home');
    await hit(env, 'calc/home', { ip: '2.2.2.2' });
    await hit(env, 'calc/about');
    await hit(env, 'calc/about');                       // repeat -> dropped.repeat-visit
    const site = await read(env, 'calc');
    expect(Object.keys(site)).toEqual(['site', 'generatedAt', 'window', 'pages', 'totals', 'dropped']);
    expect(site.site).toBe('calc');
    expect(site.window).toBe(90);
    expect(site.pages.map((p) => p.page)).toEqual(['home', 'about']);   // most viewed first
    const home = site.pages[0];
    expect(Object.keys(home)).toEqual(['page', 'views', 'uniques', 'views90', 'uniques90', 'views30', 'uniques30', 'firstSeen', 'lastSeen', 'days']);
    expect(home).toMatchObject({ views: 2, uniques: 2, views90: 2, uniques90: 2, views30: 2, uniques30: 2, days: { [TODAY]: { v: 2, u: 2 } } });
    expect(home.firstSeen).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(site.totals).toEqual({ views: 3, uniques: 3, views90: 3, uniques90: 3, views30: 3, uniques30: 3 });
    expect(site.dropped).toEqual({ 'repeat-visit': 1 });

    const one = await read(env, 'calc/home');
    expect(one).toEqual(home);
    expect(await read(env, 'calc/nope')).toEqual({ page: 'nope', views: 0, uniques: 0, views90: 0, uniques90: 0, views30: 0, uniques30: 0, firstSeen: null, lastSeen: null, days: {} });
    expect(await read(env, 'other')).toMatchObject({ site: 'other', pages: [], dropped: {} });
  });

  it('the 30/90-day windows and the 120-day retention read the day buckets', async () => {
    const env = envWith();
    await hit(env, 'calc/home');
    const ins = env.PAGE_VIEWS_DB.sql.prepare('INSERT INTO pv_days (site, page, day, views, uniques) VALUES (?, ?, ?, ?, ?)');
    ins.run('calc', 'home', day(45), 5, 4);    // in 90, not in 30
    ins.run('calc', 'home', day(100), 7, 7);   // in neither window, kept (< 120)
    ins.run('calc', 'home', day(200), 9, 9);   // past retention: never served
    const one = await read(env, 'calc/home');
    expect(one).toMatchObject({ views90: 6, uniques90: 5, views30: 1, uniques30: 1 });
    expect(Object.keys(one.days).sort()).toEqual([day(100), day(45), TODAY].sort());
    await hit(env, 'calc/home', { ip: '9.9.9.9' });   // a counted hit purges past-retention rows
    expect(env.PAGE_VIEWS_DB.sql.prepare('SELECT COUNT(*) AS n FROM pv_days WHERE day < ?').get(day(120)).n).toBe(0);
  });

  it('ZERO KV writes and ZERO KV list() on every page-view path (after the one-time legacy fold)', async () => {
    const env = envWith();
    await read(env, 'calc');                            // first request: the (empty) legacy fold
    expect(env.PAGE_VIEWS.lists).toBe(2);               // pv::stats:: and pv::drops::, once
    for (let i = 0; i < 10; i++) {
      await hit(env, 'calc/home', { ip: `10.0.0.${i}` });   // counted
      await hit(env, 'calc/home', { ip: `10.0.0.${i}` });   // repeat
      await hit(env, 'calc/home', { ua: 'python-requests/2' }); // dropped
      await read(env, 'calc');
      await read(env, 'calc/home');
    }
    expect(env.PAGE_VIEWS.lists).toBe(2);
    expect(env.PAGE_VIEWS.puts).toBe(0);
    expect(env.PAGE_VIEWS.deletes).toBe(0);
    expect((await read(env, 'calc/home')).views).toBe(10);
    // a fresh isolate (new process) sees the fold done in D1 and lists nothing
    const env2 = { ...envWith(), PAGE_VIEWS_DB: env.PAGE_VIEWS_DB };
    await hit(env2, 'calc/home', { ip: '20.0.0.1' });
    await read(env2, 'calc');
    expect(env2.PAGE_VIEWS.lists + env2.PAGE_VIEWS.puts).toBe(0);
    // and with no legacy binding at all, nothing touches KV
    const env3 = envWith({ legacy: false });
    expect(await hit(env3, 'calc/home')).toMatchObject({ counted: true });
  });

  it('a missing D1 binding answers 500, not a crash', async () => {
    const env = envWith();
    delete env.PAGE_VIEWS_DB;
    const r = await worker.fetch(new Request('https://w.test/views/calc'), env);
    expect(r.status).toBe(500);
    expect((await r.json()).error).toMatch(/PAGE_VIEWS_DB/);
  });
});

describe('legacy KV baseline, folded into D1 once', () => {
  const legacyEnv = () => {
    const env = envWith();
    seed(env.PAGE_VIEWS, 'pv::stats::calc::home', {
      views: 50, uniques: 40, firstSeen: '2026-01-02T00:00:00.000Z', lastSeen: '2026-10-10T12:00:00.000Z',
      days: { [day(1)]: { v: 3, u: 2 }, [day(40)]: { v: 4, u: 4 }, [day(200)]: { v: 99, u: 99 } },
    });
    seed(env.PAGE_VIEWS, 'pv::stats::calc::about', { views: 5, uniques: 5, firstSeen: '2026-03-01T00:00:00.000Z', lastSeen: '2026-09-01T00:00:00.000Z', days: {} });
    seed(env.PAGE_VIEWS, 'pv::stats::other::x', { views: 1, uniques: 1, days: { [day(2)]: { v: 1, u: 1 } } });
    seed(env.PAGE_VIEWS, `pv::drops::calc::${day(3)}`, { 'bot-user-agent': 4, 'bad-origin': 2 });
    seed(env.PAGE_VIEWS, `pv::drops::calc::${day(150)}`, { 'bot-user-agent': 1000 });  // past retention: skipped
    seed(env.PAGE_VIEWS, 'pv::seen::calc::home::abc', '1');                            // dedupe marker: not carried
    return env;
  };

  it('the first read folds the totals, days, drops and first/last seen in; KV is only read', async () => {
    const env = legacyEnv();
    const site = await read(env, 'calc');
    const home = site.pages.find((p) => p.page === 'home');
    expect(home).toMatchObject({
      views: 50, uniques: 40, views90: 7, uniques90: 6, views30: 3, uniques30: 2,
      firstSeen: '2026-01-02T00:00:00.000Z', lastSeen: '2026-10-10T12:00:00.000Z',
      days: { [day(40)]: { v: 4, u: 4 }, [day(1)]: { v: 3, u: 2 } },
    });
    expect(site.pages.map((p) => p.page)).toEqual(['home', 'about']);
    expect(site.totals.views).toBe(55);
    expect(site.dropped).toEqual({ 'bot-user-agent': 4, 'bad-origin': 2 });
    expect((await read(env, 'other/x')).views).toBe(1);
    expect(env.PAGE_VIEWS.puts + env.PAGE_VIEWS.deletes).toBe(0);
    expect(env.PAGE_VIEWS.lists).toBe(2);
    expect(env.PAGE_VIEWS_DB.sql.prepare('SELECT value FROM pv_meta WHERE key = ?').get(LEGACY_KEY).value).toMatch(/^done:/);
  });

  it('is additive with hits D1 counted first, and never folds twice', async () => {
    const env = legacyEnv();
    // a hit landed in D1 before the fold (another isolate, mid-claim): counted on top of the baseline
    const sql = env.PAGE_VIEWS_DB.sql;
    sql.prepare("INSERT INTO pv_pages VALUES ('calc', 'home', 1, 1, '2026-10-11T08:00:00.000Z', '2026-10-11T08:00:00.000Z')").run();
    sql.prepare("INSERT INTO pv_days VALUES ('calc', 'home', ?, 1, 1)").run(day(1));
    expect(await hit(env, 'calc/home')).toEqual({ counted: true, reason: 'ok', views: 52, uniques: 42 });
    const one = await read(env, 'calc/home');
    expect(one).toMatchObject({ views: 52, firstSeen: '2026-01-02T00:00:00.000Z', days: { [day(1)]: { v: 4, u: 3 } } });
    expect(one.lastSeen > '2026-10-11').toBe(true);
    // a new isolate on the same D1: already done, nothing re-read, nothing doubled
    const env2 = { ...legacyEnv(), PAGE_VIEWS_DB: env.PAGE_VIEWS_DB };
    expect((await read(env2, 'calc/home')).views).toBe(52);
    expect(env2.PAGE_VIEWS.lists).toBe(0);
  });

  it('a fold in progress elsewhere is not repeated; a stale or failed one is retaken after LEGACY_RETRY_MS only', async () => {
    const env = legacyEnv();
    const meta = env.PAGE_VIEWS_DB.sql.prepare('INSERT OR REPLACE INTO pv_meta (key, value) VALUES (?, ?)');
    meta.run(LEGACY_KEY, `running:${Date.now()}`);
    expect((await read(env, 'calc/home')).views).toBe(0);        // another request owns the fold
    expect(env.PAGE_VIEWS.lists).toBe(0);
    meta.run(LEGACY_KEY, `running:${Date.now() - LEGACY_RETRY_MS - 1000}`);
    expect((await read(env, 'calc/home')).views).toBe(50);       // stale claim retaken, folded once
    expect(env.PAGE_VIEWS.lists).toBe(2);

    const bad = legacyEnv();
    bad.PAGE_VIEWS.failList = true;
    expect(await hit(bad, 'calc/home')).toEqual({ counted: true, reason: 'ok', views: 1, uniques: 1 }); // the hit still counts
    for (let i = 0; i < 5; i++) await read(bad, 'calc');
    expect(bad.PAGE_VIEWS.lists).toBe(1);                         // one failed attempt, no retry storm
    expect(bad.PAGE_VIEWS.puts).toBe(0);
  });
});
