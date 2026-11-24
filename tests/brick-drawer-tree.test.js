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
const caret = (id) => branch(id).querySelector('.drawer-branch-caret');
const head = (id) => branch(id).querySelector('.drawer-branch-head');

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
  it('the row arms Brush: its card opens, Frame\'s closes', () => {
    $('brickTool_brush').click();
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

/** Fred 2026-11-24 (phone, Brick tab: the tool row and the four element headers below it were the same five choices):
 *  below the tool row only the ARMED tool's card shows, plus General and Layers -- like the Height tab. */
const shown = (id) => branch(id).style.display !== 'none';
const shownBranches = () => [...$('brickDrawerTree').querySelectorAll(':scope > .drawer-branch')].filter((s) => s.style.display !== 'none').map((s) => s.dataset.branch);
const elementCards = () => BRICK_DRAWER_TREE.filter((b) => b.armsTool && shown(b.id));
const rowTool = () => brickTabs().find((t) => $(t.buttonId).classList.contains('active'))?.id ?? null;
describe('one element card: the armed tool\'s, below the tool row', () => {
  const hostNodes = new Map();
  beforeAll(() => { for (const b of BRICK_DRAWER_TREE) for (const h of b.hosts) hostNodes.set(h, $(h)); });
  const withCard = () => brickTabs().filter((x) => BRICK_DRAWER_TREE.some((b) => b.armsTool === x.id));
  it('the tree shows exactly the armed tool\'s card + General + Layers, for each tool of the row with settings', () => {
    expect(withCard().map((t) => t.id)).toEqual(['wall', 'frame', 'brush', 'raisedBrush']);
    for (const t of withCard()) {
      $(t.buttonId).click();
      expect(shownBranches(), t.id).toEqual([BRICK_DRAWER_TREE.find((b) => b.armsTool === t.id).id, 'general', 'layers']);
    }
  });
  it('arming each tool swaps the card: its title is the row\'s label, its summary and hosts the tool\'s, open; the host nodes are the same nodes', () => {
    for (const t of withCard()) {
      $(t.buttonId).click();
      const cards = elementCards();
      expect(cards.length, t.id).toBe(1);
      const [card] = cards;
      expect(branch(card.id).querySelector('.drawer-branch-title').textContent, t.id).toBe(t.label);
      expect(branch(card.id).querySelector('.drawer-branch-summary').textContent, t.id).toBe(card.summary);
      expect(open(card.id), t.id).toBe(true);
      for (const h of card.hosts) {
        expect($(h), h).toBe(hostNodes.get(h));
        expect(branch(card.id).querySelector(':scope > .drawer-branch-body').contains($(h)), h).toBe(true);
      }
    }
  });
  it('Scissors (no settings): no element card, only General + Layers', () => {
    $('brickTool_scissors').click();
    expect(elementCards().map((b) => b.id)).toEqual([]);
    expect(shownBranches()).toEqual(['general', 'layers']);
  });
  it('the tool row and the card never disagree (Stripe, Brush\'s sub-tool, keeps the Brush card)', () => {
    for (const t of brickTabs()) {
      $(t.buttonId).click();
      const r = rowTool();
      expect(r, t.id).toBe(t.id);
      expect(elementCards().map((b) => b.armsTool), t.id).toEqual(BRICK_DRAWER_TREE.some((b) => b.armsTool === r) ? [r] : []);
    }
    $('brickTool_brush').click();
    $('brickSubTool_brush_stripe').click();
    expect(activeBrickTab()).toBe('brush');
    expect(rowTool()).toBe('brush');
    expect(elementCards().map((b) => b.id)).toEqual(['brush']);
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
    expect(branch('layers').querySelector('.drawer-branch-summary').textContent).toMatch(/^\d+ layers?$/);
  });
});
