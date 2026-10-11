/**
 * 2026-10-11 (KV usage cut): the Pen Plotter listing (GET /projects|/palettes with X-API-Key) reads ONE index key per
 * kind (cloud/preset-worker/src/presets-index.js, declared as PP_INDEX in src/index.js) instead of KV list() on every
 * request; create / update / delete keep it in step. Drives the real worker fetch handler on a KV that counts list().
 */
import { describe, it, expect } from 'vitest';
import worker from '../cloud/preset-worker/src/index.js';
import { INDEX_MAX_AGE_HOURS } from '../cloud/preset-worker/src/presets-index.js';

const KEY = 'dummy-api-key';
function kv() {
  const m = new Map();
  const store = {
    m, lists: 0,
    async get(k) { return m.has(k) ? m.get(k).v : null; },
    async getWithMetadata(k) { return m.has(k) ? { value: m.get(k).v, metadata: m.get(k).meta || null } : { value: null, metadata: null }; },
    async put(k, v, opts = {}) { m.set(k, { v: String(v), meta: opts.metadata }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) {
      store.lists++;
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((k) => ({ name: k, metadata: m.get(k).meta })), list_complete: true };
    },
  };
  return store;
}
const envWith = () => ({ PRESETS: kv(), LOADER_APPS: kv(), PAGE_VIEWS: kv(), BUS_DATA: kv(), PENPLOTTER: kv(), API_KEY: KEY });
const call = (env, method, path, body) => worker.fetch(new Request(`https://w.test${path}`, {
  method, headers: { 'X-API-Key': KEY, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined,
}), env).then((r) => r.json());

describe('the Pen Plotter listing reads one index key per kind, not KV list()', () => {
  it('an existing store: the first listing builds the index with ONE list(); later listings list nothing; same shape', async () => {
    const env = envWith();
    await env.PENPLOTTER.put('projects/b-id', '{}', { metadata: { name: 'Bee', savedAt: '2026-10-01T00:00:00.000Z' } });
    await env.PENPLOTTER.put('projects/a-id', '{}', { metadata: { name: 'Ay', savedAt: '2026-10-02T00:00:00.000Z' } });
    await env.PENPLOTTER.put('projects/c-id', '{}');                                   // no metadata
    await env.PENPLOTTER.put('palettes/p-id', '{}', { metadata: { name: 'Pal', savedAt: 'x' } });
    const expected = [
      { id: 'a-id', customMeta: { name: 'Ay' }, savedAt: '2026-10-02T00:00:00.000Z' },
      { id: 'b-id', customMeta: { name: 'Bee' }, savedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'c-id', customMeta: { name: '' }, savedAt: null },
    ];
    expect(await call(env, 'GET', '/projects')).toEqual(expected);
    expect(env.PENPLOTTER.lists).toBe(1);
    for (let i = 0; i < 20; i++) expect(await call(env, 'GET', '/projects')).toEqual(expected);
    expect(env.PENPLOTTER.lists).toBe(1);
    expect(await call(env, 'GET', '/palettes')).toEqual([{ id: 'p-id', customMeta: { name: 'Pal' }, savedAt: 'x' }]);
    expect(env.PENPLOTTER.lists).toBe(2);                                              // its own index, built once
    expect(env.PENPLOTTER.m.has('__index::projects')).toBe(true);
  });

  it('create / rename / delete keep the index in step, with no list()', async () => {
    const env = envWith();
    await call(env, 'GET', '/projects');
    await call(env, 'GET', '/palettes');
    const lists0 = env.PENPLOTTER.lists;
    const a = await call(env, 'POST', '/projects', { name: 'First', project: { x: 1 } });
    const b = await call(env, 'POST', '/projects', { name: 'Second', project: { x: 2 } });
    const p = await call(env, 'POST', '/palettes', { name: 'Colors', palette: [] });
    let list = await call(env, 'GET', '/projects');
    expect(list.map((i) => i.customMeta.name).sort()).toEqual(['First', 'Second']);
    expect(list.map((i) => i.id)).toEqual([a.id, b.id].sort());
    expect(list[0].savedAt).toMatch(/^\d{4}-/);
    expect((await call(env, 'GET', '/palettes')).map((i) => i.id)).toEqual([p.id]);

    await call(env, 'PUT', `/projects/${a.id}`, { name: 'Renamed' });
    list = await call(env, 'GET', '/projects');
    expect(list.find((i) => i.id === a.id).customMeta.name).toBe('Renamed');
    expect(list).toHaveLength(2);

    await call(env, 'DELETE', `/projects/${b.id}`);
    expect((await call(env, 'GET', '/projects')).map((i) => i.id)).toEqual([a.id]);
    expect(await call(env, 'GET', `/projects/${a.id}`)).toEqual({ name: 'First', project: { x: 1 } }); // PUT kept the body
    expect(env.PENPLOTTER.lists).toBe(lists0);
    // the listing equals what list() would say
    const viaList = (await env.PENPLOTTER.list({ prefix: 'projects/' })).keys.map((k) => k.name.slice('projects/'.length));
    expect((await call(env, 'GET', '/projects')).map((i) => i.id)).toEqual(viaList);
  });

  it('self-heal: a record the index lost comes back when loaded; a stale index is rebuilt once', async () => {
    const env = envWith();
    await call(env, 'POST', '/projects', { name: 'A', project: {} });
    await call(env, 'GET', '/projects');
    await env.PENPLOTTER.put('projects/lost', '{"name":"L"}', { metadata: { name: 'L', savedAt: 's' } }); // past the index
    expect((await call(env, 'GET', '/projects')).some((i) => i.id === 'lost')).toBe(false);
    expect(await call(env, 'GET', '/projects/lost')).toEqual({ name: 'L' });
    expect((await call(env, 'GET', '/projects')).find((i) => i.id === 'lost')).toEqual({ id: 'lost', customMeta: { name: 'L' }, savedAt: 's' });
    const lists0 = env.PENPLOTTER.lists;
    const doc = JSON.parse(await env.PENPLOTTER.get('__index::projects'));
    await env.PENPLOTTER.put('__index::projects', JSON.stringify({ ...doc, builtAt: Date.now() - (INDEX_MAX_AGE_HOURS + 1) * 3600 * 1000 }));
    await call(env, 'GET', '/projects'); await call(env, 'GET', '/projects');
    expect(env.PENPLOTTER.lists).toBe(lists0 + 1);
  });

  it('a wrong API key still answers 401 and touches nothing', async () => {
    const env = envWith();
    const r = await worker.fetch(new Request('https://w.test/projects', { headers: { 'X-API-Key': 'nope' } }), env);
    expect(r.status).toBe(401);
    expect(env.PENPLOTTER.lists).toBe(0);
  });
});
