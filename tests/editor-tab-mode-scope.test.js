/**
 * Fred (2026-10-04): a tool mode never outlives a switch to a tab that doesn't own it. A Shape
 * Lattice mode carried from Artwork into the Brick tab kept running lattice gestures on the canvas
 * there. Each tab declares its own modes (main/editor-tabs.js EDITOR_TABS[].modes); on
 * editorTabChanged, main/global-events.js runs the Esc-to-select path when the new tab doesn't own
 * the current mode. Returning to the old tab doesn't restore the old tool.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { EDITOR_TABS } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { dropForeignModeOnTabChange } from '../bspline-frame-builder/b-spline-gen/html/main/global-events.js';
import { getModeHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';

const INTERACTION_SRC = readFileSync('bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js', 'utf8'); // vitest runs at the repo root
/** Every real gesture mode: the keys of editor-interaction.js's own modeHandlers table. */
function realModes() {
  const block = INTERACTION_SRC.slice(INTERACTION_SRC.indexOf('const modeHandlers = {'));
  const body = block.slice(0, block.indexOf('};'));
  return [...body.matchAll(/^\s+([A-Za-z]+):/gm)].map((m) => m[1]);
}

describe('EDITOR_TABS declares which tab owns each editor mode', () => {
  it('every declared mode is a real modeHandlers mode (not silently falling back to Select)', () => {
    const select = getModeHandler('select');
    for (const tab of EDITOR_TABS) {
      for (const mode of tab.modes) {
        if (mode !== 'select') expect(getModeHandler(mode), `${tab.id}:${mode}`).not.toBe(select);
      }
    }
  });
  it('every real mode is owned by at least one tab (a new mode must be declared)', () => {
    const owned = new Set(EDITOR_TABS.flatMap((t) => t.modes));
    const modes = realModes();
    expect(modes.length).toBeGreaterThan(10);
    for (const mode of modes) expect(owned.has(mode), mode).toBe(true);
  });
  it('every tab owns Select', () => {
    for (const tab of EDITOR_TABS) expect(tab.modes).toContain('select');
  });
});

describe('entering a tab drops a tool mode it does not own', () => {
  let editor;
  beforeEach(() => {
    editor = { _currentMode: 'select', setMode: vi.fn(function (m) { this._currentMode = m; }) };
    window.svgEditor = editor;
  });
  afterEach(() => { window.svgEditor = null; });

  it.each([
    ['shapeLattice', 'brick'], ['lattice', 'brick'], ['draw', 'brick'], ['node', 'brick'],
    ['shapeLattice', 'photo'], ['lattice', 'frame'], ['brickBrush', 'artwork'], ['brickBrush', 'frame'],
  ])('%s -> %s tab: back to Select', (mode, tab) => {
    editor._currentMode = mode;
    dropForeignModeOnTabChange(tab);
    expect(editor.setMode).toHaveBeenCalledWith('select');
    expect(editor._currentMode).toBe('select');
  });

  it.each([
    ['shapeLattice', 'artwork'], ['brickBrush', 'brick'], ['cut', 'brick'], ['stripe', 'brick'], ['cut', 'artwork'], ['select', 'brick'],
  ])('%s -> %s tab: owned, left alone', (mode, tab) => {
    editor._currentMode = mode;
    dropForeignModeOnTabChange(tab);
    expect(editor.setMode).not.toHaveBeenCalled();
    expect(editor._currentMode).toBe(mode);
  });

  it('returning to Artwork does not restore the old tool', () => {
    editor._currentMode = 'shapeLattice';
    dropForeignModeOnTabChange('brick');
    dropForeignModeOnTabChange('artwork');
    expect(editor._currentMode).toBe('select');
  });

  it('no editor open: nothing happens', () => {
    window.svgEditor = null;
    expect(() => dropForeignModeOnTabChange('brick')).not.toThrow();
  });
});
