/**
 * SE13 Slice 3 (T49) — the DOM-touching half of boundary mode:
 * generatePattern's own 'boundary' branch (async boundary-primitive
 * resolution via a live `data-boundary-ref` element, §9's commit-only
 * refill via refreshBoundaryPatterns) and the fill's own inner-stroke
 * edge-shrink (§7's Border piece was retired by T74 AMEND 1 — see the
 * "T50" describe block below for its surviving `contour.width` override).
 *
 * `worldPoint` (editor-coords.js) falls back to the IDENTITY transform
 * whenever `el.matrix` isn't a function (its own documented contract) —
 * this mock deliberately never defines `.matrix()`, so every boundary
 * element here is implicitly untransformed; the WORLD-transform bake
 * itself (`_bakeWorldTransform`) is exercised for its identity case only,
 * which is suficient to prove the wiring without re-testing svg.js's own
 * matrix math.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  generatePattern, refreshBoundaryPatterns, stampBoundaryRef, PATTERN_DEFAULTS,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

function _makeMockEditor() {
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
      // T49: `.type` (used by shapeToPrimitives) is the addition boundary-
      // mode generatePattern needs beyond the SAME mock editor-lattice-
      // pattern-emit.test.js already uses.
      clone() { return makeElement(type, { ...store }); },
    };
    return el;
  }

  const sketchLayer = {
    line(x1, y1, x2, y2) { const el = makeElement('line', { x1, y1, x2, y2 }); elements.push(el); return el; },
    circle(d) { const el = makeElement('circle', { r: d / 2 }); elements.push(el); return el; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    add(el) { elements.push(el); return el; },
    node: {},
  };

  const editor = {
    _mW: 10, _mH: 8,
    _sketchLayer: sketchLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    _color: '#000', _strokeWidth: 0.02,
    _selectedElements: [],
    pushStateCalls: 0,
    notifyChangeCalls: [],
    pushState() { editor.pushStateCalls++; },
    _notifyChange(kind) { editor.notifyChangeCalls.push(kind); },
    // Test-only helper: add a "live" boundary shape directly (bypasses
    // the Pick-shape UI flow, already covered in tests/properties-
    // lattice.test.js — this file is about generatePattern's own
    // consumption of an already-linked element).
    _addBoundaryRect(x, y, w, h) {
      const el = makeElement('rect', { x: String(x), y: String(y), width: String(w), height: String(h) });
      elements.push(el);
      return el;
    },
    // T50: same idea, a circle -- the dispatch's own exact test shape
    // (r=2, stroke 0.8) for the inner-stroke edge-shrink tests below.
    _addBoundaryCircle(cx, cy, r) {
      const el = makeElement('circle', { cx: String(cx), cy: String(cy), r: String(r) });
      elements.push(el);
      return el;
    },
  };
  return editor;
}

function activeLayerPattern(editor) {
  return editor._layers.find((l) => l.id === editor._activeLayer)?.pattern;
}

describe('generatePattern: boundary mode, end to end (async boundary-primitive resolution)', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); });

  it('a linked rect boundary (matching the whole 10x8 board) produces the SAME rails as rect mode over the SAME bounds', async () => {
    // Compared against RECT mode, not BOARD mode: board mode insets by
    // PATTERN.margin (SE7c, "nothing generated sits exactly on the board
    // edge") while boundary mode's own bbox is the shape's EXACT extent,
    // un-inset -- the two are deliberately NOT the same box (a difference
    // already established at the computePattern level, tests/editor-
    // lattice-pattern-boundary.test.js). This test's own job is proving
    // the DOM-level async pipeline (shapeToPrimitives -> bake -> resolve
    // -> computePattern) wires together correctly end to end, matching
    // rect mode's own already-proven span math over the identical box.
    const spacing = PATTERN_DEFAULTS.spacing;
    const iMax = 10 / spacing, jMax = 8 / spacing; // 40, 32
    const boundaryEl = editor._addBoundaryRect(0, 0, 10, 8);
    const shapeId = stampBoundaryRef(boundaryEl);

    const rectPattern = { ...PATTERN_DEFAULTS, seed: 3, rails: { every: 2, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, mode: 'density', density: 0 } };
    const rectResult = await generatePattern(editor, { ...rectPattern, extent: { mode: 'rect', iMin: 0, jMin: 0, iMax, jMax } });
    // Reset the mock layer between the two generates (separate editors is
    // simpler than un-generating) -- a fresh editor per call, same pattern.
    const editor2 = _makeMockEditor();
    const boundaryEl2 = editor2._addBoundaryRect(0, 0, 10, 8);
    const boundaryPattern = {
      ...rectPattern,
      extent: { mode: 'boundary' },
      boundary: { ...PATTERN_DEFAULTS.boundary, shapeId: stampBoundaryRef(boundaryEl2), endRule: 'on-boundary' },
    };
    const boundaryResult = await generatePattern(editor2, boundaryPattern);

    const railsRect = rectResult.segments.filter((s) => s.kind === 'rail').map((s) => [s.a.i, s.a.j, s.b.i, s.b.j]).sort();
    const railsBoundary = boundaryResult.segments.filter((s) => s.kind === 'rail').map((s) => [s.a.i, s.a.j, s.b.i, s.b.j]).sort();
    expect(railsBoundary).toEqual(railsRect);
    expect(railsBoundary.length).toBeGreaterThan(0); // non-vacuous
    expect(shapeId).toBeTruthy();
  });

  it('an unlinked boundary (no shapeId) declines gracefully -- empty pattern, no crash', async () => {
    const pattern = { ...PATTERN_DEFAULTS, extent: { mode: 'boundary' }, boundary: { ...PATTERN_DEFAULTS.boundary, shapeId: null } };
    const { segments, nodePoints } = await generatePattern(editor, pattern);
    expect(segments).toEqual([]);
    expect(nodePoints).toEqual([]);
  });
});

describe('refreshBoundaryPatterns (§9, commit-only link refresh)', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); });

  it('does nothing when the active layer is not in boundary mode', () => {
    editor._layers[0].pattern = { ...PATTERN_DEFAULTS, extent: { mode: 'board' } };
    refreshBoundaryPatterns(editor);
    expect(editor.notifyChangeCalls).toEqual([]); // no generatePattern call was fired at all
  });

  it('does nothing when boundary mode is set but no shape is linked yet', () => {
    editor._layers[0].pattern = { ...PATTERN_DEFAULTS, extent: { mode: 'boundary' }, boundary: { ...PATTERN_DEFAULTS.boundary, shapeId: null } };
    refreshBoundaryPatterns(editor);
    expect(editor.notifyChangeCalls).toEqual([]);
  });

  it('re-generates the active layer\'s pattern when boundary mode IS active with a linked shape', async () => {
    const boundaryEl = editor._addBoundaryRect(0, 0, 10, 8);
    editor._layers[0].pattern = {
      ...PATTERN_DEFAULTS, rails: { every: 4, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, mode: 'density', density: 0 },
      extent: { mode: 'boundary' }, boundary: { ...PATTERN_DEFAULTS.boundary, shapeId: stampBoundaryRef(boundaryEl), endRule: 'on-boundary' },
    };
    refreshBoundaryPatterns(editor);
    await new Promise((resolve) => setTimeout(resolve, 0)); // the refill itself is fire-and-forget/async
    const rails = editor._sketchLayer.children().filter((e) => e.attr('data-lattice') === 'rail');
    expect(rails.length).toBeGreaterThan(0); // non-vacuous: something was actually (re)generated
  });

  it('non-vacuous: the re-entrancy guard prevents infinite recursion (generatePattern\'s own commit doesn\'t re-trigger a refill)', async () => {
    // Proven indirectly: generatePattern's own _notifyChange('commit') call
    // (at its end) would, without the guard, call refreshBoundaryPatterns
    // again, which would call generatePattern again, forever. This test
    // simply confirms a real boundary-mode refill completes (doesn't hang
    // the test runner / blow the stack) within one macrotask flush.
    const boundaryEl = editor._addBoundaryRect(0, 0, 10, 8);
    editor._layers[0].pattern = {
      ...PATTERN_DEFAULTS, rails: { every: 4, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, mode: 'density', density: 0 },
      extent: { mode: 'boundary' }, boundary: { ...PATTERN_DEFAULTS.boundary, shapeId: stampBoundaryRef(boundaryEl), endRule: 'on-boundary' },
    };
    refreshBoundaryPatterns(editor);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.notifyChangeCalls).toEqual(['commit']); // exactly one commit, not an unbounded chain
  });

  /**
   * T59: a genuine, PRE-EXISTING bug (since T49), found live via CDP, not
   * from reading the code — confirmed by counting `editor._undoStack`
   * entries in a real browser session: EVERY Generate press on a
   * boundary-mode layer pushed TWO undo-stack entries, not one. Every
   * OTHER test in this file's own mock `_notifyChange` only RECORDS the
   * call kind — it never actually cascades into `refreshBoundaryPatterns`
   * the way `editor.js`'s REAL `_notifyChange` does — so this specific
   * bug was structurally invisible to the whole rest of this file. This
   * mock's own `_notifyChange` is the one exception: it mimics the REAL
   * wiring (`if (kind==='commit') refreshBoundaryPatterns(editor)`) so a
   * DIRECT `generatePattern` call (what every "Generate" button, and
   * T59's own new handle-drag `finish`, actually does) is tested the way
   * it really runs, not through `refreshBoundaryPatterns` itself (already
   * covered by the OTHER tests above).
   */
  it('non-vacuous regression (T59): calling generatePattern DIRECTLY on a boundary-mode pattern pushes exactly ONE undo step, not two', async () => {
    const boundaryEl = editor._addBoundaryRect(0, 0, 10, 8);
    const pattern = {
      ...PATTERN_DEFAULTS, rails: { every: 4, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, mode: 'density', density: 0 },
      extent: { mode: 'boundary' }, boundary: { ...PATTERN_DEFAULTS.boundary, shapeId: stampBoundaryRef(boundaryEl), endRule: 'on-boundary' },
    };
    editor._layers[0].pattern = pattern;
    // Override _notifyChange for THIS test only, to mimic editor.js's own
    // real cascade (every other test in this file uses the record-only
    // version, deliberately, so as not to blur what each is checking).
    editor._notifyChange = (kind) => {
      editor.notifyChangeCalls.push(kind);
      if (kind === 'commit') refreshBoundaryPatterns(editor);
    };
    await generatePattern(editor, pattern);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the (suppressed) refill settle
    expect(editor.pushStateCalls).toBe(1);
  });
});

describe('generatePattern: T50 -- which stroke width the fill\'s own inner-stroke edge-shrink resolves to', () => {
  let editor;
  beforeEach(() => { editor = _makeMockEditor(); });

  const cx = 5, cy = 5, r = 2;
  function basePattern(overrides = {}) {
    return {
      // spacing:1 -- keeps world inches == lattice units 1:1, so the
      // circle's own world cx/cy/r (5,5,2) can be compared directly
      // against segment i/j without a second /spacing conversion here.
      ...PATTERN_DEFAULTS, spacing: 1, rails: { every: 1, offset: 0 }, ties: { ...PATTERN_DEFAULTS.ties, mode: 'density', density: 0 },
      extent: { mode: 'boundary' },
      // T72 (AMEND 3): every test in this describe block hand-picks a
      // boundary circle (editor._addBoundaryCircle) -- source:'picked',
      // matching the real "Pick shape…" flow, so _effectiveContourWidth's
      // generated-vs-picked branch keeps inheriting the picked shape's own
      // live stroke here, not widths.rails.
      shape: { ...PATTERN_DEFAULTS.shape, source: 'picked' },
      boundary: { ...PATTERN_DEFAULTS.boundary, endRule: 'on-boundary', ...overrides },
    };
  }

  it('a visibly-stroked boundary with no contour.width override: the fill cuts at the INNER stroke edge (dispatch\'s own exact case, r=2/stroke=0.8 -> radius 1.6)', async () => {
    const boundaryEl = editor._addBoundaryCircle(cx, cy, r);
    boundaryEl.attr('stroke', '#333');
    boundaryEl.attr('stroke-width', '0.8');
    const pattern = basePattern({ shapeId: stampBoundaryRef(boundaryEl) });
    const { segments } = await generatePattern(editor, pattern);
    const centerRail = segments.find((s) => s.kind === 'rail' && s.a.j === cy);
    expect(centerRail.a.i).toBeCloseTo(cx - 1.6, 9);
    expect(centerRail.b.i).toBeCloseTo(cx + 1.6, 9);
  });

  it('an UNSTROKED boundary (no stroke attr, or stroke="none"): no shrink at all -- the raw r=2 crossing', async () => {
    const boundaryEl = editor._addBoundaryCircle(cx, cy, r);
    // no .attr('stroke', ...) at all -- matches a fill-only shape
    const pattern = basePattern({ shapeId: stampBoundaryRef(boundaryEl) });
    const { segments } = await generatePattern(editor, pattern);
    const centerRail = segments.find((s) => s.kind === 'rail' && s.a.j === cy);
    expect(centerRail.a.i).toBeCloseTo(cx - r, 9);
    expect(centerRail.b.i).toBeCloseTo(cx + r, 9);
  });

  it('boundary.edge === "centerline": ignores the stroke entirely, even though it IS visibly stroked (explicit opt-out)', async () => {
    const boundaryEl = editor._addBoundaryCircle(cx, cy, r);
    boundaryEl.attr('stroke', '#333');
    boundaryEl.attr('stroke-width', '0.8');
    const pattern = basePattern({ shapeId: stampBoundaryRef(boundaryEl), edge: 'centerline' });
    const { segments } = await generatePattern(editor, pattern);
    const centerRail = segments.find((s) => s.kind === 'rail' && s.a.j === cy);
    expect(centerRail.a.i).toBeCloseTo(cx - r, 9);
    expect(centerRail.b.i).toBeCloseTo(cx + r, 9);
  });

  it('T74 AMEND 1: an explicit contour.width OVERRIDES the shape\'s raw stroke-width (replaces the retired Border\'s own override rule)', async () => {
    const boundaryEl = editor._addBoundaryCircle(cx, cy, r);
    boundaryEl.attr('stroke', '#333');
    boundaryEl.attr('stroke-width', '0.8'); // the shape's OWN stroke -- must be ignored once contour.width overrides
    const pattern = {
      ...basePattern({ shapeId: stampBoundaryRef(boundaryEl) }),
      contour: { ...PATTERN_DEFAULTS.contour, width: 0.4 }, // deliberately different from the shape's own 0.8
    };
    const { segments } = await generatePattern(editor, pattern);
    const centerRail = segments.find((s) => s.kind === 'rail' && s.a.j === cy);
    // shrink = contour.width/2 = 0.2, NOT the shape's own 0.8/2=0.4
    expect(centerRail.a.i).toBeCloseTo(cx - (r - 0.2), 9);
    expect(centerRail.b.i).toBeCloseTo(cx + (r - 0.2), 9);
  });
});
