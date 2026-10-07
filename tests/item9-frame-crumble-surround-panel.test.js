/**
 * Item 9, the Brick editor panel: "Crumble frame too" + its amount and the Window surround block in the FRAME tab
 * (the surround rows only while the frame's inset window is on, else the hint); "Crumble top bias" in the GENERAL tab
 * only (Fred: Suppression, Clumping and Top bias stay in General), absent = 0.8. The REAL palette body, the engine mocked.
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

import { initBrickPanel, revealBrickControl, activeBrickTab } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { BRICK_TAB_SECTIONS } from '../bspline-frame-builder/b-spline-gen/html/main/brick-tab-sections.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { setFrameRecord, getFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (id) => document.getElementById(id);
const shown = (id) => $(id).style.display !== 'none';

beforeAll(() => {
  localStorage.clear();
  document.body.innerHTML = BODY.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
  window.svgEditor = { setMode: () => {} };
  initBrickPanel();
  $('brickTool_frame').click();
});

describe('item 9: Crumble frame too (Frame tab)', () => {
  it('sits in the Frame section; the amount is greyed while off', () => {
    expect($('brickFrameSection').contains($('brickSuppressFrame'))).toBe(true);
    expect($('brickFrameSection').contains($('brickFrameSuppression'))).toBe(true);
    expect(P.brickSettings.suppressFrame).toBeFalsy();
    expect($('brickFrameSuppression').disabled).toBe(true);
  });
  it('on writes the switch + the amount (default 0.3) and frees the amount; off keeps the amount', () => {
    $('brickSuppressFrame').click();
    expect(P.brickSettings.suppressFrame).toBe(true);
    expect(P.brickSettings.frameSuppression).toBe(0.3);
    expect($('brickFrameSuppression').disabled).toBe(false);
    $('brickFrameSuppression').value = '0.6';
    $('brickFrameSuppression').dispatchEvent(new Event('change'));
    expect(P.brickSettings.frameSuppression).toBe(0.6);
    $('brickSuppressFrame').click();
    expect(P.brickSettings.suppressFrame).toBe(false);
    expect(P.brickSettings.frameSuppression).toBe(0.6);
    expect($('brickFrameSuppression').disabled).toBe(true);
  });
  it('Clumping (General) is live while the frame crumbles, even at wall Suppression 0', () => {
    $('brickSuppression').value = '0';
    $('brickSuppression').dispatchEvent(new Event('change'));
    expect($('brickClumping').disabled).toBe(true);
    $('brickSuppressFrame').click();
    expect($('brickClumping').disabled).toBe(false);
    $('brickSuppressFrame').click();
    expect($('brickClumping').disabled).toBe(true);
  });
  it('a restored settings step (undo) shows on the controls', () => {
    P.brickSettings.suppressFrame = true;
    P.brickSettings.frameSuppression = 0.45;
    document.dispatchEvent(new CustomEvent('brickSettingsRestored'));
    expect($('brickSuppressFrame').checked).toBe(true);
    expect($('brickFrameSuppression').value).toBe('0.45');
    P.brickSettings.suppressFrame = false;
    document.dispatchEvent(new CustomEvent('brickSettingsRestored'));
    expect($('brickSuppressFrame').checked).toBe(false);
  });
});

describe('item 9: the Window surround block (Frame tab)', () => {
  it('while the inset window is off: the hint, no rows', () => {
    setFrameRecord({ insetWindow: { ...getFrameRecord().insetWindow, enabled: false } });
    expect($('brickFrameSection').contains($('brickSurroundHint'))).toBe(true);
    expect($('brickSurroundHint').textContent).toBe('Turn on the inset window in the Frame panel');
    expect(shown('brickSurroundHint')).toBe(true);
    expect(shown('brickSurroundRows')).toBe(false);
  });
  it('window on: the rows -- every listed frame preset once (None = the empty preset), the corners only with a preset', () => {
    setFrameRecord({ insetWindow: { enabled: true, cx: 0, cy: 0, w: 2, h: 3 } });
    expect(shown('brickSurroundHint')).toBe(false);
    expect(shown('brickSurroundRows')).toBe(true);
    const ids = [...$('brickSurroundPresetList').querySelectorAll('button')].map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(FRAME_PRESETS[id.replace('brickSurroundPreset_', '')]).toBeDefined();
    expect($('brickSurroundPreset_none').classList.contains('active')).toBe(true);
    expect(shown('brickSurroundCornerList')).toBe(false);
    $('brickSurroundPreset_single_soldier').click();
    expect(P.brickSettings.windowSurround).toEqual({ preset: 'single_soldier', corner: 'mitre' });
    expect(shown('brickSurroundCornerList')).toBe(true);
    $('brickSurroundCorner_butt').click();
    expect(P.brickSettings.windowSurround).toEqual({ preset: 'single_soldier', corner: 'butt' });
    expect($('brickSurroundCorner_butt').classList.contains('active')).toBe(true);
    $('brickSurroundPreset_none').click();
    expect(P.brickSettings.windowSurround.preset).toBe('none');
    expect(shown('brickSurroundCornerList')).toBe(false);
    setFrameRecord({ insetWindow: { ...getFrameRecord().insetWindow, enabled: false } });
  });
});

describe('item 9: Crumble top bias (General tab only)', () => {
  it("lives in General's Crumble section (Brick-tab v2), labelled, with the tooltip naming the wall and frame crumble", () => {
    expect(BRICK_TAB_SECTIONS.general.sections.find((s) => s.id === 'crumble').rows).toContain('brickTopBiasRow');
    expect($('brickSec_general_crumble').contains($('brickTopBias'))).toBe(true);
    const label = document.querySelector('label[for="brickTopBias"]');
    expect(label.textContent).toBe('Crumble top bias');
    expect(label.title).toMatch(/wall and frame crumble/);
    expect($('brickFrameSection').querySelector('#brickTopBias')).toBeNull();
    revealBrickControl('brickTopBias');
    expect(activeBrickTab()).toBe('general');
  });
  it('an absent field shows 0.8; an edit writes the value', () => {
    delete P.brickSettings.topBias;
    document.dispatchEvent(new CustomEvent('brickSettingsRestored'));
    expect($('brickTopBias').value).toBe('0.8');
    $('brickTopBias').value = '0.25';
    $('brickTopBias').dispatchEvent(new Event('change'));
    expect(P.brickSettings.topBias).toBe(0.25);
  });
});
