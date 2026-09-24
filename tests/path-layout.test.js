/**
 * SE8a / SA-ROUNDTRIP-1 — the declared path-command layout (PATH_LAYOUT),
 * arcToCubics (SVG arc endpoint->center parametrization + cubic
 * approximation), and normalizeForBake (A->cubics, H/V->L before a matrix
 * bake).
 *
 * Before this, _bakeMatrixIntoPath paired up EVERY remaining numeric slot
 * in a segment as an (x,y) point — correct for M/L/C/S/Q/T, wrong for A
 * (7 params: rx ry x-rotation large-arc-flag sweep-flag x y — only the
 * last two are a point, and even those were misaligned by the blind
 * pairing), so every circle/ellipse (baked as two arcs) got corrupted
 * arc params on every carve export.
 */
import { describe, it, expect } from 'vitest';
import {
  PATH_LAYOUT,
  endPoint,
  arcToCubics,
  normalizeForBake,
  isSimilarity,
  bakeArcSimilar,
} from '../bspline-frame-builder/b-spline-gen/html/editor/path-layout.js';
import { transformPoint } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-coords.js';

function sampleCubic(p0, seg, t) {
  const [, c1x, c1y, c2x, c2y, ex, ey] = seg;
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
    y: u * u * u * p0.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
  };
}

/** Sample every cubic in a run at several t values, returning {x,y} points. */
function sampleCubicRun(start, cubics, steps = 8) {
  const pts = [];
  let cur = start;
  for (const c of cubics) {
    for (let i = 0; i <= steps; i++) {
      pts.push(sampleCubic(cur, c, i / steps));
    }
    cur = { x: c[5], y: c[6] };
  }
  return pts;
}

describe('PATH_LAYOUT / endPoint', () => {
  it('reports the real end point for every self-contained command', () => {
    expect(endPoint(['M', 1, 2])).toEqual({ x: 1, y: 2 });
    expect(endPoint(['L', 3, 4])).toEqual({ x: 3, y: 4 });
    expect(endPoint(['C', 1, 1, 2, 2, 5, 6])).toEqual({ x: 5, y: 6 });
    expect(endPoint(['S', 1, 1, 5, 6])).toEqual({ x: 5, y: 6 });
    expect(endPoint(['Q', 1, 1, 5, 6])).toEqual({ x: 5, y: 6 });
    expect(endPoint(['T', 5, 6])).toEqual({ x: 5, y: 6 });
    expect(endPoint(['A', 1, 1, 0, 0, 1, 5, 6])).toEqual({ x: 5, y: 6 });
  });

  it('returns null for H/V/Z, which need external cursor state', () => {
    expect(endPoint(['H', 5])).toBeNull();
    expect(endPoint(['V', 5])).toBeNull();
    expect(endPoint(['Z'])).toBeNull();
  });

  it('H/V/A offsets are declared, not just implied', () => {
    expect(PATH_LAYOUT.H).toEqual({ x: 1 });
    expect(PATH_LAYOUT.V).toEqual({ y: 1 });
    expect(PATH_LAYOUT.A).toEqual({ arc: true, end: [6, 7] });
  });
});

describe('arcToCubics', () => {
  it('a quarter circle (r=1) from (1,0) to (0,1): endpoints exact, midpoint on the unit circle', () => {
    const cubics = arcToCubics({ x: 1, y: 0 }, ['A', 1, 1, 0, 0, 1, 0, 1]);
    expect(cubics).toHaveLength(1);
    const pts = sampleCubicRun({ x: 1, y: 0 }, cubics, 2); // t=0, 0.5, 1
    expect(pts[0]).toEqual({ x: 1, y: 0 });
    expect(pts[2].x).toBe(0);
    expect(pts[2].y).toBeCloseTo(1, 6); // exact end, forced
    // Midpoint of a 90 deg arc sits exactly on the circle for this kappa.
    expect(Math.hypot(pts[1].x, pts[1].y)).toBeCloseTo(1, 6);
  });

  it('a full circle via two 180 deg arcs (sweep=0, matching _primitiveToPathData\'s old pattern): every sampled point stays within 1e-3 of r', () => {
    const r = 1;
    let cur = { x: -r, y: 0 };
    const seg1 = ['A', r, r, 0, 1, 0, r, 0];
    const cubics1 = arcToCubics(cur, seg1);
    const pts1 = sampleCubicRun(cur, cubics1, 8);
    cur = { x: r, y: 0 };
    const seg2 = ['A', r, r, 0, 1, 0, -r, 0];
    const cubics2 = arcToCubics(cur, seg2);
    const pts2 = sampleCubicRun(cur, cubics2, 8);

    for (const p of [...pts1, ...pts2]) {
      expect(Math.abs(Math.hypot(p.x, p.y) - r)).toBeLessThan(1e-3);
    }
  });

  it('scaled circle (r=0.1 at (1,2)) through carveMatrix(7,9,96): stays a circle of the right size at the right place, everywhere within the kappa approximation\'s own known bound', () => {
    // carveMatrix: cad = pt*dpi - {w,h}*dpi/2, no rotation — a pure
    // uniform scale + translate, so the baked result should still be a
    // circle of radius r*dpi centred at the mapped centre.
    //
    // Tolerance note: this drives an A-based circle (2 half-arcs, as
    // ANY generic arc source — a pasted SVG, not this app's own
    // _primitiveToPathData, which now emits 4 cubics directly and never
    // produces an A at all) through arcToCubics + a per-point bake,
    // exactly mirroring what _bakeMatrixIntoPath actually does. The
    // resulting 4-cubic circle has the standard, well-documented kappa-
    // approximation radial error of ~0.027% of the radius (verified by a
    // throwaway scratch check against a unit circle before writing this
    // test: max deviation 1.000259 at r=1) — for worldR=9.6 that's
    // ~0.0025px, not 1e-3px. 1e-3 is achievable only by sampling purely
    // at the 4 exact quadrant points (0/90/180/270°), which isn't a
    // meaningful test of the approximation's accuracy. Asserting against
    // the REAL, well-known bound (with margin) proves the fix is
    // correct without asserting a number no correct kappa-based
    // implementation could actually hit.
    const dpi = 96, w = 7, h = 9;
    const m = { a: dpi, b: 0, c: 0, d: dpi, e: -(w * dpi) / 2, f: -(h * dpi) / 2 };
    const cx = 1, cy = 2, r = 0.1;
    const worldCentre = transformPoint(m, { x: cx, y: cy });
    const worldR = r * dpi;
    const bakeCubic = (c) => {
      const [c1, c2, end] = [[c[1], c[2]], [c[3], c[4]], [c[5], c[6]]].map(
        ([x, y]) => transformPoint(m, { x, y }),
      );
      return ['C', c1.x, c1.y, c2.x, c2.y, end.x, end.y];
    };

    const p0 = { x: cx - r, y: cy };
    const seg1 = ['A', r, r, 0, 1, 0, cx + r, cy];
    const p1 = { x: cx + r, y: cy };
    const seg2 = ['A', r, r, 0, 1, 0, cx - r, cy];

    const pts1 = sampleCubicRun(transformPoint(m, p0), arcToCubics(p0, seg1).map(bakeCubic), 8);
    const pts2 = sampleCubicRun(transformPoint(m, p1), arcToCubics(p1, seg2).map(bakeCubic), 8);

    for (const p of [...pts1, ...pts2]) {
      const dist = Math.hypot(p.x - worldCentre.x, p.y - worldCentre.y);
      expect(Math.abs(dist - worldR)).toBeLessThan(worldR * 0.0004); // ~0.04% margin over the known ~0.027% bound
    }
  });

  it('an A in a user path rotated 30° by the bake matrix: endpoints and midpoint land on the ROTATED ellipse', () => {
    // The arc's own x-axis-rotation param stays 0 — this is about baking
    // an EXTERNAL transform (e.g. the element moved/rotated with Select)
    // on top of an unrotated ellipse arc, which is exactly what
    // _bakeMatrixIntoPath does. rx != ry so a mis-baked radius/rotation
    // would be visible as an off-ellipse point, not just an off-circle
    // one (a circle can't reveal an axis-swap bug the way an ellipse can).
    const rx = 2, ry = 1;
    const deg = 30, rad = (deg * Math.PI) / 180;
    const m = { a: Math.cos(rad), b: Math.sin(rad), c: -Math.sin(rad), d: Math.cos(rad), e: 0, f: 0 };
    const inverseRotate = (p) => ({ // rotate by -30°, i.e. m's transpose (a pure rotation's inverse)
      x: m.a * p.x + m.b * p.y,
      y: m.c * p.x + m.d * p.y,
    });
    const onEllipse = (p) => {
      const local = inverseRotate(p);
      return (local.x / rx) ** 2 + (local.y / ry) ** 2;
    };

    const prev = { x: rx, y: 0 }; // 0°
    const seg = ['A', rx, ry, 0, 0, 1, 0, ry]; // quarter ellipse to 90°
    const cubics = arcToCubics(prev, seg);
    expect(cubics).toHaveLength(1);

    const bakedStart = transformPoint(m, prev);
    const bakedEnd = transformPoint(m, { x: cubics[0][5], y: cubics[0][6] });
    const bakedCubic = ['C',
      ...(() => { const p = transformPoint(m, { x: cubics[0][1], y: cubics[0][2] }); return [p.x, p.y]; })(),
      ...(() => { const p = transformPoint(m, { x: cubics[0][3], y: cubics[0][4] }); return [p.x, p.y]; })(),
      bakedEnd.x, bakedEnd.y,
    ];
    const bakedMid = sampleCubic(bakedStart, bakedCubic, 0.5);

    expect(onEllipse(bakedStart)).toBeCloseTo(1, 6);
    expect(onEllipse(bakedEnd)).toBeCloseTo(1, 6);
    expect(onEllipse(bakedMid)).toBeCloseTo(1, 3); // midpoint: cubic approximation, not exact — still tight
  });

  it('degenerate radius (rx or ry = 0) falls back to a straight line, matching SVG\'s own rule', () => {
    expect(arcToCubics({ x: 0, y: 0 }, ['A', 0, 1, 0, 0, 1, 5, 5])).toEqual([['L', 5, 5]]);
  });

  it('identical start/end (a no-op arc) produces nothing', () => {
    expect(arcToCubics({ x: 3, y: 3 }, ['A', 1, 1, 0, 0, 1, 3, 3])).toEqual([]);
  });
});

describe('normalizeForBake', () => {
  it('converts H/V to a full L using the running cursor for the inherited coordinate', () => {
    const out = normalizeForBake([
      ['M', 0, 0],
      ['H', 5],
      ['V', 3],
    ]);
    expect(out).toEqual([
      ['M', 0, 0],
      ['L', 5, 0], // H: x=5, y inherited (0)
      ['L', 5, 3], // V: y=3, x inherited (5, from the L just emitted)
    ]);
  });

  it('converts an A into one or more C segments ending at the arc\'s declared end point', () => {
    const out = normalizeForBake([
      ['M', 1, 0],
      ['A', 1, 1, 0, 0, 1, 0, 1],
    ]);
    expect(out[0]).toEqual(['M', 1, 0]);
    expect(out).toHaveLength(2); // one 90deg arc -> exactly one cubic
    expect(out[1][0]).toBe('C');
    expect(out[1][5]).toBe(0); // end x
    expect(out[1][6]).toBe(1); // end y
  });

  it('leaves M/L/C/Q/S/T/Z untouched (as independent array entries, not the same references)', () => {
    const input = [['M', 0, 0], ['L', 1, 1], ['Z']];
    const out = normalizeForBake(input);
    expect(out).toEqual(input);
    expect(out[0]).not.toBe(input[0]); // sliced, not aliased
  });

  it('a rotated H would no longer be horizontal — normalizeForBake removes H/V from the array entirely so nothing downstream can re-emit one', () => {
    const out = normalizeForBake([['M', 0, 0], ['H', 5], ['V', 5], ['Z']]);
    expect(out.some((s) => s[0] === 'H' || s[0] === 'V')).toBe(false);
  });
});

describe('isSimilarity (SE12 Slice 0)', () => {
  it('true for identity, carveMatrix\'s own shape (uniform scale + translate), pure rotation, rotation+scale, and a reflection', () => {
    expect(isSimilarity({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBe(true);
    expect(isSimilarity({ a: 96, b: 0, c: 0, d: 96, e: -(7 * 96) / 2, f: -(9 * 96) / 2 })).toBe(true);
    const rad = (30 * Math.PI) / 180;
    expect(isSimilarity({ a: Math.cos(rad), b: Math.sin(rad), c: -Math.sin(rad), d: Math.cos(rad), e: 0, f: 0 })).toBe(true);
    expect(isSimilarity({ a: 2 * Math.cos(rad), b: 2 * Math.sin(rad), c: -2 * Math.sin(rad), d: 2 * Math.cos(rad), e: 5, f: -3 })).toBe(true);
    expect(isSimilarity({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 })).toBe(true); // Y-flip: a reflection, still a similarity
  });

  it('false for the default side-handle drag (non-uniform scale) and for a shear', () => {
    expect(isSimilarity({ a: 2, b: 0, c: 0, d: 5, e: 0, f: 0 })).toBe(false);
    expect(isSimilarity({ a: 1, b: 0, c: 0.5, d: 1, e: 0, f: 0 })).toBe(false);
  });

  it('false (not a throw) for a degenerate/zero-scale matrix', () => {
    expect(isSimilarity({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })).toBe(false);
  });
});

describe('bakeArcSimilar (SE12 Slice 0)', () => {
  // rx != ry on purpose: an axis-swap or a rotation-angle sign bug shows up
  // as an off-ellipse point on a real ellipse, the same reasoning the
  // existing "rotated 30°" arcToCubics test above already uses for the
  // same reason.
  const quarterArc = ['A', 2, 1, 0, 0, 1, 0, 1];
  const prev = { x: 2, y: 0 };

  // Fraction-aligned, NOT sampleCubicRun's per-segment-t concatenation:
  // arcToCubics splits by Math.ceil(|dTheta|/90°), so floating-point noise
  // on ONE side of a cross-check (e.g. a dTheta of 90.0000001° instead of
  // exactly 90°) can push it from 1 segment to 2 while the OTHER side
  // stays at 1 — sampleCubicRun's flat per-segment concatenation would
  // then compare index i on a 9-point run against index i on an 18-point
  // run, silently misaligned (this is exactly what a first draft of these
  // tests did: it reported a 1.44-unit "mismatch" that was pure sampling
  // misalignment, not a bakeArcSimilar bug — confirmed by an independent
  // analytic check before rewriting this helper; see WORK-LOG). Global
  // fraction f in [0,1] maps to the right (segment, local t) regardless
  // of how many segments either side split into, since arcToCubics always
  // divides into EQUAL angular steps.
  function sampleAtFractions(start, cubics, fractions) {
    const n = cubics.length;
    return fractions.map((f) => {
      const scaled = f * n;
      const segIdx = Math.min(n - 1, Math.floor(scaled));
      const localT = scaled - segIdx;
      const segStart = segIdx === 0 ? start : { x: cubics[segIdx - 1][5], y: cubics[segIdx - 1][6] };
      return sampleCubic(segStart, cubics[segIdx], localT);
    });
  }
  const FRACTIONS = Array.from({ length: 9 }, (_, i) => i / 8);

  /** Ground truth: sample the ORIGINAL (pre-bake) arc, then transform
   *  each sampled point directly through m — independent of whatever
   *  bakeArcSimilar itself computes. */
  function sampleArcWorld(p0, seg, m) {
    return sampleAtFractions(p0, arcToCubics(p0, seg), FRACTIONS).map((p) => transformPoint(m, p));
  }
  /** Sample an ALREADY-baked (world-space) arc segment — no further transform. */
  function sampleArcSegWorld(startWorld, seg) {
    return sampleAtFractions(startWorld, arcToCubics(startWorld, seg), FRACTIONS);
  }

  // Tolerance: TWO independently-approximated cubic runs of the SAME
  // analytic curve, compared point-by-point — not one run against an
  // exact value (the existing "scaled circle" test above's ~0.027% kappa
  // bound applies once; here it can apply on both sides, plus a small
  // extra term near a fraction that lands close to a segment boundary on
  // one side but not the other, since the two runs aren't guaranteed to
  // split into the SAME number of segments — confirmed empirically at
  // ~0.7% for a 2-radius arc before writing this bound; 1% leaves margin
  // without hiding a real defect (a wrong sweep/rotation/center produces
  // errors of order the arc's own radius, 50-100%+, not a few percent).
  function expectArcsMatch(groundTruth, candidate, scale) {
    groundTruth.forEach((gt, i) => {
      const dist = Math.hypot(gt.x - candidate[i].x, gt.y - candidate[i].y);
      expect(dist).toBeLessThan(scale * 0.01);
    });
  }

  it('carveMatrix(7,9,96): stays an A, rx/ry scaled by dpi, endpoint matches transformPoint, sweep/largeArc/rotation unchanged (no rotation in this matrix)', () => {
    const m = { a: 96, b: 0, c: 0, d: 96, e: -(7 * 96) / 2, f: -(9 * 96) / 2 };
    const baked = bakeArcSimilar(prev, quarterArc, m);
    expect(baked[0]).toBe('A');
    expect(baked[1]).toBeCloseTo(2 * 96, 6); // rx
    expect(baked[2]).toBeCloseTo(1 * 96, 6); // ry
    expect(baked[3]).toBeCloseTo(0, 6); // x-axis-rotation
    expect(baked[4]).toBe(0); // largeArc
    expect(baked[5]).toBe(1); // sweep
    const end = transformPoint(m, { x: 0, y: 1 });
    expect(baked[6]).toBeCloseTo(end.x, 6);
    expect(baked[7]).toBeCloseTo(end.y, 6);
  });

  it('cross-check against ground truth for a rotated + non-1 scaled + translated similarity', () => {
    const rad = (37 * Math.PI) / 180, s = 2.3;
    const m = { a: s * Math.cos(rad), b: s * Math.sin(rad), c: -s * Math.sin(rad), d: s * Math.cos(rad), e: 12, f: -4 };
    const baked = bakeArcSimilar(prev, quarterArc, m);
    const groundTruth = sampleArcWorld(prev, quarterArc, m);
    const candidate = sampleArcSegWorld(transformPoint(m, prev), baked);
    expectArcsMatch(groundTruth, candidate, 2 * s); // rx=2, scaled by s
  });

  it('a reflection (Y-flip): sweep flips, and the cross-check against ground truth still holds', () => {
    const m = { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 };
    const baked = bakeArcSimilar(prev, quarterArc, m);
    expect(baked[5]).toBe(0); // sweep flipped from 1 -> 0
    const groundTruth = sampleArcWorld(prev, quarterArc, m);
    const candidate = sampleArcSegWorld(transformPoint(m, prev), baked);
    expectArcsMatch(groundTruth, candidate, 2);
  });

  it('a rotation combined with a reflection: cross-check still holds — two earlier hand-derived formulas for this case (a cross-product sweep-sign rule, then a dTheta-magnitude match) both got it wrong, each caught by exactly this test; the final approach matches the transform\'s own expected ellipse center instead of asserting a rule (see path-layout.js)', () => {
    const rad = (50 * Math.PI) / 180;
    const m = { a: Math.cos(rad), b: Math.sin(rad), c: Math.sin(rad), d: -Math.cos(rad), e: 3, f: 7 };
    expect(m.a * m.d - m.b * m.c).toBeLessThan(0); // sanity: this IS a reflection
    const baked = bakeArcSimilar(prev, quarterArc, m);
    const groundTruth = sampleArcWorld(prev, quarterArc, m);
    const candidate = sampleArcSegWorld(transformPoint(m, prev), baked);
    expectArcsMatch(groundTruth, candidate, 2);
  });

  it('a circle (rx===ry) through a rotated similarity: radii unchanged, still traces the same circle', () => {
    const circleArc = ['A', 1, 1, 0, 1, 0, -1, 0]; // half circle
    const p0 = { x: 1, y: 0 };
    const rad = (65 * Math.PI) / 180;
    const m = { a: Math.cos(rad), b: Math.sin(rad), c: -Math.sin(rad), d: Math.cos(rad), e: 0, f: 0 };
    const baked = bakeArcSimilar(p0, circleArc, m);
    expect(baked[1]).toBeCloseTo(1, 9);
    expect(baked[2]).toBeCloseTo(1, 9);
    const groundTruth = sampleArcWorld(p0, circleArc, m);
    const candidate = sampleArcSegWorld(transformPoint(m, p0), baked);
    expectArcsMatch(groundTruth, candidate, 1);
    candidate.forEach((c) => expect(Math.hypot(c.x, c.y)).toBeLessThan(1.01));
  });

  it('degenerate arc (identical start/end) returns null, same as arcToCubics\' own case, not NaN', () => {
    const m = { a: 96, b: 0, c: 0, d: 96, e: 0, f: 0 };
    expect(bakeArcSimilar({ x: 3, y: 3 }, ['A', 1, 1, 0, 0, 1, 3, 3], m)).toBeNull();
  });

  it('degenerate radius (rx or ry = 0) returns null so the caller falls back to arcToCubics\' own line rule', () => {
    const m = { a: 96, b: 0, c: 0, d: 96, e: 0, f: 0 };
    expect(bakeArcSimilar({ x: 0, y: 0 }, ['A', 0, 1, 0, 0, 1, 5, 5], m)).toBeNull();
  });
});
