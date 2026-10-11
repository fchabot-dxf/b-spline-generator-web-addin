// A KV store's listing, kept in ONE key instead of KV list() (2026-10-06: the live GET /projects answered 500
// "KV list() limit exceeded for the day" -- the free tier allows 1,000 list() a day; every page load of the app lists,
// and a day of headless probes spent them). A get costs a read (100,000 a day).
//
// Each listing is DECLARED with defineIndex (index key, list prefix, hidden rule, item shape). In use (src/index.js):
//   PRESETS_INDEX            PRESETS     '__index::presets'    every key but the index + the edit gate's fail counters
//   PP_INDEX.projects/palettes  PENPLOTTER  '__index::projects' / '__index::palettes'   ('<kind>/' prefix, ppList's shape)
//
//   index doc = { builtAt, items: [...] } -- one item per listed key, spec.item(keyName, kvMetadata): exactly what the
//   listing built from list() would hold.
//
// Kept in step by the worker's own writes (after the write, so a gated write updates it only once the password
// passed). Read-modify-write, no locking: two writes at the same moment can lose one entry (one user, rare).
// Self-healing instead of locks:
//   - no index, or one older than INDEX_MAX_AGE_HOURS -> rebuilt from list() (the only list() left: at most a few a day);
//   - a GET of a key that exists but is missing from the index -> added (rememberIfMissing).
// A key written outside the worker (wrangler) shows on the next rebuild.

export const INDEX_KEY = '__index::presets';
export const INDEX_MAX_AGE_HOURS = 6;

/**
 * Declares one listing.
 *   key     the KV key holding the index doc
 *   prefix  list() prefix of the listed keys ('' = the whole store)
 *   hidden  keys under the prefix that are never listed
 *   item    (keyName, metadata) -> the listed entry;  keyOf: entry -> its keyName (the inverse)
 */
export function defineIndex({ key, prefix = '', hidden = () => false, item = (name, meta) => ({ name, ...meta }), keyOf = (i) => i.name }) {
  return { key, prefix, hidden, item, keyOf };
}

export async function readIndex(kv, spec) {
  const raw = await kv.get(spec.key);
  if (raw == null) return null;
  try {
    const doc = JSON.parse(raw);
    return doc && Array.isArray(doc.items) ? doc : null;
  } catch {
    return null;
  }
}

export async function rebuildIndex(kv, spec) {
  const items = [];
  let cursor;
  do {
    const opts = spec.prefix ? { prefix: spec.prefix } : {};
    const page = await kv.list(cursor ? { ...opts, cursor } : opts);
    for (const k of page.keys) if (k.name !== spec.key && !spec.hidden(k.name)) items.push(spec.item(k.name, k.metadata || {}));
    cursor = page.list_complete === false ? page.cursor : undefined;
  } while (cursor);
  const doc = { builtAt: Date.now(), items };
  await kv.put(spec.key, JSON.stringify(doc));
  return doc;
}

/** The listing: the index, rebuilt when it is missing or older than INDEX_MAX_AGE_HOURS. */
export async function listItems(kv, spec, now = Date.now()) {
  const doc = await readIndex(kv, spec);
  if (doc && now - (doc.builtAt || 0) < INDEX_MAX_AGE_HOURS * 3600 * 1000) return doc.items;
  return (await rebuildIndex(kv, spec)).items;
}

async function edit(kv, spec, change) {
  const doc = await readIndex(kv, spec);
  if (!doc) return; // no index yet: the next listing builds it, with this write in it
  const items = change(doc.items.slice());
  if (items) await kv.put(spec.key, JSON.stringify({ ...doc, items }));
}

export const indexUpsert = (kv, spec, name, meta) => edit(kv, spec, (items) => {
  const next = items.filter((i) => spec.keyOf(i) !== name);
  next.push(spec.item(name, meta || {}));
  return next;
});

export const indexRemove = (kv, spec, name) => edit(kv, spec, (items) => {
  const next = items.filter((i) => spec.keyOf(i) !== name);
  return next.length === items.length ? null : next;
});

/** Self-heal: a key a GET found in the store but not in the index (a lost concurrent update) is put back. */
export const rememberIfMissing = (kv, spec, name, meta) => edit(kv, spec, (items) =>
  (items.some((i) => spec.keyOf(i) === name) ? null : [...items, spec.item(name, meta || {})]));
