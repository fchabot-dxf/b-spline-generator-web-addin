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
        ${section('Add')}
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
    editor = {};
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('tags every real section with its declared kind, on BOTH panels, and leaves non-sections alone', () => {
    initLatticeSideColumn(editor);
    const latticeBody = document.getElementById('editorLatticePanelBody');
    const kinds = Array.from(latticeBody.children).map((c) => c.dataset.latticeSection);
    expect(kinds).toEqual(['neutral', 'rails', 'ties', 'nodes', 'neutral', 'neutral', 'neutral']);

    const shapeBody = document.getElementById('editorShapeLatticePanelBody');
    const shapeKinds = Array.from(shapeBody.children).map((c) => c.dataset.latticeSection);
    expect(shapeKinds).toEqual(['contour', 'neutral', 'rails', 'ties', 'nodes', 'neutral', 'neutral', 'contour', 'neutral']);
  });

  it('hides the Shape Lattice "Fill seed" section only — the box Lattice Seed section stays visible', () => {
    initLatticeSideColumn(editor);
    const shapeBody = document.getElementById('editorShapeLatticePanelBody');
    const fillSeedSection = Array.from(shapeBody.children).find((c) => c.textContent.includes('Fill seed'));
    expect(fillSeedSection.style.display).toBe('none');

    const latticeBody = document.getElementById('editorLatticePanelBody');
    const seedSection = Array.from(latticeBody.children).find((c) => c.textContent.trim() === 'Seed');
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
