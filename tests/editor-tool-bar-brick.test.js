/**
 * The CONTEXT BAR on the Brick tab (owner 2026-11-27; main/editor-tool-bar.js EDITOR_TOOL_BAR.brick): the armed tool's
 * sub-tools first, then what its sub-tool or its next stroke uses -- the Area width + Clear areas, the Heights row, the Blocks
 * row, 'Click bricks', the Brush's Profile / Orientation / Width-pattern (its Accent and Rustic in the '⋯'), the Raised brush's
 * Mode + Level, the Stripe settings. The Wall / Frame / General settings and the SHARED_ROWS stay in the panel's sections.
 * The REAL palette body, the engine mocked (the brick-tab-sections suite's set-up).
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

import { initBrickPanel, brickToolBarKey } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { SHARED_ROWS } from '../bspline-frame-builder/b-spline-gen/html/main/brick-tab-sections.js';
import { initEditorToolBar, openToolBarMore, toolBarHostIds } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tool-bar.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (id) => document.getElementById(id);
const activeRow = () => [...$('editorToolBar').querySelectorAll('[data-tool-bar-row]')].find((r) => r.style.display !== 'none') || null;
const inBar = (id) => !!activeRow() && activeRow().contains($(id));
const inPanel = (id) => $('editorBrickPanel').contains($(id));

beforeAll(() => {
  localStorage.clear();
  document.body.innerHTML = BODY.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
  window.svgEditor = { _currentMode: 'select', setMode(m) { this._currentMode = m; document.dispatchEvent(new CustomEvent('editorModeChanged', { detail: { mode: m, editor: this } })); } };
  initEditorToolBar();
  initBrickPanel();
  setEditorTab('brick');
});

describe('the Brick rows', () => {
  it('Wall: its sub-tools + Click bricks; Heights: + the Heights row; Area: + the width chips and Clear areas', () => {
    $('brickTool_wall').click();
    expect(brickToolBarKey()).toBe('wall');
    expect(inBar('brickSubTools_wall')).toBe(true);
    expect(inBar('brickAccentClick')).toBe(true);
    expect(inPanel('brickSubTools_wall')).toBe(false);
    $('brickSubTool_wall_heights').click();
    expect(brickToolBarKey()).toBe('wall.heights');
    expect(inBar('brickHeightPickRow_wall')).toBe(true);
    expect(inBar('brickAccentClick')).toBe(false);
    $('brickSubTool_wall_area')?.click();
    if ($('brickSubTool_wall_area') && $('brickSubTool_wall_area').style.display !== 'none') {
      expect(brickToolBarKey()).toBe('wall.area');
      expect(inBar('brickWallAreaRow')).toBe(true);
    }
    // the Wall's own settings stay in its panel sections
    for (const id of ['brickWallPatternRow', 'brickWallAccentRow', 'brickLevelRow_wall']) expect(inPanel(id), id).toBe(true);
  });
  it('Frame: its sub-tools; Blocks: + the Blocks row; Heights: + its own Heights row', () => {
    $('brickTool_frame').click();
    expect(inBar('brickSubTools_frame')).toBe(true);
    $('brickSubTool_frame_blocks').click();
    expect(brickToolBarKey()).toBe('frame.blocks');
    expect(inBar('brickBlocksRow_frame')).toBe(true);
    $('brickSubTool_frame_heights').click();
    expect(inBar('brickHeightPickRow_frame')).toBe(true);
    expect(inPanel('brickFramePresetRow')).toBe(true);
  });
  it('Brush: Profile / Orientation / Width-pattern on the bar, Accent + Rustic in its \'⋯\'; a bar button writes the same setting', () => {
    $('brickTool_brush').click();
    expect(brickToolBarKey()).toBe('brush');
    for (const id of ['brickSubTools_brush', 'brickBrushProfileRow', 'brickBrushOrientationRow', 'brickBrushPresetRow']) { expect(inBar(id), id).toBe(true); expect(inPanel(id), id).toBe(false); }
    const sheet = openToolBarMore();
    for (const id of ['brickBrushAccentRow', 'brickRusticRow_brush']) expect(sheet.contains($(id)), id).toBe(true);
    $('brickBtnProfileContinuous').click();
    expect(P.brickSettings.profile).toBe('continuous');
    expect($('brickBtnProfileContinuous').classList.contains('active')).toBe(true);
    $('brickBtnProfileStripped').click();
    expect(P.brickSettings.profile).toBe('bricks');
  });
  it('Raised brush: Mode + Level on the bar', () => {
    $('brickTool_raisedBrush').click();
    for (const id of ['brickSubTools_raisedBrush', 'brickRaisedModeRow', 'brickRaisedLevelRow']) expect(inBar(id), id).toBe(true);
  });
  it('Stripe: the Brush\'s sub-tools + the stripe settings; the brick styles in its \'⋯\'', () => {
    $('brickTool_brush').click();
    $('brickSubTool_brush_stripe').click();
    expect(brickToolBarKey()).toBe('stripe');
    for (const id of ['brickSubTools_stripe', 'stripeDriveRow', 'stripeCountRow', 'stripePatternPresets']) expect(inBar(id), id).toBe(true);
    expect(openToolBarMore().contains($('stripeBrickStyles'))).toBe(true);
  });
  it('no SHARED_ROWS node is hosted by the bar (they stay in the element sections)', () => {
    const hosted = new Set(toolBarHostIds());
    for (const r of SHARED_ROWS) expect(hosted.has(r), r).toBe(false);
  });
});
