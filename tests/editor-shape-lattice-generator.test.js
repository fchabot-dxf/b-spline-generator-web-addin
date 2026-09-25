/**
 * SE14 Slice 1 (T53) — the pure silhouette generator
 * (editor-shape-lattice-generator.js): seed -> keypoints -> per-segment
 * styles -> exact L/A primitives, per SE14-SHAPE-LATTICE-DESIGN.md §10's
 * own Slice 1 verify list:
 *   (a) a fixed seed produces byte-identical output across two calls;
 *   (b) symmetryRelax:0 produces an EXACT mirror (points AND bulges);
 *   (c) every output primitive is L or A only;
 *   (d) an independent oracle check of the bulge->radius formula against
 *       arcCenterParam's own inverse (both must agree on the SAME arc) —
 *       verified here via a geometrically independent property (the
 *       defining bulge sagitta, plus endpoint round-trip through the
 *       arc's own FORWARD parametrization, `_arcWorldPointTangent`),
 *       never by re-checking the module's own internal R/sweep values.
 */
import { describe, it, expect } from 'vitest';
import {
  generateSilhouette, SHAPE_DEFAULTS, WIDTH_RANGES, ALL_STYLES, WIRED_STYLES,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { _arcWorldPointTangent } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-expand-path.js';

const REGION = { x: 0, y: 0, w: 200, h: 300 };

function baseShape(overrides = {}) {
  return { ...SHAPE_DEFAULTS, seed: 7, ...overrides };
}

describe('generateSilhouette — (a) byte-identical seed reproduction', () => {
  it('two calls with the same region+shape produce deep-equal output', () => {
    const out1 = generateSilhouette(REGION, baseShape());
    const out2 = generateSilhouette(REGION, baseShape());
    expect(out2).toEqual(out1);
  });

  it('a different seed produces different geometry (sanity: not a constant)', () => {
    const out1 = generateSilhouette(REGION, baseShape({ seed: 7 }));
    const out2 = generateSilhouette(REGION, baseShape({ seed: 999 }));
    expect(out2.leftKpts).not.toEqual(out1.leftKpts);
  });

  it('an explicit zone width does not perturb an UNRELATED zone\'s own random draw', () => {
    // Same seed, only `widths.neck` pinned — shoulder/waist/head rows
    // (each an independent per-item sub-seed) must be untouched. This is
    // the reproducibility property the per-item `_subSeed` scheme buys
    // over one shared advancing stream (a shared stream would shift
    // every draw AFTER the pinned one).
    const free = generateSilhouette(REGION, baseShape());
    const pinned = generateSilhouette(REGION, baseShape({ widths: { neck: 50 } }));
    expect(pinned.leftKpts[0]).toEqual(free.leftKpts[0]); // leftBase (shoulder width)
    const waistIdx = 1 + SHAPE_DEFAULTS.keypointCounts.shoulder;
    expect(pinned.leftKpts[waistIdx]).toEqual(free.leftKpts[waistIdx]); // waistLeft
    expect(pinned.leftKpts[pinned.leftKpts.length - 1]).toEqual(
      free.leftKpts[free.leftKpts.length - 1]
    ); // headLeft
    // The neck row itself DOES change (that's the point of pinning it).
    const neckIdx = waistIdx + 1 + SHAPE_DEFAULTS.keypointCounts.waist;
    expect(pinned.leftKpts[neckIdx]).not.toEqual(free.leftKpts[neckIdx]);
  });
});

describe('generateSilhouette — (b) symmetryRelax:0 exact mirror', () => {
  it('named row pairs (base/waist/neck/head) reflect exactly about cx', () => {
    const out = generateSilhouette(REGION, baseShape({ symmetryRelax: 0 }));
    const cx = out.cx;
    const pairs = [
      [out.leftKpts[0], out.rightKpts[out.rightKpts.length - 1]], // base
      [out.leftKpts[out.leftKpts.length - 1], out.rightKpts[0]], // head
    ];
    for (const [l, r] of pairs) {
      expect(l.x + r.x).toBeCloseTo(2 * cx, 9);
      expect(l.y).toBeCloseTo(r.y, 9);
    }
  });

  it('the FULL keypoint chain is a reversed-index mirror (default B=2: equal-length arrays)', () => {
    const out = generateSilhouette(REGION, baseShape({ symmetryRelax: 0 }));
    expect(out.rightKpts.length).toBe(out.leftKpts.length);
    const n = out.leftKpts.length;
    for (let i = 0; i < n; i++) {
      const l = out.leftKpts[i];
      const r = out.rightKpts[n - 1 - i];
      expect(l.x + r.x).toBeCloseTo(2 * out.cx, 9);
      expect(l.y).toBeCloseTo(r.y, 9);
    }
  });

  it('freshly-generated segment styles/bulges mirror left<->right exactly (not just points)', () => {
    const out = generateSilhouette(REGION, baseShape({ symmetryRelax: 0 }));
    const nLeftSeg = out.leftKpts.length - 1;
    // segments layout: [0..nLeftSeg-1]=left, [nLeftSeg]=head, [nLeftSeg+1..nLeftSeg+nLeftSeg]=right profile
    for (let i = 0; i < nLeftSeg; i++) {
      const left = out.segments[i];
      const right = out.segments[nLeftSeg + 1 + i];
      const mirrorOfLeft = out.segments[nLeftSeg + 1 + (nLeftSeg - 1 - i)];
      expect(mirrorOfLeft).toEqual(left);
      void right;
    }
  });

  it('symmetryRelax>0 makes the base row (and only the base row, per the ported formula) independent', () => {
    const relaxed = generateSilhouette(REGION, baseShape({ symmetryRelax: 1 }));
    const mirrored = generateSilhouette(REGION, baseShape({ symmetryRelax: 0 }));
    const nBase = relaxed.rightKpts[relaxed.rightKpts.length - 1];
    const nBaseMirrored = mirrored.rightKpts[mirrored.rightKpts.length - 1];
    expect(nBase.x).not.toBeCloseTo(nBaseMirrored.x, 6);
    // head row: per the disclosed finding, the reference's own blend
    // formula is a no-op there — relax>0 must NOT move it.
    const head = relaxed.rightKpts[0];
    const headMirrored = mirrored.rightKpts[0];
    expect(head.x).toBeCloseTo(headMirrored.x, 9);
  });
});

describe('generateSilhouette — (c) primitives are L or A only', () => {
  it('a fresh-generated shape never emits C or Q', () => {
    const out = generateSilhouette(REGION, baseShape());
    expect(out.primitives.length).toBeGreaterThan(0);
    for (const p of out.primitives) expect(['L', 'A']).toContain(p.type);
  });

  it('an explicit all-kink segment set also stays L-only (2 Ls per kinked segment)', () => {
    const probe = generateSilhouette(REGION, baseShape());
    const n = probe.segments.length;
    const kinkSegments = Array.from({ length: n }, () => ({
      style: 'kink', bulge: 0.3, dir: 'out', cornerRadius: 0,
    }));
    const out = generateSilhouette(REGION, baseShape({ segments: kinkSegments }));
    for (const p of out.primitives) expect(p.type).toBe('L');
    expect(out.primitives.length).toBe(n * 2);
  });
});

describe('generateSilhouette — (d) independent oracle: bulge<->arc agreement', () => {
  it('a curve segment\'s arc endpoints and sagitta match the bulge definition independently', () => {
    const probe = generateSilhouette(REGION, baseShape());
    const n = probe.segments.length;
    const segments = probe.segments.map((seg, i) =>
      i === 0 ? { style: 'curve', bulge: 0.4, dir: 'out', cornerRadius: 0 } : seg
    );
    void n;
    const out = generateSilhouette(REGION, baseShape({ segments }));
    const arc = out.primitives[0];
    expect(arc.type).toBe('A');

    const a = out.leftKpts[0];
    const b = out.leftKpts[1];
    const chord = Math.hypot(b.x - a.x, b.y - a.y);

    // Independent path #1: FORWARD-parametrize the arc (a completely
    // different code path from arcCenterParam's own INVERSE) at its own
    // start/end angles and confirm it reproduces a/b.
    const p0 = _arcWorldPointTangent(arc.cx, arc.cy, arc.rx, arc.ry, arc.phi, arc.theta1).point;
    const p1 = _arcWorldPointTangent(
      arc.cx, arc.cy, arc.rx, arc.ry, arc.phi, arc.theta1 + arc.dTheta
    ).point;
    expect(p0.x).toBeCloseTo(a.x, 6);
    expect(p0.y).toBeCloseTo(a.y, 6);
    expect(p1.x).toBeCloseTo(b.x, 6);
    expect(p1.y).toBeCloseTo(b.y, 6);

    // Independent path #2: the DEFINING geometric property of a CAD
    // "bulge" — sagitta (perpendicular distance from the chord to the
    // arc's own midpoint) equals |bulge| * chord/2 exactly. Computed
    // here from first principles (point-to-line distance), never by
    // re-reading the module's own R/sweep intermediates.
    const mid = _arcWorldPointTangent(
      arc.cx, arc.cy, arc.rx, arc.ry, arc.phi, arc.theta1 + arc.dTheta / 2
    ).point;
    const ux = (b.x - a.x) / chord, uy = (b.y - a.y) / chord;
    const relX = mid.x - a.x, relY = mid.y - a.y;
    const along = relX * ux + relY * uy;
    const perp = relX * -uy + relY * ux; // perpendicular component = sagitta, signed
    expect(Math.abs(along - chord / 2)).toBeLessThan(1e-6); // apex sits over the chord midpoint
    expect(Math.abs(Math.abs(perp) - 0.4 * (chord / 2))).toBeLessThan(1e-6);

    // Independent path #3: SWEEP DIRECTION. Paths #1/#2 above are blind
    // to a sweep-sign bug (both the correct and the mirror-image arc
    // satisfy "endpoints correct, sagitta magnitude correct" equally) —
    // so check the SIGN independently too, via a semantic definition of
    // 'out' that doesn't reuse the module's own od/perpLeftIsOutward
    // formula: 'out' means the arc's own midpoint sits FARTHER from the
    // shape's centerline (cx) than the straight chord's own midpoint.
    const straightMidX = (a.x + b.x) / 2;
    expect(Math.abs(mid.x - out.cx)).toBeGreaterThan(Math.abs(straightMidX - out.cx));
  });

  it('dir:\'in\' bulges the arc TOWARD the centerline (the opposite sign of \'out\')', () => {
    const probe = generateSilhouette(REGION, baseShape());
    const segments = probe.segments.map((seg, i) =>
      i === 0 ? { style: 'curve', bulge: 0.4, dir: 'in', cornerRadius: 0 } : seg
    );
    const out = generateSilhouette(REGION, baseShape({ segments }));
    const arc = out.primitives[0];
    const a = out.leftKpts[0];
    const b = out.leftKpts[1];
    const mid = _arcWorldPointTangent(
      arc.cx, arc.cy, arc.rx, arc.ry, arc.phi, arc.theta1 + arc.dTheta / 2
    ).point;
    const straightMidX = (a.x + b.x) / 2;
    expect(Math.abs(mid.x - out.cx)).toBeLessThan(Math.abs(straightMidX - out.cx));
  });
});

describe('generateSilhouette — segment persistence (§6)', () => {
  it('reuses an explicit segments array verbatim when its length matches, across a seed change', () => {
    const first = generateSilhouette(REGION, baseShape({ seed: 1 }));
    const edited = first.segments.map((s, i) => (i === 2 ? { ...s, style: 'kink', bulge: 0.5, dir: 'in', cornerRadius: 0 } : s));
    const second = generateSilhouette(REGION, baseShape({ seed: 2, segments: edited }));
    expect(second.segments).toEqual(edited);
    // geometry (keypoints) is still freshly derived from the NEW seed
    expect(second.leftKpts).not.toEqual(first.leftKpts);
  });

  it('a keypointCounts change (which changes the expected segment count) forces a fresh draw', () => {
    const first = generateSilhouette(REGION, baseShape({ seed: 3 }));
    const changed = generateSilhouette(
      REGION,
      baseShape({ seed: 3, segments: first.segments, keypointCounts: { ...SHAPE_DEFAULTS.keypointCounts, neck: 2 } })
    );
    expect(changed.segments.length).not.toBe(first.segments.length);
    expect(changed.segments).not.toEqual(first.segments.slice(0, changed.segments.length));
  });
});

describe('generateSilhouette — declared style vocabulary (§4, Q2)', () => {
  it('WIRED_STYLES is exactly straight/curve/kink; ALL_STYLES declares the rest unwired', () => {
    expect(WIRED_STYLES).toEqual(['straight', 'curve', 'kink']);
    expect(ALL_STYLES.slice(0, 3)).toEqual(WIRED_STYLES);
    expect(ALL_STYLES.length).toBeGreaterThan(WIRED_STYLES.length);
  });

  it('WIDTH_RANGES declares all four zones with min<max', () => {
    for (const zone of ['shoulder', 'waist', 'neck', 'head']) {
      const [min, max] = WIDTH_RANGES[zone];
      expect(min).toBeLessThan(max);
    }
  });
});
