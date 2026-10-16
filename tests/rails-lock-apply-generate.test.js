/**
 * Rails custom-position + lock slice (seat D 2026-10-16; advisor 45's follow-up correction, Fred's "an action is
 * never a silent no-op" rule): applyChangeList's own Apply-time Generate call -- "Apply must SHOW the rails where
 * Fusion put them... have Apply call the SAME Generate for that lattice layer... Test: after Apply, a rail's
 * drawn position equals its pulled position, and one Undo reverts both."
 *
 * Needs a mock editor that can run a REAL generatePattern (tests/pull-changelist-apply.test.js's own mock never
 * supported .line()/.circle() at all -- see that file's own doc comment on this split). Based on the proven
 * _makeMockEditor shape from tests/editor-lattice-pattern-emit.test.js (confirmed compatible with real
 * generatePattern calls), with `type` added to each element (rails-custom-drag-persist.test.js's own convention
 * -- _captureProtectedRails's `ch.type !== 'line'` gate reads this as a real object property, never via attr()),
 * plus a minimal real pushState/undo pair: the real editor.js's own undo() restores from a serialized SVG string
 * (_snapshotState/_restoreState), not reproducible in this lightweight element mock -- this restores exactly what
 * this file's own assertions check (the drawn rail elements + each layer's own pattern.rails.custom), enough to
 * prove the one property the advisor asked for without rebuilding editor.js's own snapshot format.
 */
import { describe, it, expect } from 'vitest';
import { applyChangeList } from '../bspline-frame-builder/b-spline-gen/html/main/pull-changelist.js';
import { generatePattern, PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { RAIL_ID_ATTR, LATTICE_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';
import { applyColorOverride, OVERRIDE_COLOR_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-piece-override.js';

function makeMockEditor() {
  let elements = [];
  function makeElement(type, initial) {
    const store = { ...initial };
    const el = {
      type,
      node: {
        getAttribute: (k) => (store[k] !== undefined ? store[k] : null),
        hasAttribute: (k) => store[k] !== undefined,
      },
      attr(k, ...rest) {
        if (rest.length === 0) return store[k];
        const v = rest[0];
        if (v === null || v === undefined) delete store[k];
        else store[k] = v;
        return el;
      },
      stroke(v) {
        if (typeof v === 'object' && v !== null) {
          if ('color' in v) store.stroke = v.color;
          if ('width' in v) store['stroke-width'] = v.width;
        }
        return el;
      },
      fill(v) { if (v !== undefined) store.fill = v; return el; },
      center(x, y) { store.cx = x; store.cy = y; return el; },
      addClass() { return el; },
      removeClass() { return el; },
      hasClass() { return false; },
      remove() { elements = elements.filter((e) => e !== el); },
      _snapshot: () => ({ type, store: { ...store } }),
    };
    return el;
  }
  const sketchLayer = {
    line(x1, y1, x2, y2) { const el = makeElement('line', { x1, y1, x2, y2 }); elements.push(el); return el; },
    circle(d) { const el = makeElement('circle', { r: d / 2 }); elements.push(el); return el; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    node: {},
  };
  const editor = {
    _mW: 4, _mH: 4,
    _sketchLayer: sketchLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    _color: '#000', _strokeWidth: 0.02,
    _selectedElements: [],
    _undoStack: [],
    _lastPushedState: null,
    pushStateCalls: 0,
    notifyChangeCalls: [],
    _snapshotState() {
      return {
        elements: elements.map((e) => e._snapshot()),
        railsCustom: editor._layers.map((l) => (l.pattern ? JSON.parse(JSON.stringify((l.pattern.rails && l.pattern.rails.custom) || [])) : null)),
      };
    },
    pushState() {
      editor.pushStateCalls++;
      const state = editor._snapshotState();
      editor._undoStack.push(state);
      editor._lastPushedState = state;
    },
    _notifyChange(kind) { editor.notifyChangeCalls.push(kind); },
    // test-only minimal undo -- see this file's own doc comment above for why it diverges from editor.js's real one.
    undo() {
      if (editor._undoStack.length < 2) return false;
      editor._undoStack.pop();
      const prev = editor._undoStack[editor._undoStack.length - 1];
      elements = prev.elements.map((s) => makeElement(s.type, s.store));
      editor._layers.forEach((l, i) => {
        if (l.pattern) l.pattern.rails = { ...(l.pattern.rails || PATTERN_DEFAULTS.rails), custom: prev.railsCustom[i] ? JSON.parse(JSON.stringify(prev.railsCustom[i])) : [] };
      });
      editor._lastPushedState = prev;
      return true;
    },
  };
  return editor;
}

const rails = (editor) => editor._sketchLayer.children().toArray().filter((el) => el.attr(LATTICE_ATTR) === 'rail');

describe('applyChangeList -> real generatePattern (advisor 45: "Apply must SHOW the rails where Fusion put them")', () => {
  it('a pulled rail\'s drawn position equals its pulled position, pattern.rails.custom locks it, and ONE Undo reverts both', async () => {
    const editor = makeMockEditor();
    const pattern = { ...PATTERN_DEFAULTS, seed: 1 };
    await generatePattern(editor, pattern); // generatePattern's own pushState -- the baseline this test's Undo restores to

    const before = rails(editor).map((el) => ({ railId: el.attr(RAIL_ID_ATTR), y: el.attr('y1') }));
    const ys = [...new Set(before.map((r) => r.y))].sort((a, b) => a - b);
    expect(ys.length).toBeGreaterThan(1); // need at least 2 rows to tell "moved" from "always was there"
    const gap = ys[1] - ys[0];
    const target = before.find((r) => r.y === ys[0]);
    const newY = target.y + gap / 4; // inside the half-gap "replace this row" window, distinct from every existing row

    const pulledCurves = [{ type: 'line', isConstruction: false, railId: target.railId, x1: 0, y1: newY, x2: 1, y2: newY }];
    await applyChangeList({ boardRows: [], layerGroups: [], frameRows: [] }, { editor, pulledCurves });

    const after = rails(editor);
    expect(after.some((el) => Math.abs(el.attr('y1') - newY) < 1e-6 && Math.abs(el.attr('y2') - newY) < 1e-6)).toBe(true);

    const custom = pattern.rails.custom;
    expect(custom).toHaveLength(1);
    expect(custom[0]).toMatchObject({ id: target.railId, locked: true });

    expect(editor._undoStack.length).toBe(2); // the first Generate's own baseline push, plus exactly ONE combined step for this whole Apply

    const reverted = editor.undo();
    expect(reverted).toBe(true);
    expect(rails(editor).some((el) => Math.abs(el.attr('y1') - target.y) < 1e-6)).toBe(true); // drawn position reverted
    expect(pattern.rails.custom).toEqual([]); // the lock entry reverted too, same Undo
  });

  it('Apply\'s own Generate preserves a protected (styled) rail\'s colour and a hand-drawn tie, exactly as a manual Generate would', async () => {
    const editor = makeMockEditor();
    const pattern = { ...PATTERN_DEFAULTS, seed: 2 };
    await generatePattern(editor, pattern);

    const railEls = rails(editor);
    expect(railEls.length).toBeGreaterThan(1);
    const protectedRail = railEls[0];
    const protectedY = protectedRail.attr('y1');
    applyColorOverride(protectedRail, 'rails', '#ff00ff');
    const movedRail = railEls[1];

    // a hand-drawn tie -- never carries OWNERSHIP_ATTR, so Generate's own clear-before-redraw (only removes
    // OWNERSHIP_ATTR-tagged elements) must leave it alone, same as a manual Generate would.
    const manualTie = editor._sketchLayer.line(0.2, 0.2, 0.8, 0.8);
    manualTie.attr(LATTICE_ATTR, 'tie').attr('data-layer', editor._layers[0].id);

    const ys = [...new Set(railEls.map((el) => el.attr('y1')))].sort((a, b) => a - b);
    const gap = ys[1] - ys[0];
    const newY = movedRail.attr('y1') + gap / 4;
    const pulledCurves = [{ type: 'line', isConstruction: false, railId: movedRail.attr(RAIL_ID_ATTR), x1: 0, y1: newY, x2: 1, y2: newY }];

    await applyChangeList({ boardRows: [], layerGroups: [], frameRows: [] }, { editor, pulledCurves });

    const after = rails(editor);
    // the moved rail's row actually changed -- proves Apply's Generate really ran (not a tautology: a disabled-
    // Generate mutation leaves every element untouched, which would let the two checks below pass vacuously).
    expect(after.some((el) => Math.abs(el.attr('y1') - newY) < 1e-6)).toBe(true);

    const stillProtected = after.filter((el) => el.attr(OVERRIDE_COLOR_ATTR) === '#ff00ff');
    expect(stillProtected).toHaveLength(1); // the protected rail's own colour survived
    expect(stillProtected[0].attr('y1')).toBe(protectedY); // and its own row -- untouched by the OTHER rail's move

    const survivingTie = editor._sketchLayer.children().toArray().find((el) => el === manualTie);
    expect(survivingTie).toBe(manualTie); // the SAME hand-drawn element, never cleared
  });
});
