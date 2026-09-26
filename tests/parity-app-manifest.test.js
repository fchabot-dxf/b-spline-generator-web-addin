/**
 * T68 AMEND 2 (Fred: "make sure the drawing in the addin matches the one
 * we insert in fusion") — PARITY as a permanent, declared check: every
 * piece the app itself DRAWS on the canvas (rails, ties, nodes, contour
 * segments — via `generatePattern`/`regenerateSilhouette`, the SAME
 * functions a real editing session calls) must correspond to EXACTLY ONE
 * `buildSketchManifest` entity with identical geometry, and vice versa —
 * no extras, none missing. The drawn pieces live in NATURAL board-inches
 * space; the manifest is in CARVE space (T64's own `applyCarvePlacement`)
 * — every comparison here transforms the drawn piece's own raw coordinate
 * through the SAME `toCarvePoint` formula rather than comparing across
 * two different coordinate systems by accident.
 *
 * Uses the SAME lightweight-but-real mock editor/sketchLayer shape
 * `tests/properties-lattice.test.js`'s own `makeMockEditor` already
 * established (`.line()`/`.circle()`/`.path()` elements exposing
 * `.attr(k)` to read back their own drawn geometry) — `generatePattern`/
 * `regenerateSilhouette` run FOR REAL against it, not a stub.
 */
import { describe, it, expect } from 'vitest';
import { generatePattern, PATTERN_DEFAULTS, CONTOUR_SEG_INDEX_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { buildSketchManifest } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { regenerateSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';
import { generateSilhouette, generateContourSilhouette, primitiveToPathD } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { insetRegionForContour } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js';

function makeMockEditor(mW, mH) {
  let elements = [];
  // T68 AMEND 1's own hard-won lesson (already documented once in
  // properties-shape-lattice.test.js's own mock): shapeToInnerBoundaryPrimitives
  // (editor-lattice-boundary.js) dispatches on `el.type` (a real SVG.js
  // element's own tag name) — a mock element missing it silently resolves
  // the boundary to zero primitives, no error, just an empty drawing.
  // `stroke()` also needs to capture `width` (not just `color`), since
  // `_effectiveContourWidth` (editor-lattice-pattern.js) reads the drawn
  // boundary's own live `stroke-width` back.
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
          if ('linecap' in v) store['stroke-linecap'] = v.linecap;
          if ('linejoin' in v) store['stroke-linejoin'] = v.linejoin;
        }
        return elObj;
      },
      fill(v) { if (v !== undefined) store.fill = v; return elObj; },
      center(x, y) { store.cx = x; store.cy = y; return elObj; },
      clone() { return makeElement(type, { ...store }); },
      addClass() { return elObj; },
      removeClass() { return elObj; },
      hasClass() { return false; },
      remove() { elements = elements.filter((e) => e !== elObj); },
    };
    return elObj;
  }
  const sketchLayer = {
    line(x1, y1, x2, y2) { const e = makeElement('line', { x1, y1, x2, y2 }); elements.push(e); return e; },
    circle(d) { const e = makeElement('circle', { r: d / 2 }); elements.push(e); return e; },
    path(d) { const e = makeElement('path', { d }); elements.push(e); return e; },
    // T72 (AMEND 3 parity test): registers a standalone (not auto-tracked)
    // cloned element, mirroring SVG.js's own `.add()`.
    add(e) { elements.push(e); return e; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    node: {},
  };
  return {
    _mW: mW, _mH: mH,
    _sketchLayer: sketchLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    _color: '#000',
    _strokeWidth: 0.02,
    _selectedElements: [],
    pushState() {},
    _notifyChange() {},
  };
}

function toCarvePoint(pt, region) {
  return { x: pt.x - region.w / 2, y: region.h / 2 - pt.y };
}

function pointsMatch(manifestP, [x, y], tol = 1e-6) {
  return Math.abs(manifestP[0] - x) < tol && Math.abs(manifestP[1] - y) < tol;
}

/** Checks lattice pieces (rails+ties as drawn lines, nodes as drawn
 *  circles) match the manifest's own Slot/Circle entities 1:1, in BOTH
 *  directions — no extras, none missing. */
function checkLatticeParity(editor, manifest, region) {
  const drawn = editor._sketchLayer.children().toArray().filter((e) => e.attr('data-lattice'));
  const drawnPieces = drawn.filter((e) => e.attr('data-lattice') === 'rail' || e.attr('data-lattice') === 'tie');
  // T69: the contour's own segN entities are ALSO type 'Slot'/'Arc3PointSlot'
  // now -- excluded here by id prefix, since this check is specifically
  // about the LATTICE FILL (rails/ties), not the silhouette contour.
  const manifestPieces = manifest.entities.filter((e) => e.type === 'Slot' && !e.id.startsWith('seg'));
  expect(drawnPieces.length).toBe(manifestPieces.length); // non-vacuous: counts themselves must agree
  const usedManifest = new Set();
  for (const d of drawnPieces) {
    const p1 = toCarvePoint({ x: d.attr('x1'), y: d.attr('y1') }, region);
    const p2 = toCarvePoint({ x: d.attr('x2'), y: d.attr('y2') }, region);
    const matches = manifestPieces.filter((m) => pointsMatch(m.p1, [p1.x, p1.y]) && pointsMatch(m.p2, [p2.x, p2.y]));
    expect(matches.length).toBe(1); // exactly one -- not zero (missing), not >1 (a coincidental duplicate)
    usedManifest.add(matches[0].id);
  }
  expect(usedManifest.size).toBe(manifestPieces.length); // vice versa: every manifest piece got claimed by exactly one drawn line

  const drawnNodes = drawn.filter((e) => e.attr('data-lattice') === 'node');
  const manifestNodes = manifest.entities.filter((e) => e.type === 'Circle' && e.id.match(/^node\d+$/));
  expect(drawnNodes.length).toBe(manifestNodes.length);
  const usedNodes = new Set();
  for (const d of drawnNodes) {
    const c = toCarvePoint({ x: d.attr('cx'), y: d.attr('cy') }, region);
    const matches = manifestNodes.filter((m) => pointsMatch(m.center, [c.x, c.y]));
    expect(matches.length).toBe(1);
    usedNodes.add(matches[0].id);
  }
  expect(usedNodes.size).toBe(manifestNodes.length);
}

describe('parity: box lattice — app drawing vs buildSketchManifest', () => {
  for (const oneEnded of [0, 2]) {
    it(`default box lattice, oneEnded=${oneEnded}, seed 42: every drawn rail/tie/node has exactly one identical manifest entity, and vice versa`, async () => {
      const editor = makeMockEditor(7, 9);
      const pattern = { ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42, ties: { ...PATTERN_DEFAULTS.ties, oneEnded } };
      await generatePattern(editor, pattern);
      const region = { x: 0, y: 0, w: editor._mW, h: editor._mH };
      const manifest = buildSketchManifest(pattern, region, {});
      checkLatticeParity(editor, manifest, region);
    });
  }

  it('a non-default seed (17) also holds parity — not a coincidence of one specific seed', async () => {
    const editor = makeMockEditor(7, 9);
    const pattern = { ...PATTERN_DEFAULTS, spacing: 0.25, seed: 17 };
    await generatePattern(editor, pattern);
    const region = { x: 0, y: 0, w: editor._mW, h: editor._mH };
    const manifest = buildSketchManifest(pattern, region, {});
    checkLatticeParity(editor, manifest, region);
  });
});

describe('parity: shape lattice (hourglass) — app drawing vs buildSketchManifest', () => {
  function shapePattern(overrides = {}) {
    return {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
      ...overrides,
    };
  }

  for (const oneEnded of [0, 2]) {
    it(`default shape lattice, oneEnded=${oneEnded}: lattice fill parity holds (same as box lattice, boundary-clipped)`, async () => {
      const editor = makeMockEditor(7, 9);
      const pattern = shapePattern({ ties: { ...PATTERN_DEFAULTS.ties, oneEnded } });
      regenerateSilhouette(editor, pattern);
      await generatePattern(editor, pattern);
      const region = { x: 0, y: 0, w: editor._mW, h: editor._mH };
      const manifest = buildSketchManifest(pattern, region, {});
      checkLatticeParity(editor, manifest, region);
    });
  }

  it('a non-default seed (17) also holds parity on the shape lattice — not a coincidence of one specific seed', async () => {
    const editor = makeMockEditor(7, 9);
    const pattern = shapePattern({ seed: 17, shape: { source: 'generated', preset: 'hourglass', seed: 17, params: {}, segments: null } });
    regenerateSilhouette(editor, pattern);
    await generatePattern(editor, pattern);
    const region = { x: 0, y: 0, w: editor._mW, h: editor._mH };
    const manifest = buildSketchManifest(pattern, region, {});
    checkLatticeParity(editor, manifest, region);
  });

  it('T73: the drawn per-segment contour paths\' own "d" each match primitiveToPathD(primitives[i]) exactly, in segment order (the app draws precisely what generateSilhouette says, byte for byte)', () => {
    const editor = makeMockEditor(7, 9);
    const pattern = shapePattern();
    const region = { x: 0, y: 0, w: editor._mW, h: editor._mH };
    regenerateSilhouette(editor, pattern);
    // T71: the app draws the contour from the board region INSET by the
    // declared contour-size margin (regenerateSilhouette's own
    // `_shapeContourRegion`) -- this oracle must build from the SAME region.
    // T74 AMEND 2: and from the SAME stroke-inset geometry (generateContour
    // Silhouette, not bare generateSilhouette).
    const { primitives } = generateContourSilhouette(insetRegionForContour(region), pattern.shape, pattern.widths.rails);
    const segEls = editor._sketchLayer.children().toArray()
      .filter((e) => e.node.hasAttribute(CONTOUR_SEG_INDEX_ATTR))
      .sort((a, b) => Number(a.attr(CONTOUR_SEG_INDEX_ATTR)) - Number(b.attr(CONTOUR_SEG_INDEX_ATTR)));
    expect(segEls.length).toBe(primitives.length); // non-vacuous: N segments drawn, N primitives declared
    for (let i = 0; i < primitives.length; i++) {
      expect(segEls[i].attr('d')).toBe(primitiveToPathD(primitives[i]));
    }
  });

  it('every contour primitive\'s own defining points (transformed through the SAME carve-space formula) has exactly one matching manifest seg entity, and vice versa — lines by p1/p2, arcs by p1/pMid/p2', () => {
    const editor = makeMockEditor(7, 9);
    const pattern = shapePattern();
    const region = { x: 0, y: 0, w: editor._mW, h: editor._mH };
    // T71: same inset-region oracle as the "d" parity test above --
    // buildSketchManifest's own contour entities build from the inset
    // region too (see editor-sketch-manifest.js's own buildSketchManifest).
    // T74 AMEND 2: and the SAME stroke-inset geometry too.
    const { primitives } = generateContourSilhouette(insetRegionForContour(region), pattern.shape, pattern.widths.rails);
    expect(primitives.length).toBeGreaterThan(0); // non-vacuous
    const manifest = buildSketchManifest(pattern, region, {});
    const contourEntities = manifest.entities.filter((e) => e.id.match(/^seg\d+$/));
    expect(contourEntities.length).toBe(primitives.length);

    const arcPointAt = (prim, theta) => ({ x: prim.cx + prim.rx * Math.cos(theta), y: prim.cy + prim.ry * Math.sin(theta) });
    const usedSegs = new Set();
    for (const prim of primitives) {
      let rawP1, rawPMid, rawP2, isLine;
      if (prim.type === 'L') {
        rawP1 = prim.p0; rawP2 = prim.p1; isLine = true;
      } else {
        rawP1 = arcPointAt(prim, prim.theta1);
        rawPMid = arcPointAt(prim, prim.theta1 + prim.dTheta / 2);
        rawP2 = arcPointAt(prim, prim.theta1 + prim.dTheta);
        isLine = false;
      }
      const p1 = toCarvePoint(rawP1, region), p2 = toCarvePoint(rawP2, region);
      const matches = contourEntities.filter((e) => {
        if (isLine) return (e.type === 'Line' || e.type === 'Slot') && pointsMatch(e.p1, [p1.x, p1.y]) && pointsMatch(e.p2, [p2.x, p2.y]);
        if (e.type !== 'Arc3Point' && e.type !== 'Arc3PointSlot') return false;
        const pMid = toCarvePoint(rawPMid, region);
        return pointsMatch(e.p1, [p1.x, p1.y]) && pointsMatch(e.pMid, [pMid.x, pMid.y]) && pointsMatch(e.p2, [p2.x, p2.y]);
      });
      expect(matches.length).toBe(1);
      usedSegs.add(matches[0].id);
    }
    expect(usedSegs.size).toBe(contourEntities.length); // vice versa: every manifest seg got claimed exactly once
  });
});

describe('parity: shape lattice (bottle) — T72 regression: the default Bottle generated 0 rails/ties after T71\'s contour inset', () => {
  it('the default Bottle preset draws a REAL lattice fill (advisor-measured on 8566623: 0 rails/ties/nodes)', async () => {
    const editor = makeMockEditor(7, 9);
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'bottle', seed: 42, params: {}, segments: null },
    };
    regenerateSilhouette(editor, pattern);
    await generatePattern(editor, pattern);
    const region = { x: 0, y: 0, w: editor._mW, h: editor._mH };
    const drawn = editor._sketchLayer.children().toArray();
    const drawnRails = drawn.filter((e) => e.attr('data-lattice') === 'rail');
    const drawnTies = drawn.filter((e) => e.attr('data-lattice') === 'tie');
    expect(drawnRails.length).toBeGreaterThan(0);
    expect(drawnTies.length).toBeGreaterThan(0);
    const manifest = buildSketchManifest(pattern, region, {});
    checkLatticeParity(editor, manifest, region);
  });
});

describe('parity: SE14c contour.show toggle — ON and OFF both hold lattice parity; OFF hides/omits the contour and (T73 AMEND 3) keeps the narrower contour-inset fill boundary, ON clips to the contour\'s own wider raw centerline', () => {
  function shapePattern(contour) {
    return {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
      ...(contour ? { contour } : {}),
    };
  }

  for (const [label, contour] of [['ON (default)', undefined], ['OFF', { show: false }]]) {
    it(`${label}: lattice fill parity holds exactly as it does for the plain hourglass suite above`, async () => {
      const editor = makeMockEditor(7, 9);
      const pattern = shapePattern(contour);
      regenerateSilhouette(editor, pattern);
      await generatePattern(editor, pattern);
      const region = { x: 0, y: 0, w: editor._mW, h: editor._mH };
      const manifest = buildSketchManifest(pattern, region, {});
      checkLatticeParity(editor, manifest, region);
    });
  }

  it('ON draws a visible contour path (no display:none) with matching manifest seg* entities', async () => {
    const editor = makeMockEditor(7, 9);
    const pattern = shapePattern();
    regenerateSilhouette(editor, pattern);
    await generatePattern(editor, pattern);
    const pathEl = editor._sketchLayer.children().toArray().find((e) => e.attr('d'));
    expect(pathEl).toBeDefined();
    expect(pathEl.attr('display')).not.toBe('none');
    const region = { x: 0, y: 0, w: editor._mW, h: editor._mH };
    const manifest = buildSketchManifest(pattern, region, {});
    expect(manifest.entities.some((e) => e.id.startsWith('seg'))).toBe(true);
  });

  it('OFF hides the drawn contour path (display:none, still a real live element) and the manifest carries no seg* entities', async () => {
    const editor = makeMockEditor(7, 9);
    const pattern = shapePattern({ show: false });
    regenerateSilhouette(editor, pattern);
    await generatePattern(editor, pattern);
    const pathEl = editor._sketchLayer.children().toArray().find((e) => e.attr('d'));
    expect(pathEl).toBeDefined(); // still a real element -- the lattice fill's own boundary lookup needs it
    expect(pathEl.attr('display')).toBe('none');
    const region = { x: 0, y: 0, w: editor._mW, h: editor._mH };
    const manifest = buildSketchManifest(pattern, region, {});
    expect(manifest.entities.some((e) => e.id.startsWith('seg'))).toBe(false);
  });

  it('T73 AMEND 3: ON has AT LEAST as many rail/tie/node pieces as OFF (its own boundary reaches further out, to the contour\'s raw centerline) -- superseding the earlier "toggle changes nothing about the fill" invariant', async () => {
    // T74 AMEND 2 (measured live): the default widths.rails (0.25) exactly
    // equals this suite's own spacing (0.25) -- since the contour's own
    // stroke now insets its DRAWN geometry too (not just the fill-clip's
    // own further pull-back), that exact coincidence lands ON's and OFF's
    // boundaries on opposite sides of a grid-snap for the 'rail' kind
    // specifically (ON 5 vs OFF 7 -- a real, reproducible grid-alignment
    // artifact at that one exact ratio, confirmed by re-running with a
    // narrower stroke and seeing it disappear), not a genuine "OFF fits
    // more" case. A narrower, more realistic stroke width sidesteps the
    // coincidence entirely, matching this test's own actual intent (a
    // wider boundary gives it strictly more room, not exactly-equal room).
    const narrowWidths = { ...PATTERN_DEFAULTS.widths, rails: 0.15, ties: 0.15 };
    const editorOn = makeMockEditor(7, 9);
    const patternOn = { ...shapePattern(), widths: narrowWidths };
    regenerateSilhouette(editorOn, patternOn);
    await generatePattern(editorOn, patternOn);
    const editorOff = makeMockEditor(7, 9);
    const patternOff = { ...shapePattern({ show: false }), widths: narrowWidths };
    regenerateSilhouette(editorOff, patternOff);
    await generatePattern(editorOff, patternOff);
    const countByKind = (editor, kind) => editor._sketchLayer.children().toArray().filter((e) => e.attr('data-lattice') === kind).length;
    let sawStrictlyMore = false;
    for (const kind of ['rail', 'tie', 'node']) {
      expect(countByKind(editorOn, kind)).toBeGreaterThan(0); // non-vacuous
      expect(countByKind(editorOff, kind)).toBeGreaterThan(0);
      expect(countByKind(editorOn, kind)).toBeGreaterThanOrEqual(countByKind(editorOff, kind));
      if (countByKind(editorOn, kind) > countByKind(editorOff, kind)) sawStrictlyMore = true;
    }
    expect(sawStrictlyMore).toBe(true); // non-vacuous: ON's own wider boundary genuinely fits more, somewhere
  });
});

describe('parity: T73 AMEND 2 -- the VISIBLE contour segments draw at the lattice stroke width, auto', () => {
  it('every drawn contour segment\'s own stroke-width equals buildSketchManifest\'s stroke_width parameter, never the old fixed hairline', async () => {
    const editor = makeMockEditor(7, 9);
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
      widths: { ...PATTERN_DEFAULTS.widths, rails: 0.25, ties: 0.25 },
    };
    regenerateSilhouette(editor, pattern);
    await generatePattern(editor, pattern);

    const segEls = editor._sketchLayer.children().toArray().filter((e) => e.node.hasAttribute(CONTOUR_SEG_INDEX_ATTR));
    expect(segEls.length).toBeGreaterThan(0); // non-vacuous
    const region = { x: 0, y: 0, w: editor._mW, h: editor._mH };
    const manifest = buildSketchManifest(pattern, region, {});
    const strokeWidthParam = manifest.parameters.find((p) => p.name === 'stroke_width');
    expect(strokeWidthParam).toBeDefined();
    for (const seg of segEls) {
      expect(seg.attr('stroke-width')).toBe(strokeWidthParam.value);
      expect(seg.attr('stroke-width')).not.toBeCloseTo(0.02, 6); // non-vacuous: not the old fixed hairline
    }
  });
});

describe('parity: T73 AMEND 4 -- every drawn contour segment uses round caps/joins, never a sharp/mitred corner', () => {
  it('every contour segment carries stroke-linecap=round, stroke-linejoin=round', () => {
    const editor = makeMockEditor(7, 9);
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
    };
    regenerateSilhouette(editor, pattern);
    const segEls = editor._sketchLayer.children().toArray().filter((e) => e.node.hasAttribute(CONTOUR_SEG_INDEX_ATTR));
    expect(segEls.length).toBeGreaterThan(0); // non-vacuous
    for (const seg of segEls) {
      expect(seg.attr('stroke-linecap')).toBe('round');
      expect(seg.attr('stroke-linejoin')).toBe('round');
    }
  });
});
