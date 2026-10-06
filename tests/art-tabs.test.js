/**
 * The Artwork editor's TABS (Fred's OK on mockup v2): General | Draw | Lattice | Shape | Text | Edit at the top of the
 * Artwork panel, the active tab's tool buttons under it (the existing buttons, moved from the left rail), then Layers.
 * Markup checks read the REAL palette; behaviour runs on the real Artwork panel markup.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ART_TABS, ART_GENERAL_GROUPS, artTabOfMode, modeOfToolButton, setArtTab, activeArtTab, initArtTabs } from '../bspline-frame-builder/b-spline-gen/html/main/art-tabs.js';
import { EDITOR_TABS } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
// the <body> only, without its scripts (markup checks; the head's web fonts would be fetched)
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const doc = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html');
const PANEL = doc.getElementById('editorLayersPanel').outerHTML;
const buttonsIn = (root) => [...root.querySelectorAll('#editorToolbarArtwork > button')].map((b) => b.id);

describe('Art tabs: the declaration against the real markup', () => {
  it('every Artwork tool button sits in exactly one tab, and every declared one exists', () => {
    const real = buttonsIn(doc);
    expect(real.length).toBeGreaterThanOrEqual(17);
    for (const id of real) expect(ART_TABS.filter((t) => t.tools.includes(id)).length, id).toBe(1);
    for (const t of ART_TABS) for (const id of t.tools) expect(real, id).toContain(id);
  });
  it('the panel head is the first thing in the Artwork panel: the strip, then the tools; the left rail holds no Artwork tools', () => {
    const panel = doc.getElementById('editorLayersPanel');
    const head = panel.firstElementChild;
    expect(head.id).toBe('artTabsHead');
    expect(head.hasAttribute('data-panel-head')).toBe(true);
    expect(head.firstElementChild.id).toBe('artTabStrip');
    expect(head.firstElementChild.nextElementSibling.id).toBe('editorToolbarArtwork');
    expect(doc.querySelector('aside.editor-sidebar #editorToolbarArtwork')).toBeNull();
  });
  it("General's groups are the Artwork tab's declared panelHosts (home: the top bar)", () => {
    const hosts = EDITOR_TABS.find((t) => t.id === 'artwork').panelHosts;
    expect(hosts.map((h) => h.content)).toEqual([...ART_GENERAL_GROUPS]);
    for (const h of hosts) { expect(h.host).toBe('artGeneralBody'); expect(h.panel).toBe('editorToolbarTop'); }
    for (const g of ART_GENERAL_GROUPS) expect(doc.getElementById(g)?.closest('#editorToolbarTop'), g).not.toBeNull();
  });
  it('modes: the `tool<Mode>` convention; the action buttons arm none', () => {
    expect(modeOfToolButton('toolShapeLattice')).toBe('shapeLattice');
    expect(modeOfToolButton('toolFit')).toBeNull();
    expect(artTabOfMode('select')).toBe('edit');
    expect(artTabOfMode('rect')).toBe('draw');
    expect(artTabOfMode('brickBrush')).toBeNull();
  });
});

describe('Art tabs: behaviour', () => {
  let clicks;
  beforeEach(() => {
    document.body.innerHTML = PANEL;
    clicks = [];
    for (const b of document.querySelectorAll('#editorToolbarArtwork > button')) b.addEventListener('click', () => clicks.push(b.id));
    window.svgEditor = { _currentMode: 'select' };
    initArtTabs();
  });
  const shown = () => [...document.querySelectorAll('#editorToolbarArtwork > *')].filter((e) => e.style.display !== 'none').map((e) => e.id);

  it('opens on Edit; a tab shows only its own tool buttons (no dividers)', () => {
    expect(activeArtTab()).toBe('edit');
    expect(shown()).toEqual(ART_TABS.find((t) => t.id === 'edit').tools.slice().sort((a, b) => buttonsIn(document).indexOf(a) - buttonsIn(document).indexOf(b)));
    document.getElementById('artTab_draw').click();
    expect(new Set(shown())).toEqual(new Set(ART_TABS.find((t) => t.id === 'draw').tools));
    expect(document.getElementById('artTab_draw').classList.contains('active')).toBe(true);
  });
  it('picking a tab arms its first tool, unless the current mode is already one of its own', () => {
    document.getElementById('artTab_draw').click();
    expect(clicks).toEqual(['toolDraw']);
    window.svgEditor._currentMode = 'rect';
    setArtTab('edit'); setArtTab('draw');
    expect(clicks.at(-1)).toBe('toolSelect'); // Edit armed Select; Draw then kept the current Rect
  });
  it('General shows the shared groups host and no tool row, and leaves the tool as it is', () => {
    document.getElementById('artTab_general').click();
    expect(clicks).toEqual([]);
    expect(document.getElementById('artGeneralBody').style.display).toBe('');
    expect(document.getElementById('editorToolbarArtwork').style.display).toBe('none');
  });
  it('a mode change from anywhere else (a shortcut, Esc) brings its tab up', () => {
    document.dispatchEvent(new CustomEvent('editorModeChanged', { detail: { mode: 'lattice' } }));
    expect(activeArtTab()).toBe('lattice');
    document.dispatchEvent(new CustomEvent('editorModeChanged', { detail: { mode: 'brickBrush' } }));
    expect(activeArtTab()).toBe('lattice'); // not an Artwork mode: the tab stays
    expect(clicks).toEqual([]); // following a mode never re-arms it
  });
});
