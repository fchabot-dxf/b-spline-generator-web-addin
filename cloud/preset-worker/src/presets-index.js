// The PRESETS store's listing, kept in ONE key instead of KV list() (2026-10-06: the live GET /projects answered 500
// "KV list() limit exceeded for the day" -- the free tier allows 1,000 list() a day; every page load of the app lists,
// and a day of headless probes spent them). A get costs a read (100,000 a day).
//
//   INDEX_KEY = { builtAt, items: [{ name, savedAt?, size? }] } -- every key of the store but the index itself and the
//   edit gate's fail counters, with its KV metadata, exactly what list() returned.
//
// Kept in step by the worker's own writes (PUT / DELETE on /projects, /presets, /cam-profiles: after the write, so a
// gated write updates it only once the password passed). Read-modify-write, no locking: two writes at the same moment
// can lose one entry (one user, rare). Self-healing instead of locks:
//   - no index, or one older than INDEX_MAX_AGE_HOURS -> rebuilt from list() (the only list() left: at most a few a day);
//   - a GET of a key that exists but is missing from the index -> added (rememberIfMissing).
// A key written outside the worker (wrangler) shows on the next rebuild.

export const INDEX_KEY = '__index::presets';
export const INDEX_MAX_AGE_HOURS = 6;

export async function readIndex(kv) {
  const raw = await kv.get(INDEX_KEY);
  if (raw == null) return null;
  try {
    const doc = JSON.parse(raw);
    return doc && Array.isArray(doc.items) ? doc : null;
  } catch {
    return null;
  }
}

export async function rebuildIndex(kv, hidden) {
  const items = [];
  let cursor;
  do {
    const page = await kv.list(cursor ? { cursor } : {});
    for (const k of page.keys) if (k.name !== INDEX_KEY && !hidden(k.name)) items.push({ name: k.name, ...(k.metadata || {}) });
    cursor = page.list_complete === false ? page.cursor : undefined;
  } while (cursor);
  const doc = { builtAt: Date.now(), items };
  await kv.put(INDEX_KEY, JSON.stringify(doc));
  return doc;
}

/** The listing: the index, rebuilt when it is missing or older than INDEX_MAX_AGE_HOURS. */
export async function listItems(kv, hidden, now = Date.now()) {
  const doc = await readIndex(kv);
  if (doc && now - (doc.builtAt || 0) < INDEX_MAX_AGE_HOURS * 3600 * 1000) return doc.items;
  return (await rebuildIndex(kv, hidden)).items;
}

async function edit(kv, change) {
  const doc = await readIndex(kv);
  if (!doc) return; // no index yet: the next listing builds it, with this write in it
  const items = change(doc.items.slice());
  if (items) await kv.put(INDEX_KEY, JSON.stringify({ ...doc, items }));
}

export const indexUpsert = (kv, name, meta) => edit(kv, (items) => {
  const next = items.filter((i) => i.name !== name);
  next.push({ name, ...meta });
  return next;
});

export const indexRemove = (kv, name) => edit(kv, (items) => {
  const next = items.filter((i) => i.name !== name);
  return next.length === items.length ? null : next;
});

/** Self-heal: a key a GET found in the store but not in the index (a lost concurrent update) is put back. */
export const rememberIfMissing = (kv, name, meta) => edit(kv, (items) => (items.some((i) => i.name === name) ? null : [...items, { name, ...meta }]));
