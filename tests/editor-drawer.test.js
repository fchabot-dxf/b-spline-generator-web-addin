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
