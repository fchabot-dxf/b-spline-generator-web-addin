/**
 * Redesign phase 2 (Fred): the editor's Artwork tab is DRAW, and the lattices have their own top-level LATTICE tab. Both
 * edit the same drawing and share the art panel + its tool row; main/editor-tabs.js EDITOR_TABS `artTabs` says which
 * Art tabs (main/art-tabs.js) each shows. The ids stay: editorTabArtwork / 'artwork' (Draw), artTab_lattice / artTab_shape
 * -- picked from Draw (the matrix's, a shortcut's way in) they switch to the Lattice tab first.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EDITOR_TABS, setEditorTab, getEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { ART_TABS, setArtTab, initArtTabs, topTabOfArtTab, activeArtTab } from '../bspline-frame-builder/b-spline-gen/html/main/art-tabs.js';

const tabOf = (id) => EDITOR_TABS.find((t) => t.id === id);

describe('declared: Draw and Lattice', () => {
  it('the Artwork tab is labelled Draw (its ids kept); Lattice is a top-level tab sharing the art panel and tool row', () => {
    expect(tabOf('artwork')).toMatchObject({ label: 'Draw', buttonId: 'editorTabArtwork', panelId: 'editorLayersPanel', toolbarId: 'editorToolbarArtwork' });
    expect(tabOf('lattice')).toMatchObject({ label: 'Lattice', buttonId: 'editorTabLattice', panelId: 'editorLayersPanel', toolbarId: 'editorToolbarArtwork' });
    expect(EDITOR_TABS.map((t) => t.id).slice(0, 3)).toEqual(['frame', 'artwork', 'lattice']);
  });
  it('the lattice tools are the Lattice tab\'s; the drawing tools Draw\'s; Select / Cut / Erase / Stripe in both', () => {
    for (const m of ['lattice', 'shapeLattice']) { expect(tabOf('lattice').modes).toContain(m); expect(tabOf('artwork').modes).not.toContain(m); }
    for (const m of ['draw', 'line', 'text', 'node']) expect(tabOf('lattice').modes).not.toContain(m);
    for (const m of ['select', 'cut', 'erase', 'stripe']) { expect(tabOf('lattice').modes).toContain(m); expect(tabOf('artwork').modes).toContain(m); }
  });
  it('every Art tab belongs to exactly one top tab', () => {
    for (const t of ART_TABS) expect(EDITOR_TABS.filter((e) => (e.artTabs || []).includes(t.id)).length, t.id).toBe(1);
    expect(topTabOfArtTab('lattice')).toBe('lattice');
    expect(topTabOfArtTab('shape')).toBe('lattice');
    expect(topTabOfArtTab('edit')).toBe('artwork');
  });
});

describe('the tabs in the page', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="editorTabFrame"></button><button id="editorTabArtwork"></button><button id="editorTabLattice"></button>
      <button id="editorTabPhoto"></button><button id="editorTabBrick"></button>
      <div id="editorFramePanel"></div><div id="editorLayersPanel"></div><div id="editorPhotoPanel"></div><div id="editorBrickPanel"></div>
      <div id="editorToolbarFrame"></div><div id="editorToolbarPhoto"></div><div id="editorToolbarTop"></div>
      <div id="editorToolbarArtwork">${ART_TABS.flatMap((t) => t.tools).map((id) => `<button id="${id}"></button>`).join('')}</div>
      <div id="artTabStrip"></div><div id="artGeneralBody"></div>`;
    initArtTabs();
    setEditorTab('artwork');
  });

  it('Draw and Lattice both show the shared art panel and tool row; Brick hides them', () => {
    setEditorTab('lattice');
    expect(document.getElementById('editorLayersPanel').style.display).toBe('');
    expect(document.getElementById('editorToolbarArtwork').style.display).toBe('flex');
    expect(document.getElementById('editorTabLattice').classList.contains('active')).toBe(true);
    expect(document.getElementById('editorTabArtwork').classList.contains('active')).toBe(false);
    setEditorTab('brick');
    expect(document.getElementById('editorLayersPanel').style.display).toBe('none');
  });

  it('each art tab\'s strip shows its own Art tabs only', () => {
    const shown = () => ART_TABS.filter((t) => document.getElementById(`artTab_${t.id}`).style.display !== 'none').map((t) => t.id);
    expect(shown()).toEqual(['general', 'draw', 'text', 'edit']);
    setEditorTab('lattice');
    expect(shown()).toEqual(['lattice', 'shape']);
    expect(activeArtTab()).toBe('lattice'); // the Lattice tab's declared default
  });

  it('the alias: artTab_lattice picked from Draw switches to the Lattice tab, then shows its tools', () => {
    expect(getEditorTab()).toBe('artwork');
    document.getElementById('artTab_lattice').click();
    expect(getEditorTab()).toBe('lattice');
    expect(activeArtTab()).toBe('lattice');
    expect(document.getElementById('toolLattice').style.display).toBe('');
    expect(document.getElementById('toolDraw').style.display).toBe('none');
    setArtTab('edit');
    expect(getEditorTab()).toBe('artwork'); // and back: Edit is Draw's
  });
});
