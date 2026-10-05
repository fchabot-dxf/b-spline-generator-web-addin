/**
 * F35 item 34, the app side: every cloud WRITE goes through editFetch -- asks ONCE, caches the password on this
 * device once the worker accepted it, re-asks only on 401 (once), shows the wait message on 429; the Settings
 * field sets / clears it; inside Fusion the add-in's cached copy is used and a new one is handed back to Python.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
const fusion = vi.hoisted(() => ({ on: false }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/state.js', () => ({ get isFusionMode() { return fusion.on; } }));

import {
  EDIT_PASSWORD, editFetch, getEditPassword, setEditPassword, receiveEditPasswordFromFusion, bindEditPasswordSettings,
} from '../bspline-frame-builder/b-spline-gen/html/main/edit-password.js';
import { showToast } from '../bspline-frame-builder/b-spline-gen/html/core/toast.js';
import { readFileSync } from 'node:fs';

const GOOD = 'dummy-test-password';
/** A stand-in worker: 200 for GOOD, 401 otherwise; records what each request carried. */
function stubWorker({ status } = {}) {
  const seen = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const auth = (init && init.headers && init.headers.Authorization) || null;
    seen.push(auth);
    const s = status ?? (auth === `Bearer ${GOOD}` ? 200 : 401);
    return new Response(JSON.stringify(s === 200 ? { ok: true } : { error: 'wrong password' }), { status: s });
  }));
  return seen;
}
const asker = (...answers) => vi.fn(async () => answers.shift() ?? null);
const PUT = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' };

beforeEach(() => { localStorage.clear(); fusion.on = false; receiveEditPasswordFromFusion(null); });
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(showToast).mockClear(); });

describe('item 34: editFetch', () => {
  it('first write asks ONCE, sends it as a Bearer header, caches it; the next write does not ask', async () => {
    const seen = stubWorker();
    const ask = asker(GOOD);
    expect((await editFetch('https://w/projects/a', PUT, ask)).status).toBe(200);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(EDIT_PASSWORD.askTitle);
    expect(seen).toEqual([`Bearer ${GOOD}`]);
    expect(localStorage.getItem(EDIT_PASSWORD.storageKey)).toBe(GOOD);
    const ask2 = asker();
    expect((await editFetch('https://w/projects/b', PUT, ask2)).status).toBe(200);
    expect(ask2).not.toHaveBeenCalled();
  });

  it('a cached WRONG password: 401 -> clears it, re-asks once, retries, caches the new one', async () => {
    setEditPassword('stale');
    const seen = stubWorker();
    const ask = asker(GOOD);
    expect((await editFetch('https://w/projects/a', PUT, ask)).status).toBe(200);
    expect(ask).toHaveBeenCalledWith(EDIT_PASSWORD.retryTitle);
    expect(seen).toEqual(['Bearer stale', `Bearer ${GOOD}`]);
    expect(getEditPassword()).toBe(GOOD);
  });

  it('wrong twice: no third try, nothing cached; the caller gets the 401', async () => {
    const seen = stubWorker();
    const r = await editFetch('https://w/projects/a', PUT, asker('nope', 'nope2'));
    expect(r.status).toBe(401);
    expect(seen).toHaveLength(2);
    expect(getEditPassword()).toBeNull();
  });

  it('cancelling the prompt sends nothing and answers a 401 the save path reports', async () => {
    const seen = stubWorker();
    const r = await editFetch('https://w/projects/a', PUT, asker(null));
    expect(seen).toHaveLength(0);
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe(EDIT_PASSWORD.cancelledError);
  });

  it('429 (too many wrong passwords) shows the wait message', async () => {
    setEditPassword(GOOD);
    stubWorker({ status: 429 });
    expect((await editFetch('https://w/projects/a', PUT, asker())).status).toBe(429);
    expect(showToast).toHaveBeenCalledWith(EDIT_PASSWORD.tooManyMessage);
  });
});

describe('item 34: the Settings field', () => {
  it('is in the Settings panel; Set caches what is typed, Clear forgets it', () => {
    const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf-8');
    const panel = html.slice(html.indexOf('id="settings-panel"'));
    for (const id of ['editPasswordInput', 'editPasswordSave', 'editPasswordClear', 'editPasswordStatus']) expect(panel).toContain(`id="${id}"`);
    document.body.innerHTML = '<input id="editPasswordInput" type="password"><button id="editPasswordSave"></button><button id="editPasswordClear"></button><div id="editPasswordStatus"></div>';
    bindEditPasswordSettings();
    expect(document.getElementById('editPasswordStatus').textContent).toMatch(/Not set/);
    document.getElementById('editPasswordInput').value = 'typed';
    document.getElementById('editPasswordSave').click();
    expect(getEditPassword()).toBe('typed');
    expect(document.getElementById('editPasswordInput').value).toBe('');
    expect(document.getElementById('editPasswordStatus').textContent).toMatch(/Saved/);
    document.getElementById('editPasswordClear').click();
    expect(getEditPassword()).toBeNull();
  });
});

describe('item 34: inside Fusion', () => {
  it('the add-in’s cached password is used (no ask); a new one goes back to Python to keep', async () => {
    fusion.on = true;
    const sent = [];
    vi.stubGlobal('adsk', { fusionSendData: (a, d) => sent.push([a, JSON.parse(d)]) });
    receiveEditPasswordFromFusion(GOOD);
    const seen = stubWorker();
    const ask = asker();
    expect((await editFetch('https://w/projects/a', PUT, ask)).status).toBe(200);
    expect(ask).not.toHaveBeenCalled();
    expect(seen).toEqual([`Bearer ${GOOD}`]);
    setEditPassword('newer');
    expect(sent).toContainEqual(['store_edit_password', { password: 'newer' }]);
    setEditPassword(null);
    expect(sent).toContainEqual(['store_edit_password', { password: null }]);
  });
});

describe('item 34: every cloud write in the Project Manager goes through editFetch', () => {
  it('no PUT / DELETE left on a plain fetch', () => {
    const src = readFileSync('bspline-frame-builder/b-spline-gen/html/main/cloud-project-manager.js', 'utf-8');
    const calls = src.split(/(?=\b(?:edit)?[fF]etch\()/).filter((s) => /^(edit)?[fF]etch\(/.test(s));
    const writes = calls.filter((s) => /method:\s*'(PUT|DELETE|POST)'/.test(s.slice(0, 220)));
    expect(writes.length).toBeGreaterThanOrEqual(7);
    expect(writes.filter((s) => !s.startsWith('editFetch('))).toEqual([]);
  });
});
