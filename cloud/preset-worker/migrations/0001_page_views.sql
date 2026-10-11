-- Page-view counters (binding PAGE_VIEWS_DB). Replaces the KV keys pv::stats / pv::seen / pv::drops, which cost
-- 2 KV writes per counted view and 1 per dropped hit against the free tier's shared 1,000 writes a day.
-- No IP and no user-agent is ever stored: pv_seen.visitor is SHA-256(date|site|page|ip|ua), rotating daily.

-- Running totals per page (what summarize() reports as views / uniques / firstSeen / lastSeen).
CREATE TABLE IF NOT EXISTS pv_pages (
  site       TEXT    NOT NULL,
  page       TEXT    NOT NULL,
  views      INTEGER NOT NULL DEFAULT 0,
  uniques    INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT,                       -- ISO timestamp
  last_seen  TEXT,                       -- ISO timestamp
  PRIMARY KEY (site, page)
);

-- Daily buckets (the 30/90-day windows and the `days` map). Kept DAY_RETENTION (120) days.
CREATE TABLE IF NOT EXISTS pv_days (
  site    TEXT    NOT NULL,
  page    TEXT    NOT NULL,
  day     TEXT    NOT NULL,              -- 'YYYY-MM-DD' (UTC)
  views   INTEGER NOT NULL DEFAULT 0,
  uniques INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site, page, day)
);
CREATE INDEX IF NOT EXISTS pv_days_day ON pv_days (day);

-- De-dup: one row per visitor-page-day hash. Purged once it is older than yesterday.
CREATE TABLE IF NOT EXISTS pv_seen (
  visitor TEXT NOT NULL PRIMARY KEY,
  day     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pv_seen_day ON pv_seen (day);

-- What was refused, and why (the `dropped` map). Kept DAY_RETENTION days.
CREATE TABLE IF NOT EXISTS pv_drops (
  site   TEXT    NOT NULL,
  day    TEXT    NOT NULL,
  reason TEXT    NOT NULL,
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site, day, reason)
);
CREATE INDEX IF NOT EXISTS pv_drops_day ON pv_drops (day);

-- Worker bookkeeping. key 'legacy-kv-import': 'running:<ms>' while the one-time KV baseline fold runs,
-- 'done:<ms>' once it has been folded in (see foldLegacyKv in src/pageviews-route.js).
CREATE TABLE IF NOT EXISTS pv_meta (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
);
