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
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-drawer.js';

describe('DRAWER_SNAP_STATES / TOOL_PANELS (declared tables)', () => {
  it('declares exactly the three snap states, in peek -> half -> full order', () => {
    expect(DRAWER_SNAP_STATES).toEqual(['peek', 'half', 'full']);
  });

  it('declares the Lattice and Shape Lattice (T58) tool panels, and nothing for a mode with no options panel', () => {
    // the Art tabs: no tab labels -- the drawer's tool | panel tab pair is retired (the settings mount under Layers)
    expect(TOOL_PANELS.lattice).toEqual({ panelId: 'editorLatticePanel' });
    expect(TOOL_PANELS.shapeLattice).toEqual({ panelId: 'editorShapeLatticePanel' });
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

// The Art tabs (Fred, 900 px: "what's stripe and brick?") retired the drawer's tool | panel tab pair; Fred's rule that it
// carried ("if I'm in frame the panel should show the frame settings not the vectors") is now the mount's: a tool panel
// never shows outside its own tab (tests/lattice-side-column.test.js, 'Frame tab' below the Artwork-tab block).
describe('the drawer tab pair is retired', () => {
  it('no syncDrawerForMode, no #editorDrawerTabs in the palette', async () => {
    const mod = await import('../bspline-frame-builder/b-spline-gen/html/editor/editor-drawer.js');
    expect(mod.syncDrawerForMode).toBeUndefined();
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
    expect(html).not.toMatch(/id="editorDrawerTabs"|id="editorDrawerTab-(tool|layers)"/);
  });
});
