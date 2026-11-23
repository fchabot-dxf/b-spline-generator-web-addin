/**
 * STL-SHEET fix (Fred's phone shot, 2026-11-23): a result with no picture left the pane without a preview; a literal 'null' printed
 * under the GLB size line (Node.append(null)); a tile whose thumbnail is missing / fails was a blank box. Stubbed fetch, NO network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SMK_SOURCE } from '../bspline-frame-builder/b-spline-gen/html/core/stl/smk.js';
import { STL_LIBRARIES } from '../bspline-frame-builder/b-spline-gen/html/core/stl/libraries.js';
import { SMITHSONIAN_SOURCE } from '../bspline-frame-builder/b-spline-gen/html/core/stl/smithsonian.js';
import { openStlLibrarySheet } from '../bspline-frame-builder/b-spline-gen/html/main/stl-library-sheet.js';

const SMK = (n) => JSON.parse(readFileSync(`tests/fixtures/smk/${n}.json`, 'utf8'));
const SI = (n) => JSON.parse(readFileSync(`tests/fixtures/smithsonian/${n}.json`, 'utf8'));
const CSS = readFileSync('bspline-frame-builder/styles/layout-app.css', 'utf8').replace(/\r\n/g, '\n');
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
const fetchImpl = vi.fn(async (url, init) => {
  const s = String(url);
  if (init && init.headers && init.headers.Range) return new Response(new Uint8Array(1), { status: 206, headers: { 'content-range': 'bytes 0-0/815012' } });
  if (s.startsWith(SMK_SOURCE.api)) return json(SMK('search-all-p1'));
  if (s.startsWith(SMITHSONIAN_SOURCE.api)) return json(SI('search-all-p1'));
  return new Response('x', { status: 404 });
});
const tiles = () => [...document.querySelectorAll('.stl-lib-tile')];
beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { for (const o of document.querySelectorAll('.cad-modal-overlay')) o.remove(); });

describe('STL-SHEET phone fixes', () => {
  it('no literal "null" in the pane info for a model without dimensions', async () => {
    openStlLibrarySheet({ libraries: STL_LIBRARIES, fetchImpl, onPick: vi.fn() });
    await flush();
    tiles().find((t) => t.dataset.library === 'smithsonian').click(); // no dimensions listed
    const info = document.getElementById('stlLibPaneInfo');
    expect(info.textContent.length).toBeGreaterThan(0);
    expect(info.textContent).not.toMatch(/null|undefined/);
  });
  it('a tile whose thumbnail fails shows the "no picture" placeholder, not a blank box', async () => {
    openStlLibrarySheet({ libraries: STL_LIBRARIES, fetchImpl, onPick: vi.fn() });
    await flush();
    const t = tiles()[0];
    t.querySelector('img.stl-lib-thumb').dispatchEvent(new Event('error'));
    const ph = t.querySelector('.stl-lib-nopic');
    expect(ph).toBeTruthy();
    expect(ph.textContent).toMatch(/no picture/);
  });
  it('a selected result whose picture fails still shows a preview placeholder (and the 2D/3D pill) in the pane', async () => {
    openStlLibrarySheet({ libraries: STL_LIBRARIES, fetchImpl, onPick: vi.fn() });
    await flush();
    tiles()[0].click();
    const pane = document.getElementById('stlLibPane');
    const img = pane.querySelector('img.stl-lib-preview');
    img.dispatchEvent(new Event('error')); // large picture -> thumbnail
    pane.querySelector('img.stl-lib-preview')?.dispatchEvent(new Event('error')); // thumbnail -> placeholder
    const ph = pane.querySelector('.stl-lib-pane-pic .stl-lib-nopic');
    expect(ph).toBeTruthy();
    expect(pane.hidden).toBe(false);
    expect(pane.querySelector('#stlLibTurn')).toBeTruthy();
  });
  it('phone CSS: the pane is above the grid and the placeholder has a size', () => {
    expect(CSS).toMatch(/@media \(max-width: 600px\) \{[^@]*\.stl-lib-pane \{ order: -1/);
    expect(CSS).toMatch(/\.stl-lib-preview\.stl-lib-nopic \{[^}]*min-height: \d+px/);
  });
  it('phone CSS: the pane is pinned (sticky, top 0, capped at 40vh) while the grid scrolls', () => {
    const m = CSS.match(/@media \(max-width: 600px\) \{[^@]*?\.stl-lib-pane \{([^}]*)\}/);
    expect(m[1]).toMatch(/position: sticky/);
    expect(m[1]).toMatch(/top: -?[0-9]+(px)?;/);
    expect(m[1]).toMatch(/max-height: 40vh/);
  });
  it('an unknown file size drops its line (no "size unknown" text)', async () => {
    const f = vi.fn(async (url, init) => (init && init.headers && init.headers.Range ? new Response('x', { status: 500 }) : fetchImpl(url, init)));
    openStlLibrarySheet({ libraries: STL_LIBRARIES, fetchImpl: f, onPick: vi.fn() });
    await flush();
    tiles().find((t) => t.dataset.library === 'smithsonian').click();
    await new Promise((r) => setTimeout(r, 600));
    await flush();
    const info = document.getElementById('stlLibPaneInfo');
    expect(info.textContent).not.toMatch(/unknown/);
    expect(info.querySelector('.stl-lib-pane-size').hidden).toBe(true);
  });
});
