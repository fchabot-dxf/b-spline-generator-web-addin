/**
 * F35 item 34, the worker side: READS open; a WRITE to the B-spline projects store needs the edit password
 * (Authorization: Bearer, secret EDIT_PASSWORD); 3 failed writes per IP per 10 min -> 429; only the declared
 * routes are gated (Connery's `connery:` projects, CAM profiles, the loader stay open). Drives the real worker
 * fetch handler on an in-memory KV.
 */
import { describe, it, expect } from 'vitest';
import worker from '../cloud/preset-worker/src/index.js';
import { EDIT_GATE } from '../cloud/preset-worker/src/edit-gate.js';

const DUMMY = 'dummy-test-password'; // never the real one

function kv() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k).v : null; },
    async getWithMetadata(k) { return m.has(k) ? { value: m.get(k).v, metadata: m.get(k).meta || null } : { value: null, metadata: null }; },
    async put(k, v, opts = {}) { m.set(k, { v: String(v), meta: opts.metadata, ttl: opts.expirationTtl }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ name: k, metadata: m.get(k).meta })) }; },
  };
}
const envWith = (secret = DUMMY) => ({ PRESETS: kv(), LOADER_APPS: kv(), PAGE_VIEWS: kv(), BUS_DATA: kv(), PENPLOTTER: kv(), ...(secret ? { EDIT_PASSWORD: secret } : {}) });
const call = (env, method, path, { pw, ip = '1.1.1.1', body } = {}) => {
  const headers = { 'CF-Connecting-IP': ip };
  if (pw) headers.Authorization = `Bearer ${pw}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return worker.fetch(new Request(`https://w.test${path}`, { method, headers, body }), env);
};
const SNAP = JSON.stringify({ a: 1 });

describe('item 34: the edit password on project writes', () => {
  it('reads stay open: list + load without a password', async () => {
    const env = envWith();
    await env.PRESETS.put('board', SNAP);
    expect((await call(env, 'GET', '/projects')).status).toBe(200);
    expect((await call(env, 'GET', '/projects/board')).status).toBe(200);
  });

  it('a save with no password -> 401 "password required" (not counted); the right one saves', async () => {
    const env = envWith();
    const r = await call(env, 'PUT', '/projects/board', { body: SNAP });
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe('password required');
    expect(await env.PRESETS.get('board')).toBeNull();
    expect((await call(env, 'PUT', '/projects/board', { body: SNAP, pw: DUMMY })).status).toBe(200);
    expect(await env.PRESETS.get('board')).toBe(SNAP);
  });

  it('delete, and the legacy /presets alias, are gated the same way', async () => {
    const env = envWith();
    await env.PRESETS.put('board', SNAP);
    expect((await call(env, 'DELETE', '/projects/board')).status).toBe(401);
    expect((await call(env, 'PUT', '/presets/board', { body: SNAP })).status).toBe(401);
    expect(await env.PRESETS.get('board')).toBe(SNAP);
    expect((await call(env, 'DELETE', '/projects/board', { pw: DUMMY })).status).toBe(200);
    expect(await env.PRESETS.get('board')).toBeNull();
  });

  it(`${EDIT_GATE.failLimit} wrong passwords from one IP -> 429, even with the right one; another IP is not blocked`, async () => {
    const env = envWith();
    for (let i = 0; i < EDIT_GATE.failLimit; i++) {
      const r = await call(env, 'PUT', '/projects/board', { body: SNAP, pw: 'nope' });
      expect(r.status).toBe(401);
      expect((await r.json()).error).toBe('wrong password');
    }
    expect((await call(env, 'PUT', '/projects/board', { body: SNAP, pw: DUMMY })).status).toBe(429);
    expect((await call(env, 'PUT', '/projects/board', { body: SNAP, pw: DUMMY, ip: '2.2.2.2' })).status).toBe(200);
    const counter = env.PRESETS.m.get(EDIT_GATE.failKeyPrefix + '1.1.1.1');
    expect(counter.ttl).toBe(EDIT_GATE.failWindowSec);
  });

  it('the failed-write counters never show in the project list', async () => {
    const env = envWith();
    await call(env, 'PUT', '/projects/board', { body: SNAP, pw: 'nope' });
    await env.PRESETS.put('real', SNAP);
    const list = await (await call(env, 'GET', '/projects')).json();
    expect(list.names).toEqual(['real']);
  });

  it('no secret set -> project writes answer 503 (closed until Fred sets it); reads still work', async () => {
    const env = envWith(null);
    expect((await call(env, 'PUT', '/projects/board', { body: SNAP, pw: 'anything' })).status).toBe(503);
    expect((await call(env, 'GET', '/projects')).status).toBe(200);
  });

  it('only the declared routes: Connery projects, CAM profiles and the loader stay open', async () => {
    const env = envWith();
    expect((await call(env, 'PUT', `/projects/${encodeURIComponent('connery:job 1')}`, { body: SNAP })).status).toBe(200);
    expect((await call(env, 'PUT', '/cam-profiles/mill', { body: SNAP })).status).toBe(200);
    expect((await call(env, 'PUT', '/loader/apps', { body: JSON.stringify({ apps: [] }) })).status).toBe(200);
  });

  it('CORS lets the browser send the Authorization header', async () => {
    const r = await worker.fetch(new Request('https://w.test/projects/board', { method: 'OPTIONS' }), envWith());
    expect(r.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/);
  });
});
