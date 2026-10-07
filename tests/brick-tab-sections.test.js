/**
 * Brick-tab v2 (Fred, 2026-10-07: "sections are unique"; "organise the params into actual sections"; "color coded";
 * mockup v2 "Yes, build it"): each Brick-editor tab shows its settings as its OWN foldable, colour-coded sections,
 * declared once in main/brick-tab-sections.js (BRICK_TAB_SECTIONS). The REAL palette body, the engine mocked.
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

import { initBrickPanel, revealBrickControl, activeBrickTab, brickTabs } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { BRICK_TAB_SECTIONS, SHARED_ROWS, sectionDomId, applyBrickTabSections, syncBrickSectionVisibility } from '../bspline-frame-builder/b-spline-gen/html/main/brick-tab-sections.js';
import { BRICK_SECTION_THEMES, themeTokens } from '../bspline-frame-builder/b-spline-gen/html/main/section-themes.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (id) => document.getElementById(id);
const shellShown = (tab, id) => $(sectionDomId(tab, id)).style.display !== 'none';
const shownSections = (tab) => BRICK_TAB_SECTIONS[tab].sections.filter((s) => shellShown(tab, s.id)).map((s) => s.id);

beforeAll(() => {
  localStorage.clear();
  document.body.innerHTML = BODY.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
  window.svgEditor = { setMode: () => {} };
  initBrickPanel();
  $('brickTool_wall').click();
});

describe('the declaration', () => {
  it('every declared host and row is in the real palette', () => {
    expect(applyBrickTabSections('wall')).toEqual([]);
  });
  it('a title is unique within its tab; tabs are the Brick tab strip\'s own (General + the tools that have settings)', () => {
    const stripIds = brickTabs().map((t) => t.id);
    for (const [tab, def] of Object.entries(BRICK_TAB_SECTIONS)) {
      expect(stripIds, tab).toContain(tab);
      const titles = def.sections.map((s) => s.title);
      expect(new Set(titles).size, tab).toBe(titles.length);
    }
  });
  it('a row sits in ONE section per tab, and in one tab only unless it is a shared per-element row (set, joint)', () => {
    const tabsOf = new Map();
    for (const [tab, def] of Object.entries(BRICK_TAB_SECTIONS)) {
      const rows = def.sections.flatMap((s) => s.rows);
      expect(new Set(rows).size, tab).toBe(rows.length);
      for (const r of rows) tabsOf.set(r, [...(tabsOf.get(r) || []), tab]);
    }
    for (const [r, tabs] of tabsOf) if (tabs.length > 1) expect(SHARED_ROWS, r).toContain(r);
    expect([...SHARED_ROWS].sort()).toEqual(['brickGroutSpacingHint', 'brickGroutWidthRow', 'brickSharedSet']);
    expect(tabsOf.get('brickSharedSet')).not.toContain('general');
  });
  it('Fred\'s placements: grout Colour / Edge only in General (Look); widths in each element tab; crumble + top bias in General', () => {
    const tabsWith = (row) => Object.entries(BRICK_TAB_SECTIONS).filter(([, d]) => d.sections.some((s) => s.rows.includes(row))).map(([t]) => t);
    expect(tabsWith('brickGroutPaintRow')).toEqual(['general']);
    expect(tabsWith('brickGroutWidthRow')).toEqual(['wall', 'frame', 'brush', 'raisedBrush']);
    expect(tabsWith('brickTopBiasRow')).toEqual(['general']);
    expect(BRICK_TAB_SECTIONS.general.sections.find((s) => s.id === 'crumble').rows).toEqual(['brickSuppressionRow', 'brickClumpingRow', 'brickTopBiasRow']);
  });
  it('the accent sections are titled "Accent relief" (Fred); item 9\'s Frame Crumble + Window surround are Frame sections', () => {
    for (const tab of ['wall', 'brush']) expect(BRICK_TAB_SECTIONS[tab].sections.find((s) => s.kind === 'brick-accent').title).toBe('Accent relief');
    const frame = BRICK_TAB_SECTIONS.frame.sections;
    expect(frame.map((s) => s.title)).toEqual(['Bricks', 'Bands', 'Corners', 'Height', 'Crumble', 'Window surround', 'Joint']);
    expect(frame.find((s) => s.id === 'crumble').kind).toBe(BRICK_TAB_SECTIONS.general.sections.find((s) => s.id === 'crumble').kind);
  });
});

describe('in the panel', () => {
  it('no shared "Brick" header any more: every visible header in the Brick panel is a section of the active tab or the Layers one', () => {
    const titles = [...$('editorBrickPanel').querySelectorAll('.layers-header')].map((h) => h.textContent.trim());
    expect(titles).not.toContain('Brick');
  });
  it('the Wall tab shows its own sections, in order, each themed by its kind; General\'s sections are hidden', () => {
    expect(activeBrickTab()).toBe('wall');
    expect(shownSections('wall')).toEqual(['bricks', 'pattern', 'accent', 'height', 'joint']);
    expect(shownSections('general')).toEqual([]);
    const shells = [...$('brickWallSection').querySelectorAll(':scope > .brick-sec')].map((s) => s.querySelector('.panel-header').textContent);
    expect(shells).toEqual(['Bricks', 'Pattern', 'Accent relief', 'Height', 'Joint']);
    const joint = $(sectionDomId('wall', 'joint'));
    expect(joint.classList.contains('section-themed-brick')).toBe(true);
    expect(joint.style.getPropertyValue('--section-stripe')).toBe(themeTokens('brick-joint', 'light').stripe);
    expect(BRICK_SECTION_THEMES['brick-joint']).toBeTruthy();
  });
  it('the shared rows follow the active tab: the set and the joint width move into Frame\'s own sections', () => {
    expect($(sectionDomId('wall', 'bricks')).contains($('brickSharedSet'))).toBe(true);
    $('brickTool_frame').click();
    expect($(sectionDomId('frame', 'bricks')).contains($('brickSharedSet'))).toBe(true);
    expect($(sectionDomId('frame', 'joint')).contains($('brickGroutWidthRow'))).toBe(true);
    expect(shownSections('wall')).toEqual([]);
    expect(shownSections('frame')).toContain('joint');
  });
  it('a section whose rows are all hidden hides too (Corners on a band-less frame), and comes back with bands', () => {
    // the app re-decides on every row show/hide (a MutationObserver); happy-dom delivers those late under a full-suite
    // load, so the rule itself is checked here through the same sync, called directly (the live shots cover the observer)
    $('brickFramePreset_none').click();
    expect($('brickFrameCornerList').style.display).toBe('none');
    syncBrickSectionVisibility();
    expect(shellShown('frame', 'corners')).toBe(false);
    $('brickFramePreset_single_soldier').click();
    syncBrickSectionVisibility();
    expect(shellShown('frame', 'corners')).toBe(true);
  });
  it('General shows Brick size / Look / Crumble / Randomness and no element section; the paint row lives there only', () => {
    $('brickTab_general').click();
    expect(shownSections('general')).toEqual(['size', 'look', 'crumble', 'random']);
    expect(shownSections('frame')).toEqual([]);
    expect($(sectionDomId('general', 'look')).contains($('brickGroutColorSwatch'))).toBe(true);
    expect($('brickSizeLabel').classList.contains('brick-sec-title-label')).toBe(true);
  });
  it('revealBrickControl brings up the tab of the section a control sits in', () => {
    revealBrickControl('brickGroutWidth');
    expect(activeBrickTab()).toBe('frame');
    revealBrickControl('brickTopBias');
    expect(activeBrickTab()).toBe('general');
    revealBrickControl('brickSurroundPresetList');
    expect(activeBrickTab()).toBe('frame');
  });
  it('a header click folds its section and the fold is remembered per device (the sidebar\'s own store)', () => {
    const shell = $(sectionDomId('frame', 'height'));
    shell.querySelector('.panel-header').click();
    expect(shell.querySelector('.panel-body').classList.contains('hidden')).toBe(true);
    expect(JSON.parse(localStorage.getItem('bspline.sidebar.openPanels'))['panel-bricksec-frame-height']).toBe(false);
    shell.querySelector('.panel-header').click();
    expect(shell.querySelector('.panel-body').classList.contains('hidden')).toBe(false);
  });
  it('Stripe (no sections of its own) shows none of the Brush sections', () => {
    $('brickTool_brush').click();
    expect(shownSections('brush')).toContain('stroke');
    $('brickSubTool_brush_stripe').click();
    expect(shownSections('brush')).toEqual([]);
    expect(P.brickSettings).toBeTruthy();
  });
});
