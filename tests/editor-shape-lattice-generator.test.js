/**
 * SE14 Slice 1, REPLACED for T55 — the pure silhouette generator
 * (editor-shape-lattice-generator.js) now builds a declared PRESET table
 * (hourglass | bottle, ported from the frame-builder's own Template 1/2
 * recipes) instead of T53/54's own bust/keypoint-bulge model.
 *
 * T55's own dispatch verify list: tangency at every real joint (unit-
 * tangent dot >= 1-1e-9); the pinch arc reaches its MINIMUM half-width
 * at its own midpoint (inward, not outward — the exact bug Fred flagged
 * in the un-solved seed render); exact mirror; L/A only; both presets
 * across 3 region aspect ratios.
 *
 * Tangency is checked via `_arcWorldPointTangent` (editor-expand-path.js)
 * — a FORWARD parametrization, a genuinely different code path from this
 * module's own `arcCenterParam`-based arc construction — never by
 * re-reading `_arcPrimitive`'s own internal center/radius.
 */
import { describe, it, expect } from 'vitest';
import {
  generateSilhouette, PRESETS, ALL_STYLES, WIRED_STYLES, primitivesToPathD,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { _arcWorldPointTangent } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-expand-path.js';
import { shapeToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js';

const REGIONS = [
  { x: 0, y: 0, w: 200, h: 300 }, // portrait
  { x: 10, y: 5, w: 320, h: 180 }, // landscape, offset origin
  { x: -50, y: -50, w: 240, h: 240 }, // square, negative origin
];
const PRESET_NAMES = ['hourglass', 'bottle'];

function tangentAtEnd(p) {
  if (p.type === 'L') {
    const dx = p.p1.x - p.p0.x, dy = p.p1.y - p.p0.y, len = Math.hypot(dx, dy);
    return { x: dx / len, y: dy / len };
  }
  const sign = p.dTheta > 0 ? 1 : -1;
  const t = _arcWorldPointTangent(p.cx, p.cy, p.rx, p.ry, p.phi, p.theta1 + p.dTheta).tangentCCW;
  return { x: t.x * sign, y: t.y * sign };
}
function tangentAtStart(p) {
  if (p.type === 'L') {
    const dx = p.p1.x - p.p0.x, dy = p.p1.y - p.p0.y, len = Math.hypot(dx, dy);
    return { x: dx / len, y: dy / len };
  }
  const sign = p.dTheta > 0 ? 1 : -1;
  const t = _arcWorldPointTangent(p.cx, p.cy, p.rx, p.ry, p.phi, p.theta1).tangentCCW;
  return { x: t.x * sign, y: t.y * sign };
}

// Per-preset: which joint indices (i -> (i+1)%n) are the 4 sharp BB
// corners (top-right, bottom-right, bottom-left, top-left), given the
// documented segment order (right side top->bottom, bottom edge, left
// side bottom->top, top edge LAST). Hourglass: 5 segments/side (horn,
// arc,arc,arc,horn) + 2 edges = 12. Bottle: 4 segments/side (horn,
// arc,arc,horn) + 2 edges = 10.
const SHARP_JOINTS = {
  hourglass: [4, 5, 10, 11], // [right-horn->bottom edge], [bottom edge->left-horn], [left-horn->top edge], [top edge->right-horn]
  bottle: [3, 4, 8, 9],
};

describe.each(PRESET_NAMES)('generateSilhouette(%s) — tangency at every real joint', (preset) => {
  it.each(REGIONS.map((r, i) => [i, r]))('region %i: dot ~ 1 everywhere except the 4 sharp BB corners', (_i, region) => {
    const out = generateSilhouette(region, { preset, seed: 7 });
    const n = out.primitives.length;
    const sharp = new Set(SHARP_JOINTS[preset]);
    for (let k = 0; k < n; k++) {
      const a = out.primitives[k], b = out.primitives[(k + 1) % n];
      const ta = tangentAtEnd(a), tb = tangentAtStart(b);
      const dot = ta.x * tb.x + ta.y * tb.y;
      if (sharp.has(k)) {
        expect(Math.abs(dot)).toBeLessThan(0.05); // a true right-angle corner, not tangent
      } else {
        expect(dot).toBeGreaterThanOrEqual(1 - 1e-6);
      }
    }
  });
});

describe.each(PRESET_NAMES)('generateSilhouette(%s) — the pinch reaches its MINIMUM half-width inward', (preset) => {
  it('the concave arc\'s own midpoint sits CLOSER to centerline than its STRAIGHT CHORD\'S midpoint (not outward)', () => {
    // Bottle's own neck/waist arc has ASYMMETRIC endpoints (one at the
    // narrow neck's own half-width, one at the shared skeleton column) —
    // comparing the arc's own midpoint against each raw endpoint
    // individually isn't a valid test there (one endpoint can already
    // be closer to centerline than the pinch). The general, correct
    // check (same one T53/54's own 'in'/'out' oracle test used): does
    // the arc's OWN curve reach closer to centerline than a STRAIGHT
    // line between its two endpoints would — the actual definition of
    // "pinches inward, not outward".
    const region = REGIONS[0];
    const out = generateSilhouette(region, { preset, seed: 7 });
    const concaveIdx = out.segments.findIndex((s) => s.style === 'curve' && s.dir === 'in');
    expect(concaveIdx).toBeGreaterThanOrEqual(0);
    const arc = out.primitives[concaveIdx];
    expect(arc.type).toBe('A');
    const a = out.keypoints[concaveIdx];
    const b = out.keypoints[(concaveIdx + 1) % out.keypoints.length];
    const mid = _arcWorldPointTangent(arc.cx, arc.cy, arc.rx, arc.ry, arc.phi, arc.theta1 + arc.dTheta / 2).point;
    const straightMidX = (a.x + b.x) / 2;
    expect(Math.abs(mid.x - out.cx)).toBeLessThan(Math.abs(straightMidX - out.cx) - 1e-6);
  });
});

describe.each(PRESET_NAMES)('generateSilhouette(%s) — exact mirror', () => {
  it.each(REGIONS.map((r, i) => [i, r]))('region %i: left-side keypoints are the exact mirror of the right side', (_i, region) => {
    for (const preset of PRESET_NAMES) {
      const out = generateSilhouette(region, { preset, seed: 11 });
      const n = out.keypoints.length;
      const half = n / 2;
      for (let k = 0; k < half; k++) {
        const r = out.keypoints[k];
        // Right side is keypoints[0..half-1]; left side is the reverse
        // mirror at keypoints[half..n-1] — index (n-1-k) mirrors index k,
        // by construction (both solvers build the left side via M(x,y)
        // = {cx0-x, cy0+y} directly from the SAME local x/y as the right
        // side, in reverse array order).
        const l = out.keypoints[n - 1 - k];
        expect(r.x + l.x).toBeCloseTo(2 * out.cx, 9);
        expect(r.y).toBeCloseTo(l.y, 9);
      }
    }
  });
});

describe.each(PRESET_NAMES)('generateSilhouette(%s) — primitives are L or A only', (preset) => {
  it.each(REGIONS.map((r, i) => [i, r]))('region %i: never C or Q', (_i, region) => {
    const out = generateSilhouette(region, { preset, seed: 99 });
    expect(out.primitives.length).toBeGreaterThan(0);
    for (const p of out.primitives) expect(['L', 'A']).toContain(p.type);
  });
});

describe('generateSilhouette(hourglass) — geometric invariants (T55\'s own closed-form derivation)', () => {
  it('shoulder/hip arcs are ALWAYS exactly quarter circles (90deg), regardless of params', () => {
    for (const region of REGIONS) {
      for (const seed of [1, 2, 3]) {
        const out = generateSilhouette(region, { preset: 'hourglass', seed });
        const shoulder = out.primitives[1], hip = out.primitives[3];
        expect(Math.abs(Math.abs(shoulder.dTheta) - Math.PI / 2)).toBeLessThan(1e-6);
        expect(Math.abs(Math.abs(hip.dTheta) - Math.PI / 2)).toBeLessThan(1e-6);
      }
    }
  });

  it('the waist arc is ALWAYS exactly a semicircle (180deg)', () => {
    for (const region of REGIONS) {
      for (const seed of [1, 2, 3]) {
        const out = generateSilhouette(region, { preset: 'hourglass', seed });
        const waist = out.primitives[2];
        expect(Math.abs(Math.abs(waist.dTheta) - Math.PI)).toBeLessThan(1e-6);
      }
    }
  });
});

describe('generateSilhouette — explicit params override the gentle seed jitter', () => {
  it('hourglass: an explicit waistReach pins the pinch\'s own DEPTH exactly, across seeds', () => {
    // waistReach alone determines `waistX` (the pinch's own boundary
    // reach) — but `waistX` is the ARC's own midpoint, not a keypoint
    // (the keypoints sit at x=skelX, which also depends on the SEPARATE,
    // still-jittered `cornerRadius`). So the quantity waistReach alone
    // pins is the waist arc's own midpoint x, not any keypoint's x.
    const region = REGIONS[0];
    const a = generateSilhouette(region, { preset: 'hourglass', seed: 1, params: { waistReach: 0.4 } });
    const b = generateSilhouette(region, { preset: 'hourglass', seed: 2, params: { waistReach: 0.4 } });
    const midX = (out) => {
      const arc = out.primitives[2];
      return Math.abs(
        _arcWorldPointTangent(arc.cx, arc.cy, arc.rx, arc.ry, arc.phi, arc.theta1 + arc.dTheta / 2).point.x - out.cx
      );
    };
    expect(midX(a)).toBeCloseTo(midX(b), 6);
    // Sanity: the SAME keypoint (skelX-driven) is NOT pinned, since
    // cornerRadius is still jittered independently — proves the test
    // above is checking the right, genuinely-independent quantity.
    expect(Math.abs(a.keypoints[2].x - a.cx)).not.toBeCloseTo(Math.abs(b.keypoints[2].x - b.cx), 6);
  });

  it('bottle: an explicit neckWidth pins the top edge width exactly, across seeds', () => {
    const region = REGIONS[0];
    const a = generateSilhouette(region, { preset: 'bottle', seed: 1, params: { neckWidth: 0.4 } });
    const b = generateSilhouette(region, { preset: 'bottle', seed: 2, params: { neckWidth: 0.4 } });
    expect(Math.abs(a.keypoints[0].x - a.cx)).toBeCloseTo(Math.abs(b.keypoints[0].x - b.cx), 6);
  });

  it('the same seed + same params is byte-identical across two calls', () => {
    const region = REGIONS[1];
    const shape = { preset: 'bottle', seed: 123, params: { neckWidth: 0.45, bodyWidth: 0.9 } };
    expect(generateSilhouette(region, shape)).toEqual(generateSilhouette(region, shape));
  });
});

describe('generateSilhouette — segment persistence (per-segment style override survives a param change)', () => {
  it('reuses an explicit segments array verbatim when its length matches, across a seed change', () => {
    const region = REGIONS[0];
    const first = generateSilhouette(region, { preset: 'hourglass', seed: 1 });
    const edited = first.segments.map((s, i) =>
      i === 1 ? { style: 'kink', bulge: 0.4, dir: 'out', cornerRadius: 0 } : s
    );
    const second = generateSilhouette(region, { preset: 'hourglass', seed: 2, segments: edited });
    expect(second.segments).toEqual(edited);
    expect(second.primitives[1].type).toBe('L'); // kink -> 2 Ls, so index 1 is now an L, not the default A
  });

  it('a mismatched-length segments array is ignored (falls back to the fresh default)', () => {
    const region = REGIONS[0];
    const out = generateSilhouette(region, {
      preset: 'hourglass', seed: 5, segments: [{ style: 'kink', bulge: 0.5, dir: 'out', cornerRadius: 0 }],
    });
    expect(out.segments.length).toBe(12);
    expect(out.segments[0].style).toBe('straight'); // the default horn, not a kink
  });
});

describe('generateSilhouette — declared style vocabulary (§4, Q2, unchanged by T55)', () => {
  it('WIRED_STYLES is exactly straight/curve/kink; ALL_STYLES declares the rest unwired', () => {
    expect(WIRED_STYLES).toEqual(['straight', 'curve', 'kink']);
    expect(ALL_STYLES.slice(0, 3)).toEqual(WIRED_STYLES);
    expect(ALL_STYLES.length).toBeGreaterThan(WIRED_STYLES.length);
  });
});

describe('generateSilhouette — declared preset table (T55)', () => {
  it('PRESETS declares hourglass and bottle, each with params + a gentle jitter range', () => {
    for (const name of PRESET_NAMES) {
      expect(PRESETS[name].params).toBeTruthy();
      expect(PRESETS[name].jitter).toBeTruthy();
      for (const key of Object.keys(PRESETS[name].params)) {
        expect(typeof PRESETS[name].jitter[key]).toBe('number');
      }
    }
  });

  it('defaults to hourglass when shape.preset is omitted', () => {
    const out = generateSilhouette(REGIONS[0], {});
    expect(out.preset).toBe('hourglass');
  });
});

// T58 (SE14 Slice 3): primitivesToPathD — the ONE new piece of geometry
// this turn adds to this module (everything else already existed as of
// T55). Round-tripped through `shapeToPrimitives` (editor-lattice-
// boundary.js), the SAME already-trusted parser the fill engine itself
// uses to consume a boundary `<path>`'s own `d` — a genuine independent
// oracle, not a re-check of this function's own internal math.
function samplePoint(prim, t) {
  if (prim.type === 'L') {
    return { x: prim.p0.x + (prim.p1.x - prim.p0.x) * t, y: prim.p0.y + (prim.p1.y - prim.p0.y) * t };
  }
  return _arcWorldPointTangent(prim.cx, prim.cy, prim.rx, prim.ry, prim.phi, prim.theta1 + prim.dTheta * t).point;
}
function sampleAll(primitives, samplesPerPrim = 5) {
  const pts = [];
  for (const prim of primitives) {
    for (let i = 0; i <= samplesPerPrim; i++) pts.push(samplePoint(prim, i / samplesPerPrim));
  }
  return pts;
}
async function roundTripPrimitives(d) {
  return shapeToPrimitives({ type: 'path', attr: (k) => (k === 'd' ? d : undefined) });
}

// A real board-scale region (inches, matching properties-shape-lattice.
// js's own _boardRegion) rather than REGIONS[0]'s own 200x300 arbitrary
// scale used elsewhere in this file — primitivesToPathD's own `_fmt`
// rounds to 3 DECIMALS (an ABSOLUTE amount), not 3 SIGNIFICANT FIGURES,
// so the round-trip's own achievable precision scales with the shape's
// size: at real usage scale the rounding is negligible (<0.001"), but at
// REGIONS[0]'s 200-300 scale the SAME absolute rounding, compounded
// through the arc endpoint<->center reconstruction (measurably more
// sensitive near hourglass's own EXACT semicircle/quarter-circle
// invariants, T55's own proven property), produced up to ~0.09 of
// drift — a real, measured artifact of testing serialization precision
// at the wrong scale, not a defect in the serializer itself.
const D_ROUNDTRIP_REGION = { x: 0, y: 0, w: 6, h: 9 };

describe.each(PRESET_NAMES)('primitivesToPathD(%s) — round-trips through shapeToPrimitives (T58)', (preset) => {
  it('the SAME geometry comes back: sampled points along every original primitive match the reparsed ones', async () => {
    const { primitives } = generateSilhouette(D_ROUNDTRIP_REGION, { preset });
    const d = primitivesToPathD(primitives);
    const reparsed = await roundTripPrimitives(d);
    expect(reparsed.length).toBe(primitives.length);

    const before = sampleAll(primitives);
    const after = sampleAll(reparsed);
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      // Precision 2 (tolerance 0.005): _fmt's own declared 3-decimal
      // rounding gives up to ~5e-4 error per COORDINATE, and the arc
      // endpoint<->center reconstruction combines error from BOTH
      // endpoints (measured up to ~6e-4 at this scale) — precision 3
      // (5e-4) cut it too close; precision 2 leaves real margin while
      // still being tight relative to this realistic board-inches scale.
      expect(after[i].x).toBeCloseTo(before[i].x, 2);
      expect(after[i].y).toBeCloseTo(before[i].y, 2);
    }
  });

  it('non-vacuous: a corrupted sweep flag (mutating the OWN serializer, not the test) is actually caught by this check', async () => {
    // Reproduces the exact bug this test would catch: flip the emitted
    // sweep flag for arcs, exactly the kind of one-bit transcription
    // error `dTheta > 0 ? 1 : 0` could silently invert. A flipped sweep
    // draws the OTHER arc through the same two endpoints — same start/end
    // points, different midpoint — so the round-trip byte-count check
    // above would NOT catch it, but the point-sampling check must.
    const { primitives } = generateSilhouette(D_ROUNDTRIP_REGION, { preset });
    const hasArc = primitives.some((p) => p.type === 'A');
    expect(hasArc).toBe(true); // sanity: this preset actually exercises the arc path
    const d = primitivesToPathD(primitives);
    const corruptedD = d.replace(/A ([\d.-]+) ([\d.-]+) ([\d.-]+) (\d) (\d) /g, (m, rx, ry, phi, largeArc, sweep) =>
      `A ${rx} ${ry} ${phi} ${largeArc} ${1 - Number(sweep)} `
    );
    expect(corruptedD).not.toBe(d); // sanity: the corruption actually changed something
    const reparsed = await roundTripPrimitives(corruptedD);
    const before = sampleAll(primitives);
    const after = sampleAll(reparsed);
    const anyMidpointMoved = before.some((pt, i) => Math.abs(pt.x - after[i].x) > 1e-4 || Math.abs(pt.y - after[i].y) > 1e-4);
    expect(anyMidpointMoved).toBe(true);
  });
});

describe('primitivesToPathD — degenerate input', () => {
  it('an empty primitive list serializes to an empty string', () => {
    expect(primitivesToPathD([])).toBe('');
    expect(primitivesToPathD(null)).toBe('');
  });
});

// T59 (SE14 axis-locked handles) — generateSilhouette's own new `params`
// return field: the FULLY RESOLVED param set (explicit or default+
// jitter), which an on-canvas handle needs to seed its own drag-start
// value and anchor position.
describe.each(PRESET_NAMES)('generateSilhouette(%s) — the new `params` return field (T59)', (preset) => {
  it('an explicit param passes through UNCHANGED in the resolved set', () => {
    const key = Object.keys(PRESETS[preset].params)[0];
    const explicitValue = PRESETS[preset].params[key] * 0.5; // deliberately off-default
    const out = generateSilhouette(REGIONS[0], { preset, params: { [key]: explicitValue } });
    expect(out.params[key]).toBeCloseTo(explicitValue, 9);
  });

  it('an UNPINNED param resolves to a real number (default + seeded jitter), not undefined', () => {
    const out = generateSilhouette(REGIONS[0], { preset });
    for (const key of Object.keys(PRESETS[preset].params)) {
      expect(typeof out.params[key]).toBe('number');
      expect(Number.isFinite(out.params[key])).toBe(true);
    }
  });

  it('non-vacuous: the resolved param ACTUALLY matches the geometry it produced, not a stale/default echo', () => {
    // Cross-check against an INDEPENDENT read of the same quantity off the
    // keypoints themselves (not the solver's own internal variable) — the
    // same "never trust the primitive's own internals, use a different
    // code path" discipline this file's own tangency checks already use.
    const out = generateSilhouette(REGIONS[0], { preset, seed: 777 });
    const hw = REGIONS[0].w / 2, cx = out.cx;
    if (preset === 'hourglass') {
      // keypoints[1] = rShoulderHorn = (cx+hw, cy+shoulderY); its own X is
      // ALWAYS cx+hw regardless of params, so cross-check cornerRadius via
      // keypoints[2].x (rShoulderWaistJct, at world x = cx+skelX):
      // skelX = hw - cornerRadius*hw -> cornerRadius = 1 - (kp2.x-cx)/hw.
      const skelXWorld = out.keypoints[2].x;
      const crFromGeometry = 1 - (skelXWorld - cx) / hw;
      expect(out.params.cornerRadius).toBeCloseTo(crFromGeometry, 6);
    } else {
      // rNeckHorn = keypoints[1] = (cx+neckHalfW, ...) -> neckWidth = (kp1.x-cx)/hw.
      const nwFromGeometry = (out.keypoints[1].x - cx) / hw;
      expect(out.params.neckWidth).toBeCloseTo(nwFromGeometry, 6);
    }
  });
});
