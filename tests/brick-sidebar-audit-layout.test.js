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

import { initBrickPanel, selectSet } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { BRICK_SET_IDS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

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
  it('A9: the Wall pattern icons sit in a 4-column grid', () => {
    expect($('brickQuickRow_pattern').style.display).toBe('grid');
    expect($('brickQuickRow_pattern').style.gridTemplateColumns).toMatch(/^repeat\(4,/);
    // the cells, not .cad-btn's 75 px floor: four of them overflowed the 232 px sidebar (measured live)
    for (const b of $('brickQuickRow_pattern').querySelectorAll('button')) expect(parseFloat(b.style.minWidth)).toBe(0);
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
