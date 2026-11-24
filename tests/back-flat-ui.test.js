/**
 * Fred 2026-11-23 (terrain fit phase 4): with Back = Flat (P.backMode 'flat') the panels say what no longer acts -- DISPLAY
 * ONLY, nothing disabled (main/back-flat-ui.js BACK_FLAT_ROWS, the same greyed style as Terrain Shape's Flat rows):
 *   - Sculpt bottom: greyed, with one line 'No effect with a flat back' (its strokes are kept: they act again on Shell);
 *   - Thicken's Offset: greyed while it has no effect -- a flat back whose fill floor is 0 (a legacy board, a tiny carve
 *     depth). On a 'fill' board the thickness is the wood left under the deepest valley, so it stays live there.
 * And the Thicken line's label (main/layer-stack.js, its one label function) follows the settings after a programmatic
 * write (a Fusion pull's applyParam), an undo and a project load -- not only after a tap in its own panel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/history.js', async (orig) => ({ ...(await orig()), scheduleUndoSnapshot: vi.fn() }));
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initLayerStack, _resetLayerStackForTests } from '../bspline-frame-builder/b-spline-gen/html/main/layer-stack.js';

const BACK_UI = '../bspline-frame-builder/b-spline-gen/html/main/back-flat-ui.js';
const backUi = () => import(/* @vite-ignore */ BACK_UI); // loaded per test: a missing module fails these tests, not the file
const PALETTE = 'bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const bodyOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
const BODY = bodyOf(readFileSync(PALETTE, 'utf8'));
const GREY = 'shape-flat-greyed';
const KEYS = ['backMode', 'terrainFit', 'thickenEnabled', 'thickness', 'thickenDir', 'carveZ'];
const saved = {};

beforeEach(() => { for (const k of KEYS) saved[k] = P[k]; document.body.innerHTML = BODY; Object.assign(P, { thickenEnabled: true, thickness: 0.125, thickenDir: 'down', carveZ: 0.9 }); });
afterEach(() => { for (const k of KEYS) P[k] = saved[k]; _resetLayerStackForTests(); document.body.innerHTML = ''; });

const sculptBot = () => document.querySelector('.panel-sculpt-bot');
const greyed = (row) => [...document.querySelectorAll(`[data-back-flat-row="${row}"]`)];
const note = () => document.querySelector('[data-back-flat-note="sculptBottom"]');

describe('Back = Flat greys what no longer acts (display only)', () => {
  it('Sculpt bottom: its header and body greyed, the note shown -- and back to normal on Shell', async () => {
    const { syncBackFlatUI } = await backUi();
    P.terrainFit = 'fill'; P.backMode = 'flat';
    syncBackFlatUI(document);
    expect(greyed('sculptBottom').length).toBeGreaterThanOrEqual(2);
    for (const n of greyed('sculptBottom')) { expect(sculptBot().contains(n)).toBe(true); expect(n.classList.contains(GREY)).toBe(true); }
    expect(note().hidden).toBe(false);
    expect(note().textContent.trim()).toBe('No effect with a flat back');
    expect(note().classList.contains(GREY)).toBe(false); // the note itself reads at full strength
    for (const b of sculptBot().querySelectorAll('button, input')) expect(b.disabled).toBe(false); // never disabled
    P.backMode = 'shell';
    syncBackFlatUI(document);
    for (const n of greyed('sculptBottom')) expect(n.classList.contains(GREY)).toBe(false);
    expect(note().hidden).toBe(true);
  });
  it("Thicken's Offset: greyed under Flat only where it has no effect (fill floor 0)", async () => {
    const { syncBackFlatUI } = await backUi();
    const offset = () => greyed('thickenOffset');
    expect(offset().length).toBe(1);
    expect(offset()[0].contains(document.getElementById('thickenOffset'))).toBe(true);
    for (const [fit, carveZ, mode, want] of [['fill', 0.9, 'flat', false], ['legacy', 0.9, 'flat', true], ['fill', 0.1, 'flat', true], ['fill', 0.9, 'shell', false], ['legacy', 0.9, 'shell', false]]) {
      Object.assign(P, { terrainFit: fit, carveZ, backMode: mode });
      syncBackFlatUI(document);
      expect(offset()[0].classList.contains(GREY), `${fit} ${carveZ} ${mode}`).toBe(want);
      expect(document.getElementById('thickenOffset').disabled).toBe(false);
    }
  });
});

describe('the Thicken line label follows every write', () => {
  it('a programmatic sync (undo / load / pull) refreshes it from its one label function', async () => {
    const { syncBackFlatUI } = await backUi();
    initLayerStack({ onChange: () => {} });
    const label = () => document.getElementById('layerStackThickenState').textContent;
    P.backMode = 'shell'; syncBackFlatUI(document);
    expect(label()).toBe('0.125 in');
    P.backMode = 'flat'; // written without any event, as a restore writes P
    syncBackFlatUI(document);
    expect(label()).toBe('flat back');
    P.backMode = 'shell'; P.thickness = 0.2;
    syncBackFlatUI(document);
    expect(label()).toBe('0.2 in');
  });
});
