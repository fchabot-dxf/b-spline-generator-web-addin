/**
 * 2026-10-06 (the live worker: 500 "KV list() limit exceeded for the day"): a page load lists the projects ONCE --
 * the boot banner (_checkContinueBanner, Fred's "continue from phone") and the Projects panel share one fetch within
 * LIST_CACHE_TTL_MS; a failed list is never reused; a fresh one after the TTL. MEASURED before: a page load that
 * opened the panel listed twice.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bindProjectManager, _fetchProjectList, LIST_CACHE_TTL_MS } from '../bspline-frame-builder/b-spline-gen/html/main/cloud-project-manager.js';

const API = 'https://w.test';
let lists, fail;
beforeEach(() => {
  vi.useFakeTimers();
  lists = 0; fail = false;
  document.body.innerHTML = '<button id="btnQuickSave"></button><button id="btnOpenProjectManager"></button>';
  localStorage.clear();
  window.BSPLINE_PRESETS_API_URL = API;
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).startsWith(`${API}/projects?`)) {
      lists++;
      if (fail) return new Response('{"error":"list failed"}', { status: 500 });
      return new Response(JSON.stringify({ names: ['a'], items: [{ name: 'a', savedAt: 1 }] }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
});
afterEach(() => { vi.useRealTimers(); delete window.BSPLINE_PRESETS_API_URL; });

describe('the project list: one fetch per page load', () => {
  it('the boot banner and the panel share one list fetch', async () => {
    vi.setSystemTime(1_000_000);
    bindProjectManager({});
    await vi.advanceTimersByTimeAsync(3000); // the banner's check (2.5 s after boot)
    expect(lists).toBe(1);
    await _fetchProjectList(); await _fetchProjectList(); // the panel opening, twice
    expect(lists).toBe(1);
  });

  it('a list older than the TTL is fetched again; a failed one is never reused', async () => {
    vi.setSystemTime(5_000_000);
    bindProjectManager({});
    await _fetchProjectList();
    const n = lists;
    vi.setSystemTime(5_000_000 + LIST_CACHE_TTL_MS + 1);
    await _fetchProjectList();
    expect(lists).toBe(n + 1);
    vi.setSystemTime(5_000_000 + 3 * LIST_CACHE_TTL_MS);
    fail = true;
    await expect(_fetchProjectList()).rejects.toThrow('HTTP 500');
    fail = false;
    await _fetchProjectList();
    expect(lists).toBe(n + 3);
  });
});

// ---- the declared rule in bspline_gen_palette.html: a loopback-served page (every local harness / probe) never
// reaches the real worker unless ?realCloud=1; the live site (https) and Fusion (file://) keep it
import { readFileSync } from 'node:fs';
describe('the palette page: the real worker only off loopback, or on request', () => {
  const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf-8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((c) => c.includes('BSPLINE_PRESETS_API_URL ='));
  const urlFor = (href) => {
    const u = new URL(href), win = {};
    new Function('location', 'window', code)({ protocol: u.protocol, hostname: u.hostname, search: u.search }, win);
    return win.BSPLINE_PRESETS_API_URL;
  };
  const REAL = 'https://projects-dansemur.dansemur.workers.dev';
  it.each([
    ['http://127.0.0.1:8780/b-spline-gen/html/bspline_gen_palette.html', false],
    ['http://localhost:9702/b-spline-gen/html/bspline_gen_palette.html', false],
    ['http://127.0.0.1:8780/b-spline-gen/html/bspline_gen_palette.html?realCloud=1', true],
    ['https://bspline-generator.pages.dev/', true],
    ['file:///C:/Users/x/AppData/Roaming/Autodesk/addins/b-spline-gen/html/bspline_gen_palette.html', true],
  ])('%s -> the real worker: %s', (href, real) => {
    expect(urlFor(href) === REAL).toBe(real);
  });
});
