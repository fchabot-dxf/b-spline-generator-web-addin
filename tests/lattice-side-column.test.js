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
} from '../bspline-frame-builder/b-spline-gen/html/editor/lattice-side-column.js';

describe('sectionKindForTitle / SECTION_KIND_BY_TITLE', () => {
  it('maps every declared title to its kind', () => {
    expect(sectionKindForTitle('Grid & rails')).toBe('rails');
    expect(sectionKindForTitle('Ties')).toBe('ties');
    expect(sectionKindForTitle('Nodes')).toBe('nodes');
    expect(sectionKindForTitle('Contour')).toBe('contour');
    expect(sectionKindForTitle('Border')).toBe('contour');
    expect(sectionKindForTitle('Shape')).toBe('contour');
    expect(sectionKindForTitle('Boundary')).toBe('contour');
  });

  it('falls through to neutral for anything not declared (Add, Colors, Widths, Seed, Fill seed, ...)', () => {
    for (const title of ['Add', 'Colors', 'Widths', 'Seed', 'Fill seed', 'Segments', 'gibberish']) {
      expect(sectionKindForTitle(title)).toBe('neutral');
    }
  });

  it('is whitespace-tolerant (a title read from live textContent may carry incidental whitespace)', () => {
    expect(sectionKindForTitle('  Ties  ')).toBe('ties');
  });

  it('every value in the declared map is one of the 4 real kinds (no typo silently creating a 5th)', () => {
    const validKinds = new Set(['rails', 'ties', 'nodes', 'contour']);
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
// the panel/body/footer/generate/detachAll ids it looks up by id, and
// the layers panel's own header+list.
// ---------------------------------------------------------------------
function section(title, extraHtml = '') {
  return `<div><span style="font-weight:600;">${title}</span>${extraHtml}</div>`;
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
        <div data-no-collapse>
          <span style="font-weight:600;">Add</span>
          <div role="group" id="latticeAddKindGroup" class="segmented-group">
            <button type="button" id="latticeAdd-rail" class="editor-fillmode-btn active">Rail</button>
            <button type="button" id="latticeAdd-tie" class="editor-fillmode-btn">Tie</button>
            <button type="button" id="latticeAdd-node" class="editor-fillmode-btn">Node</button>
          </div>
        </div>
        ${section('Grid & rails')}
        ${section('Ties')}
        ${section('Nodes')}
        ${section('Colors', '<button id="latticeColorRails" style="background:#c62828;"></button><button id="latticeColorTies" style="background:#f9c80e;"></button><button id="latticeColorNodes" style="background:#1a237e;"></button>')}
        ${section('Widths')}
        ${section('Seed')}
      </div>
      <div id="editorLatticePanelFooter">
        <button id="latticeGenerate">Generate</button>
        <button id="latticeDetachAll">Detach all</button>
      </div>
    </aside>
    <aside id="editorShapeLatticePanel">
      <div id="editorShapeLatticePanelHeader"><span>Shape Lattice</span></div>
      <div id="editorShapeLatticePanelBody">
        ${section('Shape')}
        ${section('Segments')}
        ${section('Grid & rails')}
        ${section('Ties')}
        ${section('Nodes')}
        ${section('Colors', '<button id="shapeLatticeColorRails" style="background:#c62828;"></button><button id="shapeLatticeColorTies" style="background:#f9c80e;"></button><button id="shapeLatticeColorNodes" style="background:#1a237e;"></button>')}
        ${section('Widths')}
        ${section('Boundary')}
        ${section('Fill seed', '<input id="shapeLatticeSeed">')}
      </div>
      <div id="editorShapeLatticePanelFooter">
        <button id="shapeLatticeGenerate">Generate</button>
        <button id="shapeLatticeDetachAll">Detach all</button>
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
    buildFixture();
    setDesktop(true);
    // UI3 AMEND 1: initLatticeSideColumn now reads editor._lattice.drawKind
    // (to seed the new icon row's initial active state) — a real editor
    // instance always has this (editor.js's own constructor), so the
    // fixture matches that shape rather than making production code
    // defensively handle an impossible-in-practice bare `{}`.
    editor = { _lattice: { drawKind: 'select' } };
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('tags every real section with its declared kind, on BOTH panels, and leaves non-sections alone', () => {
    initLatticeSideColumn(editor);
    // AMEND 1 inserts a new (untagged -- no bold-span first child) icon
    // row: right after the (hidden) old Add div in the Lattice panel
    // (which HAS one to hide), and as the very first child of the Shape
    // Lattice panel (which has none).
    const latticeBody = document.getElementById('editorLatticePanelBody');
    const kinds = Array.from(latticeBody.children).map((c) => c.dataset.latticeSection);
    expect(kinds).toEqual(['neutral', undefined, 'rails', 'ties', 'nodes', 'neutral', 'neutral', 'neutral']);

    const shapeBody = document.getElementById('editorShapeLatticePanelBody');
    const shapeKinds = Array.from(shapeBody.children).map((c) => c.dataset.latticeSection);
    expect(shapeKinds).toEqual([undefined, 'contour', 'neutral', 'rails', 'ties', 'nodes', 'neutral', 'neutral', 'contour', 'neutral']);
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

  it('sets --kind-rails/-ties/-nodes on the panel body from the REAL swatch colours, and a fixed --kind-contour', () => {
    initLatticeSideColumn(editor);
    const body = document.getElementById('editorLatticePanelBody');
    expect(body.style.getPropertyValue('--kind-rails')).toBe('rgb(198, 40, 40)');
    expect(body.style.getPropertyValue('--kind-ties')).toBe('rgb(249, 200, 14)');
    expect(body.style.getPropertyValue('--kind-nodes')).toBe('rgb(26, 35, 126)');
    expect(body.style.getPropertyValue('--kind-contour')).toBe('rgb(46, 125, 50)');
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
    expect(ids).toEqual(['lattice-side-column-pinned-slot', 'layers-header', 'editorLayersList', 'editorLatticePanelBody', 'latticeDetachAll']);
    expect(document.getElementById('latticeGenerate').parentElement.className).toBe('lattice-side-column-pinned-slot');

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
    expect(footerChildIds).toEqual(['latticeGenerate', 'latticeDetachAll']);
  });

  it('DESKTOP: switching from lattice directly to shapeLattice unmounts the first tool before mounting the second (never both at once)', () => {
    initLatticeSideColumn(editor);
    fireModeChanged(editor, 'lattice');
    fireModeChanged(editor, 'shapeLattice');

    const layersPanel = document.getElementById('editorLayersPanel');
    const ids = Array.from(layersPanel.children).map((c) => c.id || c.className);
    expect(ids).toEqual(['lattice-side-column-pinned-slot', 'layers-header', 'editorLayersList', 'editorShapeLatticePanelBody', 'shapeLatticeDetachAll']);
    expect(document.getElementById('shapeLatticeGenerate').parentElement.className).toBe('lattice-side-column-pinned-slot');
    expect(document.getElementById('editorLatticePanel').style.display).toBe('');
    expect(document.getElementById('editorShapeLatticePanel').style.display).toBe('none');
  });

  it('MOBILE: a mode change never mounts anything — the drawer\'s own tab mechanism stays in sole control', () => {
    setDesktop(false);
    initLatticeSideColumn(editor);
    fireModeChanged(editor, 'lattice');

    const layersPanel = document.getElementById('editorLayersPanel');
    const ids = Array.from(layersPanel.children).map((c) => c.id || c.className);
    expect(ids).toEqual(['layers-header', 'editorLayersList']);
    expect(document.getElementById('editorLatticePanel').style.display).toBe('');
  });

  it('a resize crossing INTO mobile while a tool is mounted unmounts it back', () => {
    initLatticeSideColumn(editor);
    fireModeChanged(editor, 'lattice');
    setDesktop(false);
    window.dispatchEvent(new Event('resize'));

    const layersPanel = document.getElementById('editorLayersPanel');
    const ids = Array.from(layersPanel.children).map((c) => c.id || c.className);
    expect(ids).toEqual(['layers-header', 'editorLayersList']);
  });

  it('an editorModeChanged event for a DIFFERENT editor instance is ignored', () => {
    initLatticeSideColumn(editor);
    fireModeChanged({ notTheSameEditor: true }, 'lattice');

    const layersPanel = document.getElementById('editorLayersPanel');
    const ids = Array.from(layersPanel.children).map((c) => c.id || c.className);
    expect(ids).toEqual(['layers-header', 'editorLayersList']);
  });
});

// UI3 (Fred: "like in main side bar, make lattice section collapsible") —
// same key prefix editor-drawer.js's own former mobile-only mechanism
// declared (bspline.editor.drawerSection.<title>), now wired here on
// BOTH desktop and mobile.
const SECTION_STATE_PREFIX = 'bspline.editor.drawerSection.';

describe('UI3 — collapsible sections', () => {
  beforeEach(() => {
    buildFixture();
    setDesktop(true);
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('a section starts open, and clicking its label collapses it, rotating the chevron and hiding its body', () => {
    initLatticeSideColumn({ _lattice: { drawKind: 'select' } });
    const tiesSection = Array.from(document.getElementById('editorLatticePanelBody').children)
      .find((c) => c.textContent.trim().startsWith('Ties'));
    const label = tiesSection.firstElementChild;
    const chevron = label.querySelector('.lattice-section-chevron');
    expect(chevron.style.transform).toBe('rotate(0deg)');

    label.click();

    expect(chevron.style.transform).toBe('rotate(-90deg)');
    // Every OTHER child of the section (i.e. its body, not the label
    // itself) is hidden -- Ties has no extra body content in the fixture,
    // so this section only proves the label survives untouched; the
    // Layers-list test below proves an actual body element toggling.
    expect(localStorage.getItem(SECTION_STATE_PREFIX + 'Ties')).toBe('0');
  });

  it('clicking a collapsed section again re-expands it and restores its ORIGINAL inline display (not a bare "")', () => {
    initLatticeSideColumn({ _lattice: { drawKind: 'select' } });
    const colorsSection = Array.from(document.getElementById('editorLatticePanelBody').children)
      .find((c) => c.textContent.trim().startsWith('Colors'));
    const label = colorsSection.firstElementChild;
    const swatch = document.getElementById('latticeColorRails');
    const originalDisplay = swatch.style.display; // '' in the fixture -- a real row would carry an inline flex

    label.click(); // collapse
    expect(swatch.style.display).toBe('none');
    label.click(); // re-expand
    expect(swatch.style.display).toBe(originalDisplay);

    expect(localStorage.getItem(SECTION_STATE_PREFIX + 'Colors')).toBe('1');
  });

  it('honours a PRE-EXISTING collapsed state from localStorage on init', () => {
    localStorage.setItem(SECTION_STATE_PREFIX + 'Nodes', '0');
    initLatticeSideColumn({ _lattice: { drawKind: 'select' } });
    const nodesSection = Array.from(document.getElementById('editorLatticePanelBody').children)
      .find((c) => c.textContent.trim().startsWith('Nodes'));
    const chevron = nodesSection.firstElementChild.querySelector('.lattice-section-chevron');
    expect(chevron.style.transform).toBe('rotate(-90deg)');
  });

  it('data-no-collapse sections (the Add wrapper, and AMEND 1\'s new icon row) get no chevron at all', () => {
    initLatticeSideColumn({ _lattice: { drawKind: 'select' } });
    const body = document.getElementById('editorLatticePanelBody');
    const oldAddRow = body.querySelector('[data-no-collapse]');
    expect(oldAddRow.querySelector('.lattice-section-chevron')).toBeNull();
  });

  it('the Layers block is collapsible too, and never disturbs #editorAddLayer\'s own click handler', () => {
    const addLayerSpy = vi.fn();
    document.getElementById('editorAddLayer').addEventListener('click', addLayerSpy);
    initLatticeSideColumn({ _lattice: { drawKind: 'select' } });

    const label = document.querySelector('#editorLayersPanel .layers-header span');
    const list = document.getElementById('editorLayersList');
    label.click();
    expect(list.style.display).toBe('none');
    expect(localStorage.getItem(SECTION_STATE_PREFIX + 'Layers')).toBe('0');

    document.getElementById('editorAddLayer').click();
    expect(addLayerSpy).toHaveBeenCalledTimes(1); // untouched by the label's own click wiring
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

  it('the Shape Lattice panel gets a Select-only icon row (no add modes to offer)', () => {
    const editor = { _lattice: { drawKind: 'select' } };
    initLatticeSideColumn(editor);
    const shapeBody = document.getElementById('editorShapeLatticePanelBody');
    const iconRow = shapeBody.firstElementChild;
    expect(iconRow.dataset.noCollapse).toBe('');
    const buttons = iconRow.querySelectorAll('button.tool-btn');
    expect(buttons.length).toBe(1);
    expect(buttons[0].title).toMatch(/Select/);
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
