/**
 * UI2 (Fred: colour-coded lattice panel sections, Generate pinned, hide
 * Shape Lattice's Fill seed) + UI2 AMEND 2 (Fred: "maybe the right hand
 * panel is the only panel then" — ONE right-hand column on desktop, the
 * active tool panel mounts INTO it instead of opening its own middle
 * column). editor/lattice-side-column.js is the one decorator module for
 * all of this — no edits to bspline_gen_palette.html (seat B owns that
 * markup in lane-b), so every assertion here drives the SAME kind of
 * synthetic DOM fixture that file actually decorates at runtime.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initLatticeSideColumn,
  sectionKindForTitle,
  SECTION_KIND_BY_TITLE,
  LATTICE_DRAWER_TREES,
} from '../bspline-frame-builder/b-spline-gen/html/editor/lattice-side-column.js';

describe('sectionKindForTitle / SECTION_KIND_BY_TITLE', () => {
  it('maps every declared title to its kind', () => {
    expect(sectionKindForTitle('Grid & rails')).toBe('rails');
    expect(sectionKindForTitle('Ties')).toBe('ties');
    expect(sectionKindForTitle('Nodes')).toBe('nodes');
    expect(sectionKindForTitle('Contour')).toBe('contour');
    expect(sectionKindForTitle('Border')).toBe('contour');
    expect(sectionKindForTitle('Shape')).toBe('contour');
    // T81 item 2 (Fred screenshot: "boundary and contour have the same
    // color code"): Boundary is its OWN kind now, not an alias for contour.
    expect(sectionKindForTitle('Boundary')).toBe('boundary');
  });

  it('falls through to neutral for anything not declared (Add, Colors, Widths, Seed, Fill seed, ...)', () => {
    for (const title of ['Add', 'Colors', 'Widths', 'Seed', 'Fill seed', 'Segments', 'gibberish']) {
      expect(sectionKindForTitle(title)).toBe('neutral');
    }
  });

  it('is whitespace-tolerant (a title read from live textContent may carry incidental whitespace)', () => {
    expect(sectionKindForTitle('  Ties  ')).toBe('ties');
  });

  it('every value in the declared map is one of the 5 real kinds (no typo silently creating a 6th)', () => {
    const validKinds = new Set(['rails', 'ties', 'nodes', 'contour', 'boundary']);
    for (const kind of Object.values(SECTION_KIND_BY_TITLE)) {
      expect(validKinds.has(kind)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------
// DOM fixture mirroring bspline_gen_palette.html's real structure enough
// to exercise the decorator — NOT a copy of the real markup (this file
// itself must never be edited from a test either), just the shape
// initLatticeSideColumn actually reads: bold-span-first-child sections,
// the panel/body/footer/generate/unprotectAll ids it looks up by id, and
// the layers panel's own header+list.
// ---------------------------------------------------------------------
function section(title, extraHtml = '', id = '') {
  return `<div${id ? ` id="${id}"` : ''}><span style="font-weight:600;">${title}</span>${extraHtml}</div>`;
}

function buildFixture() {
  document.body.innerHTML = `
    <div id="editorLayersPanel">
      <div class="layers-header"><span>Layers</span><button id="editorAddLayer">+</button></div>
      <div class="layers-list" id="editorLayersList"></div>
    </div>
    <aside id="editorLatticePanel">
      <div id="editorLatticePanelHeader"><span>Lattice Pattern</span></div>
      <div id="editorLatticePanelBody">
        <!-- T81 item 4: data-no-collapse AND placed BEFORE Add, matching
             the REAL page's own order exactly (Seed, then Add) -- this is
             what let a bare querySelector on that attribute match Seed
             instead of Add and silently leave Add visible; the fixture
             used to have only ONE such element (Add), which could never
             reproduce that collision. -->
        <div data-no-collapse>
          <span style="font-weight:600;">Seed</span>
        </div>
        ${section('Grid & rails', '', 'latticeSec_rails')}
        ${section('Ties', '', 'latticeSec_ties')}
        ${section('Nodes', '', 'latticeSec_nodes')}
        ${section('Colors', '<button id="latticeColorRails" style="background:#c62828;"></button><button id="latticeColorTies" style="background:#f9c80e;"></button><button id="latticeColorNodes" style="background:#1a237e;"></button>', 'latticeSec_colors')}
        ${section('Widths', '', 'latticeSec_widths')}
        <div data-no-collapse>
          <span style="font-weight:600;">Add</span>
          <div role="group" id="latticeAddKindGroup" class="segmented-group">
            <button type="button" id="latticeAdd-rail" class="editor-fillmode-btn active">Rail</button>
            <button type="button" id="latticeAdd-tie" class="editor-fillmode-btn">Tie</button>
            <button type="button" id="latticeAdd-node" class="editor-fillmode-btn">Node</button>
          </div>
        </div>
      </div>
      <div id="editorLatticePanelFooter">
        <button id="latticeGenerate">Generate</button>
        <button id="latticeUnprotectAll">Unprotect all</button>
      </div>
    </aside>
    <aside id="editorShapeLatticePanel">
      <div id="editorShapeLatticePanelHeader"><span>Shape Lattice</span></div>
      <div id="editorShapeLatticePanelBody">
        ${section('Shape')}
        ${section('Segments')}
        ${section('Grid & rails', '', 'shapeSec_rails')}
        ${section('Ties', '', 'shapeSec_ties')}
        ${section('Nodes', '', 'shapeSec_nodes')}
        ${section('Colors', '<button id="shapeLatticeColorRails" style="background:#c62828;"></button><button id="shapeLatticeColorTies" style="background:#f9c80e;"></button><button id="shapeLatticeColorNodes" style="background:#1a237e;"></button>', 'shapeSec_colors')}
        ${section('Widths', '', 'shapeSec_widths')}
        ${section('Boundary', '', 'shapeSec_boundary')}
        ${section('Fill seed', '<input id="shapeLatticeSeed">')}
      </div>
      <div id="editorShapeLatticePanelFooter">
        <button id="shapeLatticeGenerate">Generate</button>
        <button id="shapeLatticeUnprotectAll">Unprotect all</button>
      </div>
    </aside>
  `;
}

function setDesktop(isDesktop) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: isDesktop ? false : true, // the query itself IS the mobile query
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function fireModeChanged(editor, mode) {
  document.dispatchEvent(new CustomEvent('editorModeChanged', { detail: { editor, mode } }));
}

describe('initLatticeSideColumn', () => {
  let editor;

  beforeEach(() => {
    // redesign phase 2: the lattice tools and their panels are the LATTICE tab's (TOOL_PANEL_MOUNTS tabs) -- set BEFORE the
    // fixture is built, so earlier tests' listeners act on the old DOM, not this one
    document.dispatchEvent(new CustomEvent('editorTabChanged', { detail: { tab: 'lattice' } }));
    buildFixture();
    setDesktop(true);
    // UI3 AMEND 1: initLatticeSideColumn now reads editor._lattice.drawKind
    // (to seed the new icon row's initial active state) — a real editor
    // instance always has this (editor.js's own constructor), so the
    // fixture matches that shape rather than making production code
    // defensively handle an impossible-in-practice bare `{}`.
    editor = { _lattice: { drawKind: 'select' } };
  });
  afterEach(() => document.dispatchEvent(new CustomEvent('editorTabChanged', { detail: { tab: 'artwork' } })));

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('tags every real section with its declared kind, on BOTH panels, and leaves non-sections alone', () => {
    initLatticeSideColumn(editor);
    // AMEND 1 inserts a new (untagged -- no bold-span first child) icon
    // row: right after the (hidden) old Add div in the Lattice panel
    // (which HAS one to hide, found by its own stable id -- T81 item 4 --
    // not by DOM order, so this holds regardless of where Add sits relative
    // to Seed/Fill seed, both ALSO `[data-no-collapse]`), and as the very
    // first child of the Shape Lattice panel (which has no Add row at all).
    // phase 4: the sections now sit in their panel's collapse tree, so each kind is read by the section's title
    const kindsOf = (bodyId) => Object.fromEntries([...document.getElementById(bodyId).querySelectorAll('[data-lattice-section]')]
      .map((c) => [c.firstElementChild.textContent.trim(), c.dataset.latticeSection]));
    expect(kindsOf('editorLatticePanelBody')).toEqual({ Seed: 'neutral', 'Grid & rails': 'rails', Ties: 'ties', Nodes: 'nodes', Colors: 'neutral', Widths: 'neutral', Add: 'neutral' });
    // T81 item 2: Boundary is its own 'boundary' kind, not an alias for Shape's 'contour'
    expect(kindsOf('editorShapeLatticePanelBody')).toEqual({ Shape: 'contour', Segments: 'neutral', 'Grid & rails': 'rails', Ties: 'ties', Nodes: 'nodes',
      Colors: 'neutral', Widths: 'neutral', Boundary: 'boundary', 'Fill seed': 'neutral' });
  });

  it("T81 item 4 (Fred screenshot: the OLD 'Add [Rail|Tie|Node]' row was still visible alongside the new icon row): the REAL Add row is hidden even though Seed ALSO carries data-no-collapse and comes first in the DOM", () => {
    initLatticeSideColumn(editor);
    const latticeBody = document.getElementById('editorLatticePanelBody');
    const addRow = document.getElementById('latticeAddKindGroup').closest('[data-no-collapse]');
    expect(addRow.style.display).toBe('none');
    // non-vacuous: Seed is a DIFFERENT [data-no-collapse] element, earlier
    // in the DOM, and must NOT be the one a bare attribute-only query would
    // have matched first -- it stays exactly as the fixture declared it.
    const seedRow = Array.from(latticeBody.children).find((c) => c.textContent.trim() === 'Seed');
    expect(seedRow).not.toBe(addRow);
    expect(seedRow.style.display).not.toBe('none');
    // the new icon row lands right after the (now-hidden) Add row, not
    // after Seed.
    expect(addRow.nextElementSibling.className).toBe('lattice-icon-tool-row');
  });

  it('hides the Shape Lattice "Fill seed" section only — the box Lattice Seed section stays visible', () => {
    initLatticeSideColumn(editor);
    const shapeBody = document.getElementById('editorShapeLatticePanelBody');
    const fillSeedSection = Array.from(shapeBody.children).find((c) => c.textContent.includes('Fill seed'));
    expect(fillSeedSection.style.display).toBe('none');

    // .startsWith, not an exact match: UI3's own collapsible chevron is
    // now appended INTO the label span, so a real Seed section's
    // textContent reads "Seed▾", not "Seed" — matches how any OTHER
    // title-text lookup made after collapsibility is wired must cope too.
    const latticeBody = document.getElementById('editorLatticePanelBody');
    const seedSection = Array.from(latticeBody.children).find((c) => c.textContent.trim().startsWith('Seed'));
    expect(seedSection.style.display).not.toBe('none');
  });

  it('sets --kind-rails/-ties/-nodes on the panel body from the REAL swatch colours, and fixed --kind-contour/--kind-boundary', () => {
    initLatticeSideColumn(editor);
    const body = document.getElementById('editorLatticePanelBody');
    expect(body.style.getPropertyValue('--kind-rails')).toBe('rgb(198, 40, 40)');
    expect(body.style.getPropertyValue('--kind-ties')).toBe('rgb(249, 200, 14)');
    expect(body.style.getPropertyValue('--kind-nodes')).toBe('rgb(26, 35, 126)');
    expect(body.style.getPropertyValue('--kind-contour')).toBe('rgb(46, 125, 50)');
    // T81 item 2: Boundary's own colour is the dashed-black guide's
    // (editor-guides.js GUIDE_STROKE) -- distinct from Contour's green.
    expect(body.style.getPropertyValue('--kind-boundary')).toBe('rgb(0, 0, 0)');
    expect(body.style.getPropertyValue('--kind-boundary')).not.toBe(body.style.getPropertyValue('--kind-contour'));
  });

  it('a colour change on the swatch (a real production write: swatchEl.style.background = ...) updates the CSS var live', () => {
    initLatticeSideColumn(editor);
    const swatch = document.getElementById('latticeColorRails');
    const body = document.getElementById('editorLatticePanelBody');
    swatch.style.background = 'rgb(10, 20, 30)';
    return new Promise((resolve) => {
      // MutationObserver callbacks run as a microtask — flush before asserting.
      queueMicrotask(() => {
        expect(body.style.getPropertyValue('--kind-rails')).toBe('rgb(10, 20, 30)');
        resolve();
      });
    });
  });

  it('DESKTOP: switching to lattice mode mounts Generate/body/Detach into #editorLayersPanel in the right order, and hides the original panel', () => {
    initLatticeSideColumn(editor);
    fireModeChanged(editor, 'lattice');

    const layersPanel = document.getElementById('editorLayersPanel');
    const ids = Array.from(layersPanel.children).map((c) => c.id || c.className);
    // UI2-FIX: Generate mounts wrapped in its own opaque pinned-slot div
    // (a plain rectangle so scrolled content can't peek through the
    // button's own rounded corners) rather than as a bare direct child.
    // UI4 AMEND 4b: the slot ALSO carries `sticky-actions`, the one
    // shared pinned-action style (also on the main sidebar's own card).
    expect(ids).toEqual(['lattice-side-column-pinned-slot sticky-actions', 'layers-header', 'editorLayersList', 'editorLatticePanelBody', 'latticeUnprotectAll']);
    expect(document.getElementById('latticeGenerate').parentElement.className).toBe('lattice-side-column-pinned-slot sticky-actions');

    expect(document.getElementById('editorLatticePanel').style.display).toBe('none');
  });

  it('DESKTOP: switching AWAY from lattice unmounts everything back to its own panel, in its original order', () => {
    initLatticeSideColumn(editor);
    fireModeChanged(editor, 'lattice');
    fireModeChanged(editor, 'select');

    const layersPanel = document.getElementById('editorLayersPanel');
    const ids = Array.from(layersPanel.children).map((c) => c.id || c.className);
    expect(ids).toEqual(['layers-header', 'editorLayersList']);

    const panel = document.getElementById('editorLatticePanel');
    expect(panel.style.display).toBe('');
    const panelChildIds = Array.from(panel.children).map((c) => c.id);
    expect(panelChildIds).toEqual(['editorLatticePanelHeader', 'editorLatticePanelBody', 'editorLatticePanelFooter']);
    const footerChildIds = Array.from(document.getElementById('editorLatticePanelFooter').children).map((c) => c.id);
    expect(footerChildIds).toEqual(['latticeGenerate', 'latticeUnprotectAll']);
  });

  it('DESKTOP: switching from lattice directly to shapeLattice unmounts the first tool before mounting the second (never both at once)', () => {
    initLatticeSideColumn(editor);
    fireModeChanged(editor, 'lattice');
    fireModeChanged(editor, 'shapeLattice');

    const layersPanel = document.getElementById('editorLayersPanel');
    const ids = Array.from(layersPanel.children).map((c) => c.id || c.className);
    expect(ids).toEqual(['lattice-side-column-pinned-slot sticky-actions', 'layers-header', 'editorLayersList', 'editorShapeLatticePanelBody', 'shapeLatticeUnprotectAll']);
    expect(document.getElementById('shapeLatticeGenerate').parentElement.className).toBe('lattice-side-column-pinned-slot sticky-actions');
    expect(document.getElementById('editorLatticePanel').style.display).toBe('');
    expect(document.getElementById('editorShapeLatticePanel').style.display).toBe('none');
  });

  // the Art tabs (Fred: "what's stripe and brick?"): the drawer's tool | panel tab pair is retired, so a phone mounts the
  // tool's settings under Layers exactly as desktop does (inverts the former "MOBILE: never mounts")
  it('MOBILE too: a mode change mounts exactly as on desktop (the drawer\'s tab pair is retired)', () => {
    initLatticeSideColumn(editor);
    fireModeChanged(editor, 'lattice');
    const layersPanel = document.getElementById('editorLayersPanel');
    const desktopIds = Array.from(layersPanel.children).map((c) => c.id || c.className);
    fireModeChanged(editor, 'select');
    setDesktop(false);
    fireModeChanged(editor, 'lattice');
    expect(Array.from(layersPanel.children).map((c) => c.id || c.className)).toEqual(desktopIds);
    expect(layersPanel.contains(document.getElementById('editorLatticePanelBody'))).toBe(true);
    expect(document.getElementById('editorLatticePanel').style.display).toBe('none');
  });

  it('a resize crossing INTO mobile while a tool is mounted keeps it mounted (inverted: was "unmounts it back")', () => {
    initLatticeSideColumn(editor);
    fireModeChanged(editor, 'lattice');
    setDesktop(false);
    window.dispatchEvent(new Event('resize'));
    expect(document.getElementById('editorLayersPanel').contains(document.getElementById('editorLatticePanelBody'))).toBe(true);
  });

  it('a panel with a pinned head ([data-panel-head], the Art tabs) takes Generate into it -- one pinned block -- and gives it back', () => {
    const layersPanel = document.getElementById('editorLayersPanel');
    const head = document.createElement('div');
    head.setAttribute('data-panel-head', '');
    head.className = 'sticky-actions';
    layersPanel.insertBefore(head, layersPanel.firstChild);
    initLatticeSideColumn(editor);
    fireModeChanged(editor, 'lattice');
    expect(document.getElementById('latticeGenerate').parentElement).toBe(head);
    expect(layersPanel.querySelectorAll('.sticky-actions').length).toBe(1);
    fireModeChanged(editor, 'select');
    expect(document.getElementById('latticeGenerate').parentElement.id).toBe('editorLatticePanelFooter');
    expect(layersPanel.firstElementChild).toBe(head);
  });

  it('an editorModeChanged event for a DIFFERENT editor instance is ignored', () => {
    initLatticeSideColumn(editor);
    fireModeChanged({ notTheSameEditor: true }, 'lattice');

    const layersPanel = document.getElementById('editorLayersPanel');
    const ids = Array.from(layersPanel.children).map((c) => c.id || c.className);
    expect(ids).toEqual(['layers-header', 'editorLayersList']);
  });
});

// Fred (2026-10-04): "Generate in the Brick tab makes a lattice". The Brick tab shows
// #editorLayersPanel while no brick tool is picked, and the editor mode can stay 'shapeLattice'
// across the tab switch -- so the pinned lattice Generate sat exactly where the Brick tab's own
// Generate appears. A lattice mount is scoped to its declared tab (TOOL_PANEL_MOUNTS[mode].tab).
describe('lattice mounts are scoped to the Lattice tab (redesign phase 2; it was Artwork)', () => {
  let editor;
  const fireTab = (tab) => document.dispatchEvent(new CustomEvent('editorTabChanged', { detail: { tab } }));
  beforeEach(() => {
    buildFixture();
    setDesktop(true);
    editor = { _lattice: { drawKind: 'select' } };
    initLatticeSideColumn(editor);
    fireTab('lattice');
  });
  afterEach(() => {
    fireTab('artwork'); // module-level tab state: leave it at the default for every other test
    document.body.innerHTML = '';
  });

  it.each(['lattice', 'shapeLattice'])('%s: leaving Lattice unmounts its Generate from #editorLayersPanel and hides its own panel', (mode) => {
    const generateId = mode === 'lattice' ? 'latticeGenerate' : 'shapeLatticeGenerate';
    const panelId = mode === 'lattice' ? 'editorLatticePanel' : 'editorShapeLatticePanel';
    fireModeChanged(editor, mode);
    const layersPanel = document.getElementById('editorLayersPanel');
    expect(layersPanel.contains(document.getElementById(generateId))).toBe(true);

    fireTab('brick');
    expect(layersPanel.contains(document.getElementById(generateId))).toBe(false);
    expect(layersPanel.querySelector('.sticky-actions')).toBeNull();
    expect(Array.from(layersPanel.children).map((c) => c.id || c.className)).toEqual(['layers-header', 'editorLayersList']);
    expect(document.getElementById(panelId).style.display).toBe('none');
  });

  it('a lattice mode entered while another tab is active never mounts', () => {
    fireTab('brick');
    fireModeChanged(editor, 'shapeLattice');
    const layersPanel = document.getElementById('editorLayersPanel');
    expect(layersPanel.contains(document.getElementById('shapeLatticeGenerate'))).toBe(false);
    expect(document.getElementById('editorShapeLatticePanel').style.display).toBe('none');
  });

  it('returning to Lattice re-mounts the pinned Generate', () => {
    fireModeChanged(editor, 'shapeLattice');
    fireTab('brick');
    fireTab('lattice');
    const gen = document.getElementById('shapeLatticeGenerate');
    expect(document.getElementById('editorLayersPanel').contains(gen)).toBe(true);
    expect(gen.parentElement.className).toBe('lattice-side-column-pinned-slot sticky-actions');
    expect(document.getElementById('editorShapeLatticePanel').style.display).toBe('none');
  });

  // Fred (phone, Frame tab): "if I'm in frame the panel should show the frame settings not the vectors" -- carried by the
  // drawer's tab pair until the Art tabs retired it; the mount keeps it on every viewport (was editor-drawer.test.js)
  it.each([true, false])('Frame tab (desktop %s): the tool panel is hidden and nothing is mounted; back in Lattice it returns', (desk) => {
    setDesktop(desk);
    fireModeChanged(editor, 'shapeLattice');
    fireTab('frame');
    const layersPanel = document.getElementById('editorLayersPanel');
    expect(layersPanel.contains(document.getElementById('editorShapeLatticePanelBody'))).toBe(false);
    expect(document.getElementById('editorShapeLatticePanel').style.display).toBe('none');
    fireTab('lattice');
    expect(layersPanel.contains(document.getElementById('editorShapeLatticePanelBody'))).toBe(true);
  });

  it('back in Lattice in a non-lattice mode, the lattice panels get no inline override (editor-ui.js decides)', () => {
    fireModeChanged(editor, 'shapeLattice');
    fireTab('brick');
    fireModeChanged(editor, 'select');
    fireTab('lattice');
    expect(document.getElementById('editorShapeLatticePanel').style.display).toBe('');
    expect(document.getElementById('editorLatticePanel').style.display).toBe('');
  });
});

// UI3 (Fred: "like in main side bar, make lattice section collapsible") -> redesign phase 4: each lattice tool's panel is
// ONE collapse tree (editor/lattice-side-column.js LATTICE_DRAWER_TREES on main/drawer-tree.js): still foldable, now as
// the tree every editor tab uses. The Layers label and the Shape / Segments sub-blocks keep UI3's own fold.
const SECTION_STATE_PREFIX = 'bspline.editor.drawerSection.';
const branchOf = (prefix, id) => document.getElementById(`${prefix}${id}`);
const isOpenB = (prefix, id) => branchOf(prefix, id).classList.contains('open');

describe('phase 4: each lattice panel is a collapse tree', () => {
  beforeEach(() => { buildFixture(); setDesktop(true); localStorage.clear(); });
  afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

  it('the declared branches hold their sections; Look holds Colors and Widths (one branch, advisor 2026-10-15)', () => {
    initLatticeSideColumn({ _lattice: { drawKind: 'select' } });
    expect(LATTICE_DRAWER_TREES.lattice.branches.map((b) => b.id)).toEqual(['boundary', 'rails', 'ties', 'nodes', 'look']);
    expect(branchOf('latticeBranch_', 'ties').contains(document.getElementById('latticeSec_ties'))).toBe(true);
    for (const id of ['latticeSec_colors', 'latticeSec_widths']) expect(branchOf('latticeBranch_', 'look').contains(document.getElementById(id)), id).toBe(true);
  });
  it('a one-section branch hides the section\'s own title (the branch says it); Look keeps its two titles', () => {
    initLatticeSideColumn({ _lattice: { drawKind: 'select' } });
    expect(document.getElementById('latticeSec_ties').firstElementChild.classList.contains('drawer-host-title')).toBe(true);
    expect(document.getElementById('latticeSec_colors').firstElementChild.classList.contains('drawer-host-title')).toBe(false);
  });
  it('desktop: every branch starts open; the caret folds one and the open set is remembered', () => {
    initLatticeSideColumn({ _lattice: { drawKind: 'select' } });
    expect(isOpenB('latticeBranch_', 'ties')).toBe(true);
    branchOf('latticeBranch_', 'ties').querySelector('.drawer-branch-caret').click();
    expect(isOpenB('latticeBranch_', 'ties')).toBe(false);
    expect(JSON.parse(localStorage.getItem(LATTICE_DRAWER_TREES.lattice.openKey))).not.toContain('ties');
  });
  it('Add (the icon row) and the hidden Seed stay out of the tree', () => {
    initLatticeSideColumn({ _lattice: { drawKind: 'select' } });
    const tree = document.getElementById(LATTICE_DRAWER_TREES.lattice.treeId);
    for (const n of document.querySelectorAll('#editorLatticePanelBody [data-no-collapse]')) expect(tree.contains(n)).toBe(false);
  });
  it('the Layers block keeps its own fold, and never disturbs #editorAddLayer\'s own click handler', () => {
    const addLayerSpy = vi.fn();
    document.getElementById('editorAddLayer').addEventListener('click', addLayerSpy);
    initLatticeSideColumn({ _lattice: { drawKind: 'select' } });
    const label = document.querySelector('#editorLayersPanel .layers-header span');
    const list = document.getElementById('editorLayersList');
    label.click();
    expect(list.style.display).toBe('none');
    expect(localStorage.getItem(SECTION_STATE_PREFIX + 'Layers')).toBe('0');
    document.getElementById('editorAddLayer').click();
    expect(addLayerSpy).toHaveBeenCalledTimes(1);
  });
});

// Item 13 (Fred: the Shape Lattice panel was ~4 screens tall on a phone): its rarely used Boundary and Look (Widths)
// start folded on a phone; the Shape / Segments sub-blocks fold under their own keys (UI3's fold, unchanged); desktop
// and the box Lattice keep everything open.
describe('Item 13 -- the Shape Lattice tree folds its rarely used branches on a phone', () => {
  const addSegmentsBlock = () => {
    const body = document.getElementById('editorShapeLatticePanelBody');
    body.insertAdjacentHTML('beforeend', `
      <div id="shapeSec_contour"><span style="font-weight:600;">Contour</span>
        <div id="shapeLatticeShapeBlock"><span>Shape</span>
          <div id="shapeLatticeShapeFoldBody" style="display:flex;"><button id="shapePresetHourglass"></button></div>
        </div>
        <div id="shapeLatticeSegmentsBlock"><span>Segments</span>
          <div id="shapeLatticeSegmentsFoldBody" style="display:flex;"><select id="shapeSegmentIndex"></select></div>
        </div>
      </div>`);
  };
  beforeEach(() => { buildFixture(); addSegmentsBlock(); localStorage.clear(); });
  afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

  it('on a phone: Boundary and Look start folded, the everyday branches open; the box Lattice keeps all open', () => {
    setDesktop(false);
    initLatticeSideColumn({ _lattice: { drawKind: 'select' } });
    expect(LATTICE_DRAWER_TREES.shapeLattice.foldedOnPhone).toEqual(['boundary', 'look']);
    expect(isOpenB('shapeLatticeBranch_', 'boundary')).toBe(false);
    expect(isOpenB('shapeLatticeBranch_', 'look')).toBe(false);
    expect(isOpenB('shapeLatticeBranch_', 'ties')).toBe(true);
    expect(isOpenB('latticeBranch_', 'look')).toBe(true);
    // the sub-blocks keep UI3's own fold, under their own keys
    const shapeFold = document.getElementById('shapeLatticeShapeFoldBody');
    expect(shapeFold.style.display).toBe('none');
    document.querySelector('#shapeLatticeShapeBlock > span').click();
    expect(shapeFold.style.display).toBe('flex');
    expect(localStorage.getItem(SECTION_STATE_PREFIX + 'shapeLattice.Shape')).toBe('1');
    const foldBody = document.getElementById('shapeLatticeSegmentsFoldBody');
    expect(foldBody.style.display).toBe('none');
    document.querySelector('#shapeLatticeSegmentsBlock > span').click();
    expect(foldBody.style.display).toBe('flex');
  });
  it('on desktop every branch starts open, as before', () => {
    setDesktop(true);
    initLatticeSideColumn({ _lattice: { drawKind: 'select' } });
    for (const id of ['boundary', 'look', 'ties']) expect(isOpenB('shapeLatticeBranch_', id), id).toBe(true);
    expect(document.getElementById('shapeLatticeSegmentsFoldBody').style.display).toBe('flex');
  });
  it('a remembered open set wins over the phone default', () => {
    setDesktop(false);
    localStorage.setItem(LATTICE_DRAWER_TREES.shapeLattice.openKey, JSON.stringify(['boundary', 'ties']));
    initLatticeSideColumn({ _lattice: { drawKind: 'select' } });
    expect(isOpenB('shapeLatticeBranch_', 'boundary')).toBe(true);
    expect(isOpenB('shapeLatticeBranch_', 'nodes')).toBe(false);
  });
});

describe('UI3 AMEND 1/2 — icon tool row replacing Add', () => {
  beforeEach(() => {
    buildFixture();
    setDesktop(true);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('hides the OLD Add row and inserts a new data-no-collapse icon row with 4 buttons in the Lattice panel', () => {
    const editor = { _lattice: { drawKind: 'select' } };
    initLatticeSideColumn(editor);
    const body = document.getElementById('editorLatticePanelBody');
    const oldAddRow = document.getElementById('latticeAddKindGroup').closest('[data-no-collapse]');
    expect(oldAddRow.style.display).toBe('none');

    const iconRow = oldAddRow.nextElementSibling;
    expect(iconRow.dataset.noCollapse).toBe('');
    const buttons = iconRow.querySelectorAll('button.tool-btn');
    expect(buttons.length).toBe(4);
    expect(buttons[0].title).toMatch(/Select/);
    expect(buttons[1].title).toMatch(/rail axis/i);
    expect(buttons[2].title).toMatch(/snaps to them/i);
    expect(buttons[3].title).toMatch(/place a node/i);
  });

  it('T80 item 2: the Shape Lattice panel gets the same [Select][Rail][Tie][Node] icon row as the box Lattice', () => {
    const editor = { _lattice: { drawKind: 'select' } };
    initLatticeSideColumn(editor);
    const shapeBody = document.getElementById('editorShapeLatticePanelBody');
    const iconRow = shapeBody.firstElementChild;
    expect(iconRow.dataset.noCollapse).toBe('');
    const titles = (row) => Array.from(row.querySelectorAll('button.tool-btn')).map((b) => b.title);
    const boxRow = document.getElementById('latticeAddKindGroup').closest('[data-no-collapse]').nextElementSibling;
    expect(titles(iconRow).length).toBe(4);
    expect(titles(iconRow)).toEqual(titles(boxRow));
  });

  it('T80 item 2: a pick in the Shape Lattice row proxy-clicks the one latticeAdd-* button and shows in BOTH rows (one shared drawKind)', () => {
    const editor = { _lattice: { drawKind: 'select' } };
    initLatticeSideColumn(editor);
    const shapeRow = document.getElementById('editorShapeLatticePanelBody').firstElementChild;
    const boxRow = document.getElementById('latticeAddKindGroup').closest('[data-no-collapse]').nextElementSibling;
    const proxied = vi.fn();
    document.getElementById('latticeAdd-tie').addEventListener('click', proxied);
    shapeRow.querySelectorAll('button.tool-btn')[2].click();
    expect(proxied).toHaveBeenCalledTimes(1);
    const actives = (row) => Array.from(row.querySelectorAll('button.tool-btn')).map((b) => b.classList.contains('active'));
    expect(actives(shapeRow)).toEqual([false, false, true, false]);
    expect(actives(boxRow)).toEqual([false, false, true, false]);
  });

  it('Select starts active (LATTICE_DEFAULTS\' new default), matching editor._lattice.drawKind at init', () => {
    const editor = { _lattice: { drawKind: 'select' } };
    initLatticeSideColumn(editor);
    const body = document.getElementById('editorLatticePanelBody');
    const iconRow = document.getElementById('latticeAddKindGroup').closest('[data-no-collapse]').nextElementSibling;
    const [selectBtn, railBtn] = iconRow.querySelectorAll('button.tool-btn');
    expect(selectBtn.classList.contains('active')).toBe(true);
    expect(railBtn.classList.contains('active')).toBe(false);
  });

  it('clicking Rail proxy-clicks the ORIGINAL hidden latticeAdd-rail button (properties-lattice.js stays the one place drawKind is written) and updates its own active state', () => {
    const editor = { _lattice: { drawKind: 'select' } };
    initLatticeSideColumn(editor);
    const oldRailBtn = document.getElementById('latticeAdd-rail');
    const raiSpy = vi.fn();
    oldRailBtn.addEventListener('click', raiSpy);

    const iconRow = oldRailBtn.closest('[data-no-collapse]').nextElementSibling;
    const [selectBtn, railBtn] = iconRow.querySelectorAll('button.tool-btn');
    railBtn.click();

    expect(raiSpy).toHaveBeenCalledTimes(1);
    expect(railBtn.classList.contains('active')).toBe(true);
    expect(selectBtn.classList.contains('active')).toBe(false);
  });

  it('clicking Select sets editor._lattice.drawKind = \'select\' directly (no old button to proxy), overriding whichever kind was previously active', () => {
    // Simulates "rail was already the active add-kind" (e.g. from an
    // earlier real Rail click) directly, rather than via the fixture's
    // inert old button (properties-lattice.js's real selectDrawKind
    // wiring — the thing that would actually flip drawKind on a rail
    // click — isn't loaded in this DOM-only fixture; that proxy-click
    // itself is covered by the dedicated test above).
    const editor = { _lattice: { drawKind: 'rail' } };
    initLatticeSideColumn(editor);
    const oldRailBtn = document.getElementById('latticeAdd-rail');
    const iconRow = oldRailBtn.closest('[data-no-collapse]').nextElementSibling;
    const [selectBtn, railBtn] = iconRow.querySelectorAll('button.tool-btn');
    expect(railBtn.classList.contains('active')).toBe(true); // reflects drawKind at init

    selectBtn.click();
    expect(editor._lattice.drawKind).toBe('select');
    expect(selectBtn.classList.contains('active')).toBe(true);
    expect(railBtn.classList.contains('active')).toBe(false);
  });

  it('the Rail/Tie icon glyphs read the SAME --kind-rails/--kind-ties CSS custom properties _wireLiveColors keeps live-synced (one colour-sync mechanism, not a second)', () => {
    const editor = { _lattice: { drawKind: 'select' } };
    initLatticeSideColumn(editor);
    const iconRow = document.getElementById('latticeAddKindGroup').closest('[data-no-collapse]').nextElementSibling;
    const [, railBtn, tieBtn] = iconRow.querySelectorAll('button.tool-btn');
    expect(railBtn.innerHTML).toContain('var(--kind-rails');
    expect(tieBtn.innerHTML).toContain('var(--kind-ties');
  });

  it('the Node icon glyph is a plain dot (not the ladder), in --kind-nodes', () => {
    const editor = { _lattice: { drawKind: 'select' } };
    initLatticeSideColumn(editor);
    const iconRow = document.getElementById('latticeAddKindGroup').closest('[data-no-collapse]').nextElementSibling;
    const [, , , nodeBtn] = iconRow.querySelectorAll('button.tool-btn');
    expect(nodeBtn.innerHTML).toContain('<circle');
    expect(nodeBtn.innerHTML).not.toContain('<line');
    expect(nodeBtn.innerHTML).toContain('var(--kind-nodes');
  });
});

// The Art tabs: Artwork's Stripe settings mount under Layers like the lattice tools; the Brick tab hosts the SAME body in
// its Stripe section (main/editor-tabs.js modeHosts) -- the mount must never pull it out of that host.
describe('Artwork Stripe mounts under Layers; the Brick tab keeps its hosted body', () => {
  let editor;
  const fireTab = (tab) => document.dispatchEvent(new CustomEvent('editorTabChanged', { detail: { tab } }));
  beforeEach(() => {
    buildFixture();
    document.body.insertAdjacentHTML('beforeend', `<aside id="editorStripePanel"><div id="editorStripePanelBody"><span>Stripe</span></div></aside>
      <div id="brickStripeSection"></div>`);
    setDesktop(true);
    editor = { _lattice: { drawKind: 'select' } };
    initLatticeSideColumn(editor);
  });
  afterEach(() => { fireTab('artwork'); fireModeChanged(editor, 'select'); document.body.innerHTML = ''; });

  // advisor: a phone reaches EVERY Artwork tool's settings after the tab pair's removal (900 px = the mobile bucket)
  it.each([['lattice', 'editorLatticePanelBody'], ['shapeLattice', 'editorShapeLatticePanelBody'], ['stripe', 'editorStripePanelBody']])(
    'PHONE: %s opens its settings under Layers (the only place the drawer shows)', (mode, body) => {
      setDesktop(false);
      fireTab(mode === 'stripe' ? 'artwork' : 'lattice'); // phase 2: lattice tools in the Lattice tab; Stripe in both
      fireModeChanged(editor, mode);
      expect(document.getElementById('editorLayersPanel').contains(document.getElementById(body))).toBe(true);
    });
  it('Lattice + stripe too (the shared tool set): the body sits under Layers', () => {
    fireTab('lattice');
    fireModeChanged(editor, 'stripe');
    expect(document.getElementById('editorLayersPanel').contains(document.getElementById('editorStripePanelBody'))).toBe(true);
  });
  it('Artwork + stripe: the body sits under Layers, the panel is hidden', () => {
    fireModeChanged(editor, 'stripe');
    expect(document.getElementById('editorLayersPanel').contains(document.getElementById('editorStripePanelBody'))).toBe(true);
    expect(document.getElementById('editorStripePanel').style.display).toBe('none');
  });
  it('switching to Brick: its host took the body (modeHosts runs first) -- the unmount leaves it there', () => {
    fireModeChanged(editor, 'stripe');
    document.getElementById('brickStripeSection').appendChild(document.getElementById('editorStripePanelBody')); // modeHosts
    fireTab('brick');
    expect(document.getElementById('editorStripePanelBody').parentElement.id).toBe('brickStripeSection');
  });
  it('back to Artwork (modeHosts sent the body home first): it mounts under Layers again', () => {
    fireModeChanged(editor, 'stripe');
    fireTab('brick');
    document.getElementById('editorStripePanel').appendChild(document.getElementById('editorStripePanelBody')); // modeHosts: home
    fireTab('artwork');
    expect(document.getElementById('editorLayersPanel').contains(document.getElementById('editorStripePanelBody'))).toBe(true);
  });
});
