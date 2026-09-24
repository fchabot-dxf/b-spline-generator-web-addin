/**
 * SE9 — a color per vector element, for the editor display only. Fred's
 * amend: stroke and fill are ALWAYS the same color per element (one
 * editor._color, not a _strokeColor/_fillColor pair) — FILL/STROKE/BOTH
 * only decides whether fill is 'none', never a second color.
 *
 * "Editor only" is a claim about the carve pipeline, not an assumption:
 * the two guard blocks at the bottom rasterize/bake the SAME geometry in
 * two different colors and assert IDENTICAL output, against the REAL
 * (pure) functions the stamp/Fusion-export path actually calls —
 * core/stamp/sdf.js's computeSDF (mask math) and editor-transform-
 * handles.js's bakeMatrixIntoElement (carve export geometry bake).
 *
 * Mock elements: attr()/stroke()/fill() recording into one `_state`
 * object, matching the convention in editor-transform-handles.test.js /
 * editor-nodes.test.js (no real svg.js needed for line/rect/text kinds).
 *
 * setColor is exercised via VectorEditor.prototype.setColor.call(mock, ...)
 * with the REAL _commitStyleChange attached (not a reimplementation) —
 * same pattern as editor-session.test.js's setStrokeWidth tests, so a
 * revert of the actual editor.js fix fails these, not just a copy of it.
 */
import { describe, it, expect } from 'vitest';
import { VectorEditor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor.js';
import { VECTOR_COLORS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-color.js';
import { computeSDF } from '../bspline-frame-builder/b-spline-gen/html/core/stamp/sdf.js';
import { bakeMatrixIntoElement } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-transform-handles.js';
import {
  _applyFillModeToSelection, _currentElementColor,
} from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape.js';

function mockAttrEl(type, attrs) {
  const state = { ...attrs };
  return {
    type,
    attr(a, v) {
      if (typeof a === 'string') {
        if (v === undefined) return state[a];
        state[a] = v;
        return this;
      }
      Object.assign(state, a);
      return this;
    },
    stroke(v) {
      if (typeof v === 'object' && v !== null && 'color' in v) state.stroke = v.color;
      return this;
    },
    fill(v) { state.fill = v; return this; },
    _state: state,
  };
}

function mockStyleEditor(selectedElements) {
  const calls = { pushState: 0, onChange: 0 };
  const editor = {
    _color: '#000000',
    _selectedElements: selectedElements,
    _updateSelectionHighlight: () => {},
    pushState: () => { calls.pushState++; },
    _onChange: () => { calls.onChange++; },
    // Real method, not a reimplementation — setColor calls
    // this._commitStyleChange(), and `this` here is this mock.
    _commitStyleChange: VectorEditor.prototype._commitStyleChange,
  };
  return { editor, calls };
}

function callSetColor(editor, color) {
  VectorEditor.prototype.setColor.call(editor, color);
}

describe('VECTOR_COLORS', () => {
  it('declares Fred\'s piece first (red/yellow/navy/green) plus black and white', () => {
    expect(VECTOR_COLORS).toEqual([
      '#000000', '#c62828', '#f9c80e', '#1a237e', '#2e7d32', '#ffffff',
    ]);
  });
});

describe('editor.setColor', () => {
  it('sets _color for new shapes even with no selection', () => {
    const { editor } = mockStyleEditor([]);
    callSetColor(editor, '#c62828');
    expect(editor._color).toBe('#c62828');
  });

  it('recolors a stroke-only line: stroke updated, fill left alone (none)', () => {
    const line = mockAttrEl('line', { stroke: '#000', fill: 'none' });
    const { editor } = mockStyleEditor([line]);
    callSetColor(editor, '#c62828');
    expect(line._state.stroke).toBe('#c62828');
    expect(line._state.fill).toBe('none');
  });

  it('recolors a filled shape: both stroke and fill updated to the same color', () => {
    const rect = mockAttrEl('rect', { stroke: '#000', fill: '#000' });
    const { editor } = mockStyleEditor([rect]);
    callSetColor(editor, '#1a237e');
    expect(rect._state.stroke).toBe('#1a237e');
    expect(rect._state.fill).toBe('#1a237e');
  });

  it('recolors text via fill (text\'s color IS its fill) and also writes stroke for consistency', () => {
    const text = mockAttrEl('text', { fill: '#000' });
    const { editor } = mockStyleEditor([text]);
    callSetColor(editor, '#f9c80e');
    expect(text._state.fill).toBe('#f9c80e');
    expect(text._state.stroke).toBe('#f9c80e');
  });

  it('fires exactly one pushState + one onChange per call, regardless of selection size', () => {
    const a = mockAttrEl('line', { stroke: '#000', fill: 'none' });
    const b = mockAttrEl('rect', { stroke: '#000', fill: '#000' });
    const { editor, calls } = mockStyleEditor([a, b]);
    callSetColor(editor, '#2e7d32');
    expect(calls.pushState).toBe(1);
    expect(calls.onChange).toBe(1);
  });

  it('does not commit when nothing is selected (still updates _color for new shapes)', () => {
    const { editor, calls } = mockStyleEditor([]);
    callSetColor(editor, '#2e7d32');
    expect(calls.pushState).toBe(0);
    expect(calls.onChange).toBe(0);
  });

  it('Fred amend invariant: after setColor every selected element has stroke === fill, or fill is none', () => {
    const strokeOnly = mockAttrEl('line', { stroke: '#000', fill: 'none' });
    const filled = mockAttrEl('rect', { stroke: '#000', fill: '#000' });
    const text = mockAttrEl('text', { fill: '#000' });
    const { editor } = mockStyleEditor([strokeOnly, filled, text]);
    callSetColor(editor, '#c62828');
    for (const el of [strokeOnly, filled, text]) {
      const ok = el._state.fill === 'none' || el._state.fill === el._state.stroke;
      expect(ok).toBe(true);
    }
  });
});

describe('_applyFillModeToSelection preserves per-element color (SE9 interaction fix)', () => {
  it('_currentElementColor reads the element\'s own live color, not a global fallback', () => {
    const red = mockAttrEl('rect', { stroke: '#c62828', fill: 'none' });
    const yellowFill = mockAttrEl('rect', { stroke: 'none', fill: '#f9c80e' });
    const neither = mockAttrEl('line', { stroke: 'none', fill: 'none' });
    expect(_currentElementColor(red, '#000')).toBe('#c62828');
    expect(_currentElementColor(yellowFill, '#000')).toBe('#f9c80e');
    expect(_currentElementColor(neither, '#000')).toBe('#000');
  });

  it('toggling FILL/STROKE/BOTH keeps each element in ITS OWN color, not the toolbar global', () => {
    // Two rects, individually colored via setColor-equivalent state (red
    // and yellow) — editor._color (the toolbar's last picked color) is a
    // THIRD color, navy, deliberately different from both, so a bug that
    // reads the global instead of the element would show up as every
    // element turning navy.
    const red = mockAttrEl('rect', { stroke: '#c62828', fill: 'none' });
    const yellow = mockAttrEl('rect', { stroke: '#f9c80e', fill: 'none' });
    const editor = {
      _color: '#1a237e', // navy — must NOT leak onto either element below
      _selectedElements: [red, yellow],
      _strokeWidth: 0.5,
      pushState() {},
    };
    _applyFillModeToSelection(editor, 'both');
    expect(red._state.fill).toBe('#c62828');
    expect(red._state.stroke).toBe('#c62828');
    expect(yellow._state.fill).toBe('#f9c80e');
    expect(yellow._state.stroke).toBe('#f9c80e');
  });

  it('non-vacuous: reverting to the global-color read reproduces the collapse this test catches', () => {
    // Mirrors the OLD (pre-SE9-fix) body of _applyFillModeToSelection:
    // both elements repainted from editor._color regardless of their own.
    const red = mockAttrEl('rect', { stroke: '#c62828', fill: 'none' });
    const yellow = mockAttrEl('rect', { stroke: '#f9c80e', fill: 'none' });
    const globalColor = '#1a237e';
    for (const el of [red, yellow]) {
      el.fill(globalColor);
      el.stroke({ color: globalColor });
    }
    // Both collapsed to navy — the exact bug the fix above prevents.
    expect(red._state.fill).toBe(globalColor);
    expect(yellow._state.fill).toBe(globalColor);
    expect(red._state.fill).toBe(yellow._state.fill);
  });
});

describe('Carve-neutral guard #1: the stamp mask (computeSDF) is alpha-only', () => {
  // 4x1 buffer: pixels 0-1 opaque ("inside" the shape), 2-3 transparent.
  // Same alpha in both buffers; only RGB differs (black vs yellow).
  function makeBuffer(rgb) {
    const [r, g, b] = rgb;
    const px = [[r, g, b, 255], [r, g, b, 255], [r, g, b, 0], [r, g, b, 0]];
    const out = new Uint8ClampedArray(16);
    px.forEach((p, i) => out.set(p, i * 4));
    return out;
  }

  it('produces an IDENTICAL SDF for the same shape rendered black vs yellow', () => {
    const black = computeSDF(makeBuffer([0, 0, 0]), 4, 1);
    const yellow = computeSDF(makeBuffer([249, 200, 14]), 4, 1); // #f9c80e
    expect(Array.from(yellow)).toEqual(Array.from(black));
  });

  it('non-vacuous: a genuinely different ALPHA pattern DOES change the SDF (the test can detect a real difference)', () => {
    const black = computeSDF(makeBuffer([0, 0, 0]), 4, 1);
    const shiftedAlpha = new Uint8ClampedArray(16);
    [[0, 0, 0, 0], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 0]]
      .forEach((p, i) => shiftedAlpha.set(p, i * 4));
    const shifted = computeSDF(shiftedAlpha, 4, 1);
    expect(Array.from(shifted)).not.toEqual(Array.from(black));
  });
});

describe('Carve-neutral guard #2: bakeMatrixIntoElement never lets color affect geometry', () => {
  const matrix = { a: 2, b: 0, c: 0, d: 2, e: 1, f: 1 }; // scale 2, translate (1,1)

  it('bakes an identical x1/y1/x2/y2 for a red line and a yellow line with the same geometry', () => {
    const red = mockAttrEl('line', { x1: '0', y1: '0', x2: '3', y2: '4', stroke: '#c62828', fill: 'none' });
    const yellow = mockAttrEl('line', { x1: '0', y1: '0', x2: '3', y2: '4', stroke: '#f9c80e', fill: 'none' });
    bakeMatrixIntoElement(red, matrix);
    bakeMatrixIntoElement(yellow, matrix);
    const geom = (el) => ({ x1: el._state.x1, y1: el._state.y1, x2: el._state.x2, y2: el._state.y2 });
    expect(geom(yellow)).toEqual(geom(red));
    // Color itself is untouched by the bake (it only rewrites geometry).
    expect(red._state.stroke).toBe('#c62828');
    expect(yellow._state.stroke).toBe('#f9c80e');
  });

  it('non-vacuous: a DIFFERENT matrix DOES change the baked geometry (the test can detect a real difference)', () => {
    const a = mockAttrEl('line', { x1: '0', y1: '0', x2: '3', y2: '4', stroke: '#000', fill: 'none' });
    const b = mockAttrEl('line', { x1: '0', y1: '0', x2: '3', y2: '4', stroke: '#000', fill: 'none' });
    bakeMatrixIntoElement(a, matrix);
    bakeMatrixIntoElement(b, { a: 3, b: 0, c: 0, d: 3, e: 5, f: 5 }); // a different scale+translate
    expect(a._state.x2).not.toBe(b._state.x2);
  });
});
