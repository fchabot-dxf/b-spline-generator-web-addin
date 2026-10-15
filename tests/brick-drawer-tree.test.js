/**
 * Redesign phase 4 (Fred's mockups shots/seatD/redesign/mock_Brick_*; advisor pick A, 2026-10-14): the Brick drawer is
 * ONE collapse tree (main/brick-tab-sections.js BRICK_DRAWER_TREE). An ELEMENT branch opens by arming its tool -- an
 * accordion in step with the tool row (the element settings follow the armed tool); General and Layers fold on their
 * own and are remembered per device. The REAL palette body, the engine mocked.
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

import { initBrickPanel, brickTabs, activeBrickTab } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { BRICK_DRAWER_TREE, BRICK_TREE_DEFAULT_OPEN, BRICK_TREE_OPEN_KEY, brickBranchDomId } from '../bspline-frame-builder/b-spline-gen/html/main/brick-tab-sections.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (id) => document.getElementById(id);
const branch = (id) => $(brickBranchDomId(id));
const open = (id) => branch(id).classList.contains('open');
const caret = (id) => branch(id).querySelector('.brick-branch-caret');
const head = (id) => branch(id).querySelector('.brick-branch-head');

beforeAll(() => {
  localStorage.clear();
  document.body.innerHTML = BODY.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
  window.svgEditor = { setMode: () => {} };
  initBrickPanel();
});

describe('the declaration', () => {
  it('every host declared is in the real palette and sits in its branch; the strip lists the tools only', () => {
    for (const b of BRICK_DRAWER_TREE) for (const h of b.hosts) expect(branch(b.id).contains($(h)), `${b.id} ${h}`).toBe(true);
    const tools = brickTabs().map((t) => t.id);
    for (const b of BRICK_DRAWER_TREE) if (b.armsTool) expect(tools, b.id).toContain(b.armsTool);
    expect(tools).not.toContain('general');
  });
  it('General keeps the retired tab\'s id on its header; Layers starts open (Fred: the layers on a phone), General folded', () => {
    expect(head('general').id).toBe('brickTab_general');
    expect(BRICK_TREE_DEFAULT_OPEN).toEqual(['layers']);
    expect(open('layers')).toBe(true);
    expect(open('general')).toBe(false);
  });
  it('Raised is ONE declaration (retiring with E\'s Select-on-bricks heights): removing it is one line', () => {
    expect(BRICK_DRAWER_TREE.filter((b) => b.id === 'raisedBrush').length).toBe(1);
  });
});

describe('an element branch opens by arming its tool: an accordion in step with the tool row', () => {
  it('no tool armed: no element branch open', () => {
    for (const b of BRICK_DRAWER_TREE.filter((x) => x.armsTool)) expect(open(b.id), b.id).toBe(false);
  });
  it('a tool picked in the row opens ITS branch only', () => {
    $('brickTool_wall').click();
    expect(open('wall')).toBe(true);
    $('brickTool_frame').click();
    expect(open('frame')).toBe(true);
    expect(open('wall')).toBe(false);
    expect(branch('frame').classList.contains('armed')).toBe(true);
  });
  it('a branch header arms its tool (the row follows)', () => {
    head('brush').click();
    expect(activeBrickTab()).toBe('brush');
    expect($('brickTool_brush').classList.contains('active')).toBe(true);
    expect(open('brush')).toBe(true);
    expect(open('frame')).toBe(false);
  });
  it('the armed branch\'s caret folds it (the tool stays armed); its header opens it again', () => {
    caret('brush').click();
    expect(open('brush')).toBe(false);
    expect(activeBrickTab()).toBe('brush');
    head('brush').click();
    expect(open('brush')).toBe(true);
  });
  it('an unarmed element branch\'s caret does nothing (its settings follow the armed tool)', () => {
    caret('wall').click();
    expect(open('wall')).toBe(false);
    expect(activeBrickTab()).toBe('brush');
  });
});

describe('General and Layers fold on their own, remembered per device', () => {
  it('General opens beside the armed element; its caret folds it; the open set is stored', () => {
    head('general').click();
    expect(open('general')).toBe(true);
    expect(open('brush')).toBe(true);
    expect(JSON.parse(localStorage.getItem(BRICK_TREE_OPEN_KEY))).toContain('general');
    caret('general').click();
    expect(open('general')).toBe(false);
    expect(JSON.parse(localStorage.getItem(BRICK_TREE_OPEN_KEY))).not.toContain('general');
  });
  it('Layers says how many layers it holds', () => {
    expect(branch('layers').querySelector('.brick-branch-summary').textContent).toMatch(/^\d+ layers?$/);
  });
});
