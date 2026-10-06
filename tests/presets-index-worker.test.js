/**
 * 2026-10-06 (the live GET /projects: 500 "KV list() limit exceeded for the day" -- the free tier allows 1,000 list()
 * a day): the worker lists the PRESETS store from ONE index key (cloud/preset-worker/src/presets-index.js), kept in
 * step by its own writes. Drives the real worker fetch handler on an in-memory KV that COUNTS list() calls.
 */
import { describe, it, expect } from 'vitest';
import worker from '../cloud/preset-worker/src/index.js';
import { INDEX_KEY, INDEX_MAX_AGE_HOURS } from '../cloud/preset-worker/src/presets-index.js';

const PW = 'dummy-test-password';
function kv() {
  const m = new Map();
  const store = {
    m, lists: 0,
    async get(k) { return m.has(k) ? m.get(k).v : null; },
    async getWithMetadata(k) { return m.has(k) ? { value: m.get(k).v, metadata: m.get(k).meta || null } : { value: null, metadata: null }; },
    async put(k, v, opts = {}) { m.set(k, { v: String(v), meta: opts.metadata }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) { store.lists++; return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ name: k, metadata: m.get(k).meta })), list_complete: true }; },
  };
  return store;
}
const envWith = () => ({ PRESETS: kv(), LOADER_APPS: kv(), PAGE_VIEWS: kv(), BUS_DATA: kv(), PENPLOTTER: kv(), EDIT_PASSWORD: PW });
const call = (env, method, path, { body, pw = PW } = {}) => worker.fetch(new Request(`https://w.test${path}`, {
  method, headers: { 'CF-Connecting-IP': '1.1.1.1', ...(pw ? { Authorization: `Bearer ${pw}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body,
}), env);
const names = async (env, path = '/projects') => (await (await call(env, 'GET', path)).json()).names.sort();

describe('the PRESETS listing reads one index key, not KV list()', () => {
  it('an existing store: the first listing builds the index with ONE list(); every later listing lists nothing', async () => {
    const env = envWith();
    await env.PRESETS.put('board', '{}', { metadata: { savedAt: 1, size: 2 } });
    await env.PRESETS.put('editfail::9.9.9.9', '2'); // the edit gate's counter: hidden, as before
    expect(await names(env)).toEqual(['board']);
    expect(env.PRESETS.lists).toBe(1);
    for (let i = 0; i < 20; i++) await names(env);
    expect(env.PRESETS.lists).toBe(1);
    const item = (await (await call(env, 'GET', '/projects')).json()).items[0];
    expect(item).toEqual({ name: 'board', savedAt: 1, size: 2 }); // the same shape list() gave
  });

  it('PUT / DELETE keep it in step (and /presets, /cam-profiles), with no list()', async () => {
    const env = envWith();
    await names(env); // builds the (empty) index
    const lists0 = env.PRESETS.lists;
    await call(env, 'PUT', '/projects/a', { body: '{}' });
    await call(env, 'PUT', '/presets/b', { body: '{}' });
    await call(env, 'PUT', '/cam-profiles/c', { body: '{}' });
    expect(await names(env)).toEqual(['a', 'b', 'cam-profile::c']); // GET /projects lists the whole store, as before
    expect(await names(env, '/cam-profiles')).toEqual(['c']);
    await call(env, 'DELETE', '/projects/a');
    await call(env, 'DELETE', '/cam-profiles/c');
    expect(await names(env)).toEqual(['b']);
    expect(env.PRESETS.lists).toBe(lists0);
  });

  it('a write the gate refuses does not touch the index', async () => {
    const env = envWith();
    await names(env);
    expect((await call(env, 'PUT', '/projects/x', { body: '{}', pw: null })).status).toBe(401);
    expect(await names(env)).toEqual([]);
    expect(JSON.parse(await env.PRESETS.get(INDEX_KEY)).items).toEqual([]);
  });

  it('self-heal: a key the index lost (a concurrent write) comes back when it is loaded; a stale index is rebuilt once', async () => {
    const env = envWith();
    await call(env, 'PUT', '/projects/a', { body: '{}' });
    await names(env);
    await env.PRESETS.put('lost', '{}', { metadata: { savedAt: 5, size: 2 } }); // written past the index
    expect(await names(env)).toEqual(['a']);
    expect((await call(env, 'GET', '/projects/lost')).status).toBe(200);
    expect(await names(env)).toEqual(['a', 'lost']);
    const lists0 = env.PRESETS.lists;
    const doc = JSON.parse(await env.PRESETS.get(INDEX_KEY));
    await env.PRESETS.put(INDEX_KEY, JSON.stringify({ ...doc, builtAt: Date.now() - (INDEX_MAX_AGE_HOURS + 1) * 3600 * 1000 }));
    await names(env); await names(env);
    expect(env.PRESETS.lists).toBe(lists0 + 1);
  });

  it('a corrupt index is rebuilt, never served', async () => {
    const env = envWith();
    await env.PRESETS.put('board', '{}');
    await env.PRESETS.put(INDEX_KEY, 'not json');
    expect(await names(env)).toEqual(['board']);
  });
});
