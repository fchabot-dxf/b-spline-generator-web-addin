/**
 * MOB3 — the mobile bottom drawer (editor/editor-drawer.js).
 *
 * drawerHeightPx is pure (no DOM) and unit-tested directly here, matching
 * editor-grid.js's/editor-view.js's own pure/DOM split. The drag/tap/snap
 * gesture itself is declared once in splitter.js (see splitter.test.js for
 * its own pure nearestSnap/nextSnap coverage) and shared with
 * main/mobile-resizer.js. Drag/tap gesture wiring, tab switching, and the
 * generic collapsible-section sweep are DOM orchestration (initDrawer) —
 * live-proved via CDP instead, this codebase's own established
 * convention for that class of code.
 */
import { describe, it, expect } from 'vitest';
import {
  DRAWER_SNAP_STATES,
  TOOL_PANELS,
  drawerHeightPx,
  LANDSCAPE_SNAP_STATES,
  landscapeWidthPx,
  syncDrawerForMode,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-drawer.js';

describe('DRAWER_SNAP_STATES / TOOL_PANELS (declared tables)', () => {
  it('declares exactly the three snap states, in peek -> half -> full order', () => {
    expect(DRAWER_SNAP_STATES).toEqual(['peek', 'half', 'full']);
  });

  it('declares a Lattice tab, a Shape Lattice tab (T58), and nothing for a mode with no options panel', () => {
    expect(TOOL_PANELS.lattice).toEqual({ panelId: 'editorLatticePanel', label: 'Lattice Pattern' });
    expect(TOOL_PANELS.shapeLattice).toEqual({ panelId: 'editorShapeLatticePanel', label: 'Shape Lattice' });
    expect(TOOL_PANELS.select).toBeUndefined();
    expect(TOOL_PANELS.draw).toBeUndefined();
  });
});

describe('drawerHeightPx', () => {
  it('peek is a fixed 96px, independent of viewport height', () => {
    expect(drawerHeightPx('peek', 600)).toBe(96);
    expect(drawerHeightPx('peek', 1200)).toBe(96);
  });

  it('half is 50% of the viewport height', () => {
    expect(drawerHeightPx('half', 800)).toBe(400);
  });

  it('full is 88% of the viewport height', () => {
    expect(drawerHeightPx('full', 1000)).toBe(880);
  });

  it('an unrecognized state falls back to the peek floor', () => {
    expect(drawerHeightPx('bogus', 800)).toBe(96);
  });
});

describe('MOB4: LANDSCAPE_SNAP_STATES / landscapeWidthPx (the side-column splitter)', () => {
  it('declares exactly the three width snaps, in canvasMax -> half -> settingsMax order', () => {
    expect(LANDSCAPE_SNAP_STATES).toEqual(['canvasMax', 'half', 'settingsMax']);
  });

  it('canvasMax is a fixed 236px (UI1: matches the desktop panels\' own widened default), independent of viewport width', () => {
    expect(landscapeWidthPx('canvasMax', 844)).toBe(236);
    expect(landscapeWidthPx('canvasMax', 915)).toBe(236);
  });

  it('half is 38% of the viewport width', () => {
    expect(landscapeWidthPx('half', 800)).toBe(304);
  });

  it('settingsMax is 45% of the viewport width — under half the screen, canvas always keeps the majority', () => {
    expect(landscapeWidthPx('settingsMax', 1000)).toBe(450);
    expect(landscapeWidthPx('settingsMax', 1000)).toBeLessThan(500);
  });

  it('an unrecognized state falls back to the canvasMax floor', () => {
    expect(landscapeWidthPx('bogus', 800)).toBe(236);
  });
});

describe('the Frame / Artwork switch decides the drawer (Fred: "if I\'m in frame the panel should show the frame settings not the vectors, the tab should be the toggle")', () => {
  const setup = () => {
    document.body.innerHTML = `<div id="editorDrawerTabs"><button id="editorDrawerTab-tool" class="hidden"></button><button id="editorDrawerTab-layers">Layers</button></div>
      <aside id="editorShapeLatticePanel"></aside><aside id="editorLayersPanel"></aside>`;
    return { tabs: document.getElementById('editorDrawerTabs'), tool: document.getElementById('editorDrawerTab-tool'),
      panel: document.getElementById('editorShapeLatticePanel'), layers: document.getElementById('editorLayersPanel') };
  };
  it('Artwork + Shape Lattice: the tool tab shows and is active, the tab strip is visible', () => {
    const d = setup();
    syncDrawerForMode({ _editorTab: 'artwork' }, 'shapeLattice');
    expect(d.tabs.style.display).toBe('');
    expect(d.tool.classList.contains('hidden')).toBe(false);
    expect(d.tool.classList.contains('active')).toBe(true);
    expect(d.panel.classList.contains('editor-drawer-tab-hidden')).toBe(false);
  });
  it('Frame (same tool): no tool tab, no tab strip, the tool panel hidden -- only the second slot (the frame settings)', () => {
    const d = setup();
    syncDrawerForMode({ _editorTab: 'artwork' }, 'shapeLattice');
    syncDrawerForMode({ _editorTab: 'frame' }, 'shapeLattice');
    expect(d.tabs.style.display).toBe('none');
    expect(d.tool.classList.contains('hidden')).toBe(true);
    expect(d.panel.classList.contains('editor-drawer-tab-hidden')).toBe(true);
    expect(d.layers.classList.contains('editor-drawer-tab-hidden')).toBe(false);
    syncDrawerForMode({ _editorTab: 'artwork' }, 'shapeLattice'); // back to Artwork: the tool panel returns
    expect(d.tabs.style.display).toBe('');
    expect(d.panel.classList.contains('editor-drawer-tab-hidden')).toBe(false);
  });
});
