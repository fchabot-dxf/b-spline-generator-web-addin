/**
 * T58 (SE14 Slice 3) — wires the Shape Lattice tool's own panel
 * (#editorShapeLatticePanel): Shape (preset/seed/params), Segments
 * (per-segment style + mirroring), and the Fill/Boundary/Ending/Border
 * section this tool now OWNS (moved here from properties-lattice.js's
 * own panel — "the box # Lattice loses its Boundary row"). Same
 * lightweight-but-real `_sketchLayer` mock shape as
 * tests/properties-lattice.test.js's own (so generatePattern/
 * generateSilhouette actually run, not stubs), extended with `.path()`
 * (the silhouette's own element kind, which the box-Lattice mock never
 * needed) and `.clone()` (generatePattern's own Border-piece branch).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initShapeLatticeProperties, regenerateSilhouette, regenerateSilhouetteAndFill, writeSegmentStyle,
  paramHandleRecords, renderShapeLatticeHandles, detectShapeLatticeDetach, openSegmentStyleBar,
  currentPattern, currentShape,
} from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';
import { PATTERN_DEFAULTS, CONTOUR_SEG_INDEX_ATTR, stampBoundaryRef } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

function makeMockEditor() {
  let elements = [];
  // T58: shapeToPrimitives/shapeToInnerBoundaryPrimitives (editor-lattice-
  // boundary.js) dispatch on `el.type` (a real SVG.js element's own tag
  // name, e.g. 'path'/'circle') — the box-Lattice mock this one is based
  // on never needed it (board mode never calls that dispatch at all), but
  // BOUNDARY mode's own `_resolveBoundaryPrimitives` does, so a `<path>`-
  // shaped mock element needs it set or the boundary silently resolves to
  // zero primitives (found live: the first attempt at this test filed
  // "no rail found" against a mock missing exactly this).
  function makeElement(type, initial) {
    const store = { ...initial };
    const elObj = {
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
        return elObj;
      },
      stroke(v) {
        if (typeof v === 'object' && v !== null) {
          if ('color' in v) store.stroke = v.color;
          if ('width' in v) store['stroke-width'] = v.width;
        }
        return elObj;
      },
      fill(v) { if (v !== undefined) store.fill = v; return elObj; },
      center(x, y) { store.cx = x; store.cy = y; return elObj; },
      addClass() { return elObj; },
      removeClass() { return elObj; },
      hasClass() { return false; },
      remove() { elements = elements.filter((e) => e !== elObj); },
      clone() { return makeElement(type, { ...store }); },
    };
    return elObj;
  }
  const sketchLayer = {
    line(x1, y1, x2, y2) { const e = makeElement('line', { x1, y1, x2, y2 }); elements.push(e); return e; },
    circle(d) { const e = makeElement('circle', { r: d / 2 }); elements.push(e); return e; },
    path(d) { const e = makeElement('path', { d }); elements.push(e); return e; },
    add(e) { elements.push(e); return e; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    node: {},
  };
  // T59: a minimal handle layer — renderShapeLatticeHandles only ever
  // calls .circle(), same makeElement shape as the sketch layer's own.
  let handleElements = [];
  const handleLayer = {
    circle(d) { const e = makeElement('circle', { r: d / 2 }); handleElements.push(e); return e; },
    clear() { handleElements = []; },
    children() { const arr = handleElements.slice(); arr.toArray = () => arr; return arr; },
  };
  return {
    _mW: 4, _mH: 6, // deliberately non-square: catches an aspect-ratio-dependent bug a square board would hide
    _sketchLayer: sketchLayer,
    _handleLayer: handleLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    _color: '#000',
    _strokeWidth: 0.02,
    _selectedElements: [],
    _pointerType: 'mouse',
    pushState() {},
    _notifyChange() {},
  };
}

function activeLayerPattern(editor) {
  return editor._layers.find((l) => l.id === editor._activeLayer)?.pattern;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The full panel markup this module reads — one shared fixture, same
 *  "one big fixture, not N tiny ones" shape properties-lattice.test.js's
 *  own per-describe-block fixtures already use, just consolidated since
 *  nearly every test here touches Shape+Fill+Boundary together. */
function fixtureHTML() {
  return `
    <button id="toolShapeLattice"></button>
    <div role="group">
      <button id="shapePresetHourglass" class="editor-fillmode-btn active"></button>
      <button id="shapePresetBottle" class="editor-fillmode-btn"></button>
    </div>
    <input id="shapeSeed" type="number" value="42">
    <button id="shapeReroll"></button>
    <label id="shapeParamRow-waistReach"><input id="shapeParam-waistReach" type="range" min="0.05" max="0.92" step="0.01" value="0.55"></label>
    <label id="shapeParamRow-cornerRadius"><input id="shapeParam-cornerRadius" type="range" min="0.04" max="0.6" step="0.01" value="0.22"></label>
    <label id="shapeParamRow-waistCenterY"><input id="shapeParam-waistCenterY" type="range" min="-0.6" max="0.6" step="0.01" value="0"></label>
    <label id="shapeParamRow-neckWidth" style="display:none"><input id="shapeParam-neckWidth" type="range" min="0.05" max="0.85" step="0.01" value="0.5"></label>
    <label id="shapeParamRow-bodyWidth" style="display:none"><input id="shapeParam-bodyWidth" type="range" min="0.1" max="0.98" step="0.01" value="0.92"></label>
    <label id="shapeParamRow-skeletonX" style="display:none"><input id="shapeParam-skeletonX" type="range" min="0.1" max="0.95" step="0.01" value="0.72"></label>
    <label id="shapeParamRow-neckLength" style="display:none"><input id="shapeParam-neckLength" type="range" min="0.08" max="0.85" step="0.01" value="0.32"></label>

    <select id="shapeSegmentIndex"></select>
    <div role="group">
      <button id="shapeSegStyleStraight" class="editor-fillmode-btn active"></button>
      <button id="shapeSegStyleCurve" class="editor-fillmode-btn"></button>
      <button id="shapeSegStyleKink" class="editor-fillmode-btn"></button>
    </div>
    <div id="shapeSegCurveFields" style="display:none">
      <div role="group">
        <button id="shapeSegDirOut" class="editor-fillmode-btn active"></button>
        <button id="shapeSegDirIn" class="editor-fillmode-btn"></button>
      </div>
      <input id="shapeSegBulge" type="range" min="0" max="0.99" step="0.01" value="0.5">
    </div>

    <select id="shapeLatticeSpacing"></select>
    <button id="shapeLatticeOrientHorizontal" class="editor-fillmode-btn active"></button>
    <button id="shapeLatticeOrientVertical" class="editor-fillmode-btn"></button>
    <button id="shapeLatticeRailsModeCount" class="editor-fillmode-btn active"></button>
    <button id="shapeLatticeRailsModeEvery" class="editor-fillmode-btn"></button>
    <input id="shapeLatticeRailsCountMin" type="number" value="6">
    <input id="shapeLatticeRailsCountMax" type="number" value="7">
    <input id="shapeLatticeRailsEvery" type="number" value="2">
    <input id="shapeLatticeRailsOffset" type="number" value="0">
    <button id="shapeLatticeTiesModeCount" class="editor-fillmode-btn active"></button>
    <button id="shapeLatticeTiesModeDensity" class="editor-fillmode-btn"></button>
    <input id="shapeLatticeTiesCountMin" type="number" value="8">
    <input id="shapeLatticeTiesCountMax" type="number" value="13">
    <button id="shapeLatticeTiesSpanModeCells" class="editor-fillmode-btn active"></button>
    <button id="shapeLatticeTiesSpanModeRails" class="editor-fillmode-btn"></button>
    <input id="shapeLatticeTiesDensity" type="range" value="0.4">
    <input id="shapeLatticeTiesSpanMin" type="number" value="1">
    <input id="shapeLatticeTiesSpanMax" type="number" value="3">
    <select id="shapeLatticeTiesAnchor"><option value="free" selected>free</option></select>
    <input id="shapeLatticeTiesRailSnapRows" type="number" value="1">
    <input id="shapeLatticeTiesOneEnded" type="number" value="1">
    <input id="shapeLatticeNodesEnds" type="checkbox" checked>
    <input id="shapeLatticeNodesCrossings" type="checkbox" checked>
    <input id="shapeLatticeNodesRailEnds" type="checkbox">
    <input id="shapeLatticeSeed" type="number" value="42">
    <button id="shapeLatticeGenerate"></button>
    <button id="shapeLatticeDetachAll"></button>
    <button id="shapeLatticeColorRails"></button>
    <button id="shapeLatticeColorTies"></button>
    <button id="shapeLatticeColorNodes"></button>
    <button id="shapeLatticeColorContour"></button>
    <div id="shapeLatticeWidthUnlinkedFields" style="display:none;">
      <input id="shapeLatticeWidthRails" type="number">
      <input id="shapeLatticeWidthTies" type="number">
    </div>
    <label id="shapeLatticeWidthLinkedRow"><input id="shapeLatticeWidthLinked" type="number"></label>
    <button id="shapeLatticeWidthLinkToggle" class="editor-fillmode-btn active"></button>
    <input id="shapeLatticeWidthNodes" type="number">

    <span id="shapeLatticeBoundaryStatus"></span>
    <div role="group" id="shapeLatticeEndRule"></div>
    <input id="shapeLatticeContourShow" type="checkbox" checked>
    <input id="shapeLatticeBorderEnabled" type="checkbox">
    <input id="shapeLatticeBorderWidth" type="number">
    <button id="shapeLatticeBorderColor"></button>
    <button id="shapeLatticeBorderColorAuto" class="editor-fillmode-btn active"></button>
  `;
}

let container, editor;
beforeEach(() => {
  container = document.createElement('div');
  container.innerHTML = fixtureHTML();
  document.body.appendChild(container);
  editor = makeMockEditor();
});
afterEach(() => {
  container.remove();
  document.querySelectorAll('.color-mosaic-popover').forEach((p) => p.remove());
});

describe('initShapeLatticeProperties: Shape section', () => {
  it('Hourglass is active by default; hourglass params are shown, bottle params hidden', () => {
    initShapeLatticeProperties(editor);
    expect(document.getElementById('shapePresetHourglass').classList.contains('active')).toBe(true);
    expect(document.getElementById('shapeParamRow-waistReach').style.display).not.toBe('none');
    expect(document.getElementById('shapeParamRow-neckWidth').style.display).toBe('none');
  });

  it('switching to Bottle flips the toggle, shows bottle params, hides hourglass params, and regenerates the linked silhouette', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapePresetBottle').click();
    await flush();
    expect(document.getElementById('shapePresetBottle').classList.contains('active')).toBe(true);
    expect(document.getElementById('shapeParamRow-neckWidth').style.display).not.toBe('none');
    expect(document.getElementById('shapeParamRow-waistReach').style.display).toBe('none');
    expect(activeLayerPattern(editor).shape.preset).toBe('bottle');
    const path = editor._sketchLayer.children().find((e) => e.attr('d'));
    expect(path).toBeDefined();
    expect(path.attr('d').length).toBeGreaterThan(0);
  });

  it('non-vacuous: the reroll button picks a NEW seed and changes the silhouette geometry', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeReroll').click();
    await flush();
    const dAfterFirstRoll = editor._sketchLayer.children().find((e) => e.attr('d'))?.attr('d');
    const seedAfterFirstRoll = activeLayerPattern(editor).shape.seed;
    expect(seedAfterFirstRoll).not.toBe(PATTERN_DEFAULTS.shape.seed);

    document.getElementById('shapeReroll').click();
    await flush();
    const seedAfterSecondRoll = activeLayerPattern(editor).shape.seed;
    expect(seedAfterSecondRoll).not.toBe(seedAfterFirstRoll);
    // A different seed's OWN jitter draw very rarely reproduces the exact
    // same `d` string across two consecutive small-int seeds (T54/T57's
    // own fmix32 fix is exactly what makes THIS true, not incidental).
    const dAfterSecondRoll = editor._sketchLayer.children().find((e) => e.attr('d'))?.attr('d');
    expect(dAfterSecondRoll).not.toBe(dAfterFirstRoll);
  });

  it('non-vacuous: editing a param (waist reach) changes the silhouette geometry without touching the seed', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeReroll').click(); // establish a first linked path
    await flush();
    const dBefore = editor._sketchLayer.children().find((e) => e.attr('d'))?.attr('d');
    const seedBefore = activeLayerPattern(editor).shape.seed;

    const waistEl = document.getElementById('shapeParam-waistReach');
    waistEl.value = '0.8';
    waistEl.dispatchEvent(new Event('change'));
    await flush();

    expect(activeLayerPattern(editor).shape.params.waistReach).toBe(0.8);
    expect(activeLayerPattern(editor).shape.seed).toBe(seedBefore);
    const dAfter = editor._sketchLayer.children().find((e) => e.attr('d'))?.attr('d');
    expect(dAfter).not.toBe(dBefore);
  });

  it('T73: regenerating updates the SAME per-segment elements in place (N segments, not a growing pile)', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeReroll').click();
    await flush();
    const firstSegs = editor._sketchLayer.children().filter((e) => e.node.hasAttribute(CONTOUR_SEG_INDEX_ATTR));
    const countAfterFirst = firstSegs.length;
    expect(countAfterFirst).toBeGreaterThan(0);
    document.getElementById('shapeReroll').click();
    await flush();
    const segs = editor._sketchLayer.children().filter((e) => e.node.hasAttribute(CONTOUR_SEG_INDEX_ATTR));
    expect(segs.length).toBe(countAfterFirst);
  });
});

describe('initShapeLatticeProperties: Segments section', () => {
  it('the segment list is populated BEFORE any Generate press (a pure preview of the fresh default), with the hourglass\'s own 12 entries', () => {
    initShapeLatticeProperties(editor);
    const select = document.getElementById('shapeSegmentIndex');
    expect(select.options.length).toBe(12);
    expect(select.options[0].textContent).toMatch(/R horn/);
  });

  it('switching to Bottle re-lists 10 segments', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapePresetBottle').click();
    await flush();
    const select = document.getElementById('shapeSegmentIndex');
    expect(select.options.length).toBe(10);
  });

  it('picking Curve on segment 0 shows the curve fields and defaults the bulge to a nonzero value', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeSegmentIndex').value = '0';
    document.getElementById('shapeSegStyleCurve').click();
    await flush();
    expect(document.getElementById('shapeSegStyleCurve').classList.contains('active')).toBe(true);
    expect(document.getElementById('shapeSegCurveFields').style.display).not.toBe('none');
    const shape = activeLayerPattern(editor).shape;
    expect(shape.segments[0].style).toBe('curve');
    expect(shape.segments[0].bulge).toBeGreaterThan(0);
  });

  it('SE14 §4: editing segment 0 (right shoulder) ALSO writes its mirror (segment 10, left shoulder) with the SAME style/bulge/dir', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeSegmentIndex').value = '0';
    document.getElementById('shapeSegStyleKink').click();
    document.getElementById('shapeSegDirIn').click();
    await flush();
    const segs = activeLayerPattern(editor).shape.segments;
    expect(segs[10].style).toBe('kink');
    expect(segs[10].dir).toBe('in');
    expect(segs[10].bulge).toBe(segs[0].bulge);
  });

  it('editing a CAP segment (index 5, the bottom edge) does NOT touch any other segment (no mirror partner)', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeSegmentIndex').value = '5';
    document.getElementById('shapeSegStyleKink').click();
    await flush();
    const segs = activeLayerPattern(editor).shape.segments;
    expect(segs[5].style).toBe('kink');
    for (let i = 0; i < segs.length; i++) {
      if (i === 5) continue;
      expect(segs[i].style).not.toBe('kink');
    }
  });

  it('selecting a different segment in the list reflects ITS OWN style, not the previously-edited one', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeSegmentIndex').value = '0';
    document.getElementById('shapeSegStyleCurve').click();
    await flush();

    const select = document.getElementById('shapeSegmentIndex');
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    // segment 1 (the shoulder arc) is a 'curve' by the GENERATOR's own
    // fresh default (editor-shape-lattice-generator.js's _solveHourglass)
    // — a real, independently-known expectation, not just "whatever the
    // code produces".
    expect(document.getElementById('shapeSegStyleCurve').classList.contains('active')).toBe(true);
  });
});

describe('initShapeLatticeProperties: Fill + Generate', () => {
  it('pressing Generate (bottom button) fills rails/ties INSIDE the generated boundary, non-vacuously', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeLatticeGenerate').click();
    await flush();
    const rail = editor._sketchLayer.children().find((e) => e.attr('data-lattice') === 'rail');
    const path = editor._sketchLayer.children().find((e) => e.attr('d'));
    expect(path).toBeDefined();
    expect(path.attr('data-boundary-ref')).toBeTruthy();
    expect(rail).toBeDefined();
    expect(activeLayerPattern(editor).extent).toEqual({ mode: 'boundary' });
    expect(activeLayerPattern(editor).boundary.shapeId).toBe(path.attr('data-boundary-ref'));
  });

  it('the Generate button label flips to Regenerate after the first press', async () => {
    initShapeLatticeProperties(editor);
    const btn = document.getElementById('shapeLatticeGenerate');
    expect(btn.textContent).toBe('Generate');
    btn.click();
    await flush();
    expect(btn.textContent).toBe('Regenerate');
  });

  it('T67 AMEND 3+4: a fresh pattern reads PATTERN_DEFAULTS.ties.oneEnded (1) onto the One-ended ties field, and Generate writes an edited value back into PATTERN.ties.oneEnded', async () => {
    initShapeLatticeProperties(editor);
    expect(document.getElementById('shapeLatticeTiesOneEnded').value).toBe(String(PATTERN_DEFAULTS.ties.oneEnded));
    document.getElementById('shapeLatticeTiesOneEnded').value = '2';
    document.getElementById('shapeLatticeGenerate').click();
    await flush();
    expect(activeLayerPattern(editor).ties.oneEnded).toBe(2);
  });

  it('the Ending segmented group is populated from the 4 declared rules and defaults to "inset"', () => {
    initShapeLatticeProperties(editor);
    const group = document.getElementById('shapeLatticeEndRule');
    const values = Array.from(group.children).map((b) => b.dataset.value);
    expect(values).toEqual(['on-boundary', 'inset', 'joint', 'loose']);
    expect(group.querySelector('.active').dataset.value).toBe('inset');
  });

  it('clicking an Ending button moves .active to it, and Generate reads that value into the pattern', async () => {
    initShapeLatticeProperties(editor);
    const group = document.getElementById('shapeLatticeEndRule');
    group.querySelector('[data-value="loose"]').click();
    expect(group.querySelector('.active').dataset.value).toBe('loose');
    document.getElementById('shapeLatticeGenerate').click();
    await flush();
    expect(activeLayerPattern(editor).boundary.endRule).toBe('loose');
  });

  it('Border enabled/width checkboxes write PATTERN.boundary.border on Generate', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeLatticeBorderEnabled').checked = true;
    document.getElementById('shapeLatticeBorderWidth').value = '0.1';
    document.getElementById('shapeLatticeGenerate').click();
    await flush();
    const border = activeLayerPattern(editor).boundary.border;
    expect(border.enabled).toBe(true);
    expect(border.width).toBe(0.1);
  });

  it('the Border color swatch: picking a color sets an explicit override; clicking "auto" resets it to null', () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeLatticeBorderColor').click();
    const targetHex = '#1a237e';
    document.querySelector(`.color-mosaic-cell[title="${targetHex}"]`).click();
    expect(activeLayerPattern(editor).boundary.border.color).toBe(targetHex);
    expect(document.getElementById('shapeLatticeBorderColorAuto').classList.contains('active')).toBe(false);

    document.getElementById('shapeLatticeBorderColorAuto').click();
    expect(activeLayerPattern(editor).boundary.border.color).toBeNull();
    expect(document.getElementById('shapeLatticeBorderColorAuto').classList.contains('active')).toBe(true);
  });
});

describe('initShapeLatticeProperties: a saved pattern with a hand-picked boundary (SE14d: no UI to create a new one, but an existing one keeps working)', () => {
  it('generating a silhouette on a pattern with an existing hand-picked boundary mints a FRESH path, leaving the picked element untouched (never overwrites a shape the user drew)', async () => {
    initShapeLatticeProperties(editor);
    // A REAL element the mock's own _findBoundaryElements CAN find (unlike
    // a bare target object never added to _sketchLayer's own children —
    // using one here would let this test pass trivially even without the
    // guard under test, since the lookup would already miss it). SE14d
    // removed the "Pick shape…" button; a pre-existing picked pattern
    // (loaded from a save, or seeded directly here the way this test
    // does) still carries this exact shape/boundary state and must still
    // behave identically — nothing in `regenerateSilhouette`'s own
    // `reuseExisting` guard is button-driven.
    const handDrawnCircle = editor._sketchLayer.circle(3).center(1, 1);
    const id = stampBoundaryRef(handDrawnCircle);
    const p = currentPattern(editor);
    p.boundary = { ...PATTERN_DEFAULTS.boundary, ...p.boundary, shapeId: id };
    p.extent = { mode: 'boundary' };
    currentShape(p).source = 'picked';
    expect(handDrawnCircle.attr('r')).toBe(1.5); // the circle's own real geometry, unrelated to any path 'd'

    document.getElementById('shapeReroll').click();
    await flush();

    expect(handDrawnCircle.attr('r')).toBe(1.5); // untouched by the regenerate
    expect(handDrawnCircle.attr('d')).toBeUndefined(); // never given path geometry
    const generatedPath = editor._sketchLayer.children().find((e) => e.attr('d'));
    expect(generatedPath).toBeDefined();
    expect(generatedPath).not.toBe(handDrawnCircle); // a DIFFERENT, new element
    expect(activeLayerPattern(editor).boundary.shapeId).toBe(generatedPath.attr('data-boundary-ref'));
    expect(activeLayerPattern(editor).shape.source).toBe('generated');
  });
});

describe('initShapeLatticeProperties (T72, SE14c): "show contour" checkbox', () => {
  it('checked by default; syncs to the pattern\'s own contour.show on tool-open', () => {
    initShapeLatticeProperties(editor);
    expect(document.getElementById('shapeLatticeContourShow').checked).toBe(true);
  });

  it('unchecking it IMMEDIATELY writes contour.show=false and hides the drawn contour -- no Generate click needed', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeReroll').click(); // Shape section fields regenerate immediately (T59) -- links a real contour path first
    await flush();
    const pathEl = editor._sketchLayer.children().find((e) => e.attr('d'));
    expect(pathEl).toBeDefined();
    expect(pathEl.attr('display')).not.toBe('none'); // non-vacuous: genuinely visible beforehand

    const cb = document.getElementById('shapeLatticeContourShow');
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await flush();

    expect(activeLayerPattern(editor).contour).toEqual({ show: false, segmentColors: [] });
    expect(pathEl.attr('display')).toBe('none'); // SAME element, still live -- just hidden
  });

  it('re-checking it shows the contour again (display attribute cleared)', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeReroll').click();
    await flush();
    const cb = document.getElementById('shapeLatticeContourShow');
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await flush();
    const pathEl = editor._sketchLayer.children().find((e) => e.attr('d'));
    expect(pathEl.attr('display')).toBe('none');

    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await flush();
    expect(activeLayerPattern(editor).contour).toEqual({ show: true, segmentColors: [] });
    expect(pathEl.attr('display')).not.toBe('none');
  });
});

/**
 * T58 ADD-ON (mid-task amendment, Fred: "I normally want ties and rails
 * to be the same width") — the SAME shared widths.linkRailsTies contract
 * properties-lattice.test.js's own box-Lattice panel already covers,
 * exercised here against THIS tool's own shapeLattice*-prefixed ids (a
 * second real caller of the SAME rewidthOwnedKinds/migration logic, not a
 * re-derivation of it).
 */
describe('initShapeLatticeProperties (T58 ADD-ON): linked Rails & ties width', () => {
  it('linked by default on a brand-new pattern: the combined stepper shows, the separate pair is hidden', () => {
    initShapeLatticeProperties(editor);
    expect(document.getElementById('shapeLatticeWidthLinkToggle').classList.contains('active')).toBe(true);
    expect(document.getElementById('shapeLatticeWidthUnlinkedFields').style.display).toBe('none');
    expect(document.getElementById('shapeLatticeWidthLinked').value).toBe(String(PATTERN_DEFAULTS.widths.rails));
  });

  it('Generate writes the combined stepper\'s value into BOTH widths.rails and widths.ties, plus linkRailsTies:true', () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeLatticeWidthLinked').value = '0.12';
    document.getElementById('shapeLatticeGenerate').click();
    const widths = activeLayerPattern(editor).widths;
    expect(widths.rails).toBe(0.12);
    expect(widths.ties).toBe(0.12);
    expect(widths.linkRailsTies).toBe(true);
  });

  it('non-vacuous: editing the combined stepper LIVE re-widths BOTH already-owned rails and ties, in exactly ONE undo step', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeLatticeGenerate').click();
    await flush();
    let pushCount = 0;
    editor.pushState = () => { pushCount++; };

    document.getElementById('shapeLatticeWidthLinked').value = '0.2';
    document.getElementById('shapeLatticeWidthLinked').dispatchEvent(new Event('change'));

    const rail = editor._sketchLayer.children().find((e) => e.attr('data-lattice') === 'rail');
    const tie = editor._sketchLayer.children().find((e) => e.attr('data-lattice') === 'tie');
    expect(rail.attr('stroke-width')).toBe(0.2);
    expect(tie.attr('stroke-width')).toBe(0.2);
    expect(pushCount).toBe(1);
  });

  it('clicking the chain toggle unlinks: the separate Rails/Ties steppers reappear, with NO value change', async () => {
    initShapeLatticeProperties(editor);
    document.getElementById('shapeLatticeGenerate').click();
    await flush();
    document.getElementById('shapeLatticeWidthLinkToggle').click();
    expect(document.getElementById('shapeLatticeWidthLinkToggle').classList.contains('active')).toBe(false);
    expect(document.getElementById('shapeLatticeWidthUnlinkedFields').style.display).not.toBe('none');
    expect(activeLayerPattern(editor).widths.rails).toBe(activeLayerPattern(editor).widths.ties);
  });

  it('an EXISTING pattern with rails !== ties (no linkRailsTies key) loads UNLINKED — "no silent change"', () => {
    editor._layers[0].pattern = {
      ...JSON.parse(JSON.stringify(PATTERN_DEFAULTS)),
      widths: { rails: 0.1, ties: 0.04, nodeRadius: 0.075 },
    };
    initShapeLatticeProperties(editor);
    expect(document.getElementById('shapeLatticeWidthLinkToggle').classList.contains('active')).toBe(false);
  });
});

/**
 * T59 (axis-locked handles + tap-a-segment) — the module-level exports
 * the canvas interaction code (editor-interaction.js) calls directly,
 * without a mounted panel. No `initShapeLatticeProperties(editor)` call
 * in this describe block — proving these genuinely work standalone, the
 * whole point of lifting them out of the panel's own closures.
 */
describe('properties-shape-lattice.js: module-level exports (T59)', () => {
  it('T73: regenerateSilhouette creates the N linked per-segment paths; a second call (same segment count) updates them IN PLACE (same elements)', () => {
    const p = currentPattern(editor);
    const first = regenerateSilhouette(editor, p);
    expect(first.length).toBeGreaterThan(0);
    currentShape(p).params = { waistReach: 0.8 };
    const second = regenerateSilhouette(editor, p);
    const paths = editor._sketchLayer.children().filter((e) => e.node.hasAttribute(CONTOUR_SEG_INDEX_ATTR));
    expect(paths.length).toBe(first.length);
    expect(second.every((el, i) => el === first[i])).toBe(true);
  });

  it('T72 (AMEND 2): a freshly-minted contour draws in PATTERN.colors.contour, not the general drawing tool\'s current color', () => {
    const p = currentPattern(editor);
    editor._color = '#ff00ff'; // a DIFFERENT color -- proves the contour does NOT inherit this
    const pathEls = regenerateSilhouette(editor, p);
    for (const pathEl of pathEls) {
      expect(pathEl.attr('stroke')).toBe(PATTERN_DEFAULTS.colors.contour);
      expect(pathEl.attr('stroke')).not.toBe('#ff00ff');
    }
  });

  it('T72 (AMEND 2): a custom PATTERN.colors.contour is honored for a freshly-minted path', () => {
    const p = currentPattern(editor);
    p.colors = { ...PATTERN_DEFAULTS.colors, contour: '#ab12cd' };
    const pathEls = regenerateSilhouette(editor, p);
    for (const pathEl of pathEls) {
      expect(pathEl.attr('stroke')).toBe('#ab12cd');
    }
  });

  it('regenerateSilhouetteAndFill fills AND dispatches SHAPE_CHANGED_EVENT', async () => {
    let fired = 0;
    document.addEventListener('editorShapeLatticeChanged', () => { fired++; });
    await regenerateSilhouetteAndFill(editor);
    const rail = editor._sketchLayer.children().find((e) => e.attr('data-lattice') === 'rail');
    expect(rail).toBeDefined();
    expect(fired).toBe(1);
  });

  it('writeSegmentStyle writes + mirrors, matching the panel\'s own SE14 §4 rule', async () => {
    await regenerateSilhouetteAndFill(editor); // establish shape.segments (hourglass, n=12)
    await writeSegmentStyle(editor, 0, { style: 'kink', bulge: 0.4, dir: 'in' });
    const shape = currentShape(currentPattern(editor));
    expect(shape.segments[0].style).toBe('kink');
    expect(shape.segments[10].style).toBe('kink'); // mirror of 0 in a 12-segment hourglass
    expect(shape.segments[10].bulge).toBe(0.4);
  });

  describe('paramHandleRecords / renderShapeLatticeHandles', () => {
    it('T72 (AMEND 2, Fred\'s phone screenshot): returns [] before any Generate, even though shape.source already reads \'generated\' (PATTERN_DEFAULTS\' own default, materialized the first time anything touches p.shape) -- source alone was never enough to prove a silhouette actually exists', () => {
      const p = currentPattern(editor);
      expect(currentShape(p).source).toBe('generated'); // non-vacuous: the misleading default this bug hinges on is genuinely present
      expect(p.extent).toBeUndefined(); // and Generate genuinely hasn't run -- no {mode:'boundary'} yet
      expect(paramHandleRecords(editor)).toEqual([]);
    });

    it('T72 (AMEND 2): 0 handles pre-Generate, 3 after -- the dispatch\'s own exact acceptance test', () => {
      expect(paramHandleRecords(editor).length).toBe(0);
      regenerateSilhouette(editor, currentPattern(editor));
      expect(paramHandleRecords(editor).length).toBe(3); // hourglass's own 3 declared params
    });

    it('returns [] once the linked shape is hand-PICKED (source==\'picked\') — nothing to drag', () => {
      const p = currentPattern(editor);
      regenerateSilhouette(editor, p); // link a generated shape first
      currentShape(p).source = 'picked';
      expect(paramHandleRecords(editor)).toEqual([]);
    });

    it('one handle per declared param, for the CURRENT preset (bottle: 4)', () => {
      const p = currentPattern(editor);
      currentShape(p).preset = 'bottle';
      regenerateSilhouette(editor, p); // T72: a real Generate must have run first
      const records = paramHandleRecords(editor);
      expect(records.length).toBe(4);
      expect(records.map((r) => r.key).sort()).toEqual(['bodyWidth', 'neckLength', 'neckWidth', 'skeletonX']);
    });

    it('non-vacuous: renderShapeLatticeHandles draws exactly one circle per record into _handleLayer', () => {
      regenerateSilhouette(editor, currentPattern(editor)); // T72: a real Generate must have run first
      const drawn = renderShapeLatticeHandles(editor);
      expect(drawn.length).toBe(3);
      const circles = editor._handleLayer.children();
      expect(circles.length).toBe(3);
    });

    it('each returned record is hitTestHandle-compatible (has hx/hy/hitR) and hitR is a real positive number', () => {
      const drawn = renderShapeLatticeHandles(editor);
      for (const r of drawn) {
        expect(typeof r.hx).toBe('number');
        expect(typeof r.hy).toBe('number');
        expect(r.hitR).toBeGreaterThan(0);
      }
    });
  });

  describe('detectShapeLatticeDetach (SE14 §6, "recompute-and-compare")', () => {
    it('does NOT materialize a pattern on a layer that never touched either Lattice tool (regression: the exact bug the full suite caught)', () => {
      expect(editor._layers[0].pattern).toBeUndefined();
      detectShapeLatticeDetach(editor);
      expect(editor._layers[0].pattern).toBeUndefined();
    });

    it('no-op when the linked shape is already \'picked\' (nothing generated to compare against)', () => {
      const p = currentPattern(editor);
      regenerateSilhouette(editor, p);
      currentShape(p).source = 'picked';
      detectShapeLatticeDetach(editor);
      expect(currentShape(p).source).toBe('picked'); // unchanged
    });

    it('stays \'generated\' when the linked path\'s own `d` still matches (idempotent — no false positive)', () => {
      const p = currentPattern(editor);
      regenerateSilhouette(editor, p);
      detectShapeLatticeDetach(editor);
      expect(currentShape(p).source).toBe('generated');
    });

    it('non-vacuous: flips to \'picked\' when a linked segment\'s own `d` has been hand-edited (a real Node-mode drag, simulated)', () => {
      const p = currentPattern(editor);
      const pathEls = regenerateSilhouette(editor, p);
      const seg = pathEls[0];
      seg.attr('d', seg.attr('d') + ' L 0.01 0.01'); // simulate a hand node-drag mutating the live d
      detectShapeLatticeDetach(editor);
      expect(currentShape(p).source).toBe('picked');
    });
  });

  describe('openSegmentStyleBar', () => {
    afterEach(() => {
      document.querySelectorAll('.shape-lattice-segment-bar').forEach((el) => el.remove());
    });

    it('opens a floating bar with 3 style buttons, straight active by default', async () => {
      await regenerateSilhouetteAndFill(editor);
      openSegmentStyleBar(editor, 1, 100, 100); // segment 1 = the shoulder arc, a 'curve' by the generator's own fresh default
      const bar = document.querySelector('.shape-lattice-segment-bar');
      expect(bar).toBeTruthy();
      const buttons = Array.from(bar.querySelectorAll('button'));
      expect(buttons.map((b) => b.textContent)).toEqual(['Straight', 'Curve', 'Kink']);
      expect(buttons[1].classList.contains('active')).toBe(true); // 'Curve', matching segment 1's own fresh default
    });

    it('clicking a style button writes it via writeSegmentStyle and closes the bar', async () => {
      await regenerateSilhouetteAndFill(editor);
      openSegmentStyleBar(editor, 0, 100, 100);
      const bar = document.querySelector('.shape-lattice-segment-bar');
      const kinkBtn = Array.from(bar.querySelectorAll('button')).find((b) => b.textContent === 'Kink');
      kinkBtn.click();
      await flush();
      expect(currentShape(currentPattern(editor)).segments[0].style).toBe('kink');
      expect(document.querySelector('.shape-lattice-segment-bar')).toBeNull();
    });

    it('opening a SECOND bar closes the first (no stacking popups)', async () => {
      await regenerateSilhouetteAndFill(editor);
      openSegmentStyleBar(editor, 0, 100, 100);
      openSegmentStyleBar(editor, 1, 200, 200);
      expect(document.querySelectorAll('.shape-lattice-segment-bar').length).toBe(1);
    });
  });
});
