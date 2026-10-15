/**
 * The 3D-sidebar BRICK audit's layout items, applied with the tab wiring (advisor): A5 the quick Set row says "Mixed"
 * when the elements' sets differ; A7 Recessed / Flush labelled "Grout", above its depth; A8 "Hide filter texture" is a
 * surface setting (out of BRICK, into FILTER); A9 the Wall pattern icons in 4 columns; A10 its checkbox beside its text;
 * A11 the grout depth in the compact stepper style; A12 Wear's hint. The REAL palette body (no scripts), only the engine
 * mocked.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));

import { initBrickPanel, selectSet, revealBrickControl, activeBrickTab } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { BRICK_SET_IDS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { PICKER_TILE } from '../bspline-frame-builder/b-spline-gen/html/main/icon-select.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (id) => document.getElementById(id);

beforeAll(() => {
  document.body.innerHTML = BODY.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
  window.svgEditor = null;
  initBrickPanel();
});

describe('BRICK audit layout items', () => {
  it('A5: the quick Set row shows "Mixed" while the elements use different sets, nothing when they agree', () => {
    const [a, b] = BRICK_SET_IDS;
    selectSet(a, 'auto', ['wall', 'frame', 'brush', 'raisedBrush']);
    expect($('brickQuickMixed_set').style.display).toBe('none');
    selectSet(b, 'auto', ['frame']);
    expect($('brickQuickMixed_set').style.display).toBe('');
    expect([...$('brickQuickRow_set').querySelectorAll('button.active')]).toEqual([]);
    selectSet(a, 'auto', ['wall', 'frame', 'brush', 'raisedBrush']);
    expect($('brickQuickMixed_set').style.display).toBe('none');
  });
  // Fred (2026-10-11, redesign phase 1) replaced A9's 4-column tile grid in the sidebar: the Wall pattern and the Frame
  // bands are ONE chip each -- the wood frame's picker (icon-select), its grid at QUICK_PICKER's size -- with the name
  it('phase 1: Wall pattern and Frame bands are the shared picker (one chip + its name; the grid keeps the chip ids)', async () => {
    const { PICKER_TILE: QUICK_PICKER } = await import('../bspline-frame-builder/b-spline-gen/html/main/icon-select.js');
    for (const row of ['pattern', 'frameBands']) {
      const line = $(`brickQuickRow_${row}`);
      expect(line.querySelectorAll('.icon-select-button').length).toBe(1); // one chip
      expect($(`brickQuickSelect_${row}`).style.display).toBe('none'); // the select stays the source of truth, hidden
      const grid = line.querySelector('.icon-select-grid');
      expect(grid.style.display).toBe('none'); // closed until the chip is clicked
      const items = [...grid.querySelectorAll('.icon-select-option')];
      expect(items.length).toBeGreaterThan(3);
      for (const b of items) expect(b.id).toMatch(new RegExp(`^brickQuick_${row}_`)); // the old chip ids, kept
      expect(parseFloat(items[0].style.width)).toBe(QUICK_PICKER.tilePx);
      expect(line.querySelector('.icon-select-name').textContent.length).toBeGreaterThan(0); // the chosen pick, named
    }
    expect(QUICK_PICKER).toEqual({ tilePx: 80, columns: { phone: 3, desktop: 4 }, chipPx: 40 });
    // the sidebar no longer carries the "Quick settings" title / hint
    expect(document.body.textContent).not.toContain('Quick settings');
  });
  // Fred (the editor's Brick tabs on a phone): every inline icon grid of the Brick editor is the picker (one chip + its
  // name, tapped open), its buttons kept with their ids (main/icon-select.js mountIconGrid)
  it('the editor grids are pickers: Brick frame presets, each band\'s patterns, Wall pattern, Brush presets, the accents', () => {
    const pickerOf = (el) => el && el.closest('.icon-grid-picker');
    for (const id of ['brickFramePresetList', 'brickPatternList', 'brickBrushPresetList', 'brickAccentList']) {
      const grid = $(id);
      expect(pickerOf(grid), id).not.toBeNull();
      expect(grid.style.display, id).toBe('none'); // closed until its chip is tapped
      expect(pickerOf(grid).querySelectorAll('.icon-select-button').length, id).toBe(1);
    }
    expect(pickerOf($('brickPattern_stretcher'))).not.toBeNull();
    // each band's patterns: a select-backed picker (mountIconSelect), its accents a grid picker -- both at PICKER_TILE
    const bandButtons = [...document.querySelectorAll('[id^=brickFrameBandPattern_0_]')];
    expect(bandButtons.length).toBeGreaterThan(1);
    for (const b of bandButtons) { expect(b.closest('.icon-select'), b.id).not.toBeNull(); expect(b.style.width, b.id).toBe(`${PICKER_TILE.tilePx}px`); }
    const bandAccent = document.querySelector('#brickFrameBandPatternList [id^=brickAccent_band0_]');
    expect(pickerOf(bandAccent)).not.toBeNull();
    expect(bandAccent.style.width).toBe(`${PICKER_TILE.tilePx}px`); // not the row's old 16 px icons
  });
  it('the per-band row is SHOWN for a preset with bands (8e57aeb hid it with nothing showing it again)', () => {
    expect(P.brickSettings.frameBandPreset ? (FRAME_PRESETS[P.brickSettings.frameBandPreset] || []).length : 1).toBeGreaterThan(0);
    const row = $('brickFrameBandPatternRow');
    expect(row.style.display).not.toBe('none');
    expect($('brickFrameBandPatternLabel').style.display).not.toBe('none');
    expect($('brickFrameBandPatternList').style.display).not.toBe('none');
    expect(row.querySelector('[id^=brickFrameBandPatternSelect_0]')).not.toBeNull();
    expect(row.querySelector('[id^=brickAccentClick_band0]')).not.toBeNull(); // the band's accents (and the rock pick in its patterns)
  });
  it('A7: "Grout" labels the Recessed / Flush toggle, which sits above the depth', () => {
    const toggle = $('brickGroutProfileToggle');
    expect(toggle.previousElementSibling.textContent.trim()).toBe('Grout');
    expect(toggle.compareDocumentPosition($('brickGroutDepth')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('A11: the grout depth is a compact stepper with its label on its row (not a full-width box)', () => {
    const input = $('brickGroutDepth');
    expect(input.closest('.cad-stepper').classList.contains('cad-stepper-wide')).toBe(true);
    expect(input.style.width).toBe('');
    expect(input.closest('.cad-slider-row').querySelector('label').textContent).toBe('Grout depth (in)');
  });
  it('A8 + A10: "Hide filter texture" sits in FILTER (not BRICK), its box beside its text', () => {
    const box = $('isolateSkeleton');
    expect(box.closest('.panel-filter')).not.toBeNull();
    expect(box.closest('.panel-brick')).toBeNull();
    const row = box.closest('label');
    expect(row.style.flexDirection).toBe('row');
    expect(row.textContent.trim()).toBe('Hide filter texture');
    expect(box.style.width).toBe('auto');
  });
  it('A12: Wear says what its ends mean', () => {
    expect($('brickSurfaceWearRow').querySelector('label').textContent.replace(/\s+/g, ' ')).toBe('Wear (0 = crisp, 1 = worn)');
  });
});

describe('item 43: revealBrickControl (the brick matrix acts with the tab of the control up)', () => {
  it('a global control brings General up (the tool stays); an element control the tab of the tool; others change nothing', () => {
    window.svgEditor = { setMode: () => {} };
    $('brickTool_wall').click();
    expect(activeBrickTab()).toBe('wall');
    revealBrickControl('brickSuppression');
    expect(activeBrickTab()).toBe('general');
    expect($('brickSec_general_crumble').style.display).toBe(''); // Brick-tab v2: General's Crumble section
    revealBrickControl('brickGroutWidth'); // the Joint width is per element: the tool's tab
    expect(activeBrickTab()).toBe('wall');
    revealBrickControl('isolateSkeleton'); // not a Brick-panel control
    expect(activeBrickTab()).toBe('wall');
    window.svgEditor = null;
  });
});
