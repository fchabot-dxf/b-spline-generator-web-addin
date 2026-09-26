/**
 * T73 AMEND 3 (Fred, from 2 Fusion screenshots of a rail stopping short of
 * the contour, unconnected: "I need rails to coincide to contour") --
 * GEOMETRY half of the fix: with the contour shown, every rail end (and
 * tie end) that reaches the contour must land EXACTLY on the contour's
 * own RAW centerline (not the old half-stroke inset). Verified here with
 * an INDEPENDENT oracle (point-on-line / point-on-arc distance math, not
 * a re-trust of the production code under test), on the two shapes the
 * amend itself names: a dense VERTICAL hourglass (12 rails) and the
 * default bottle.
 *
 * The Coincident CONSTRAINT half of AMEND 3 (declaring the relationship
 * in the manifest) and AMEND 3b/3c's own edge cases (near-tangent grazes,
 * joint-only landings, Collinear between split pieces) are queued as a
 * follow-up commit -- this file covers the geometry the constraint will
 * eventually target.
 */
import { describe, it, expect } from 'vitest';
import { PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { buildSketchManifest } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { generateSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { insetRegionForContour } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js';

const REGION = { x: 0, y: 0, w: 7, h: 9 };
const EPS = 1e-6; // the oracle's own internal geometric tolerance (line/arc math)
// The ASSERTION tolerance is looser than EPS: the contour's own drawn `d`
// round-trips through a string (primitiveToPathD/primitivesToPathD's
// shared `_fmt`, 3-decimal rounding, editor-shape-lattice-generator.js)
// on BOTH the app and manifest side (T73 AMEND 1's own parity fix made
// this deliberate and symmetric) -- so the contour's own real-world
// precision ceiling is ~0.0005in per coordinate, never exact double
// precision. This still easily distinguishes "reaches the contour" from
// the old half-stroke-width gap (>=0.035in for the thinnest lattice
// stroke, order of magnitude larger).
const TOL = 2e-3;

// The raw contour primitives in NATURAL board-inches space (the SAME
// space `fromCarvePoint` below converts a manifest point back into) --
// deliberately NOT lattice-scaled: this oracle compares real-world
// distances directly, it doesn't need lattice-unit primitives at all.
// STILL applies insetRegionForContour (the SEPARATE, unrelated 0.5in
// board margin every generated contour is built from, T71) -- skipping
// that would silhouette a differently-SIZED shape entirely, not just a
// differently-inset one.
function rawContourPrimitivesForTest(pattern, region) {
  return generateSilhouette(insetRegionForContour(region), pattern.shape).primitives;
}

// Independent point-on-primitive oracle (distance-based, no re-use of any
// production insideSpans/crossing code): for a line, perpendicular
// distance to the segment; for an arc (rx===ry always, this module's own
// established invariant), distance from center vs radius AND angle within
// the arc's own sweep.
function distanceToPrimitive(pt, prim) {
  if (prim.type === 'L') {
    const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) return Math.hypot(pt.x - prim.p0.x, pt.y - prim.p0.y);
    let t = ((pt.x - prim.p0.x) * dx + (pt.y - prim.p0.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projX = prim.p0.x + t * dx, projY = prim.p0.y + t * dy;
    return Math.hypot(pt.x - projX, pt.y - projY);
  }
  // 'A': radial distance, then angle-in-sweep (with a small angular slack
  // near the ends so a point exactly at the arc's own S/E still counts).
  const radialDist = Math.abs(Math.hypot(pt.x - prim.cx, pt.y - prim.cy) - prim.rx);
  let theta = Math.atan2(pt.y - prim.cy, pt.x - prim.cx) - prim.theta1;
  const TAU = Math.PI * 2;
  theta = ((theta % TAU) + TAU) % TAU;
  const sweep = prim.dTheta;
  const within = sweep >= 0
    ? (theta <= sweep + 1e-4 || theta >= TAU - 1e-4)
    : (theta >= TAU + sweep - 1e-4 || theta <= 1e-4);
  return within ? radialDist : Infinity;
}

function distanceToContour(pt, primitives) {
  return Math.min(...primitives.map((p) => distanceToPrimitive(pt, p)));
}

function railEntities(manifest) {
  return manifest.entities.filter((e) => e.id.match(/^rail\d+$/));
}

// T64's own carve-space placement (centered + Y-flipped), inverted -- the
// manifest's own rail/tie points are in CARVE space; this oracle's contour
// primitives are in NATURAL board-inches space (straight from
// generateSilhouette), so every manifest point compared against them must
// be converted back first (same formula parity-app-manifest.test.js's own
// toCarvePoint uses, run in reverse).
function fromCarvePoint([x, y], region) {
  return { x: x + region.w / 2, y: region.h / 2 - y };
}

describe('T73 AMEND 3 (geometry): rail ends reach the contour\'s own RAW centerline exactly, with the contour shown', () => {
  it('dense VERTICAL hourglass (12 rails): every rail\'s own two ends land within 1e-6 of the raw contour primitives', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      orientation: 'vertical',
      rails: { mode: 'count', count: [12, 12] },
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
    };
    const primitives = rawContourPrimitivesForTest(pattern, REGION);
    const manifest = buildSketchManifest(pattern, REGION, {});
    const rails = railEntities(manifest);
    expect(rails.length).toBeGreaterThan(1); // non-vacuous: several vertical rails, not just one
    for (const rail of rails) {
      const p1 = fromCarvePoint(rail.p1, REGION);
      const p2 = fromCarvePoint(rail.p2, REGION);
      expect(distanceToContour(p1, primitives)).toBeLessThan(TOL);
      expect(distanceToContour(p2, primitives)).toBeLessThan(TOL);
    }
  });

  it('default bottle: every rail\'s own two ends land within 1e-6 of the raw contour primitives', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      orientation: 'vertical',
      rails: { mode: 'count', count: [12, 12] },
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'bottle', seed: 42, params: {}, segments: null },
    };
    const primitives = rawContourPrimitivesForTest(pattern, REGION);
    const manifest = buildSketchManifest(pattern, REGION, {});
    const rails = railEntities(manifest);
    expect(rails.length).toBeGreaterThan(1); // non-vacuous
    for (const rail of rails) {
      const p1 = fromCarvePoint(rail.p1, REGION);
      const p2 = fromCarvePoint(rail.p2, REGION);
      expect(distanceToContour(p1, primitives)).toBeLessThan(TOL);
      expect(distanceToContour(p2, primitives)).toBeLessThan(TOL);
    }
  });

  it('non-vacuous baseline: with the contour HIDDEN (show:false), rail ends stop short of the raw centerline by roughly half the lattice stroke width -- proving the ON case above is a genuine geometry change, not always-true regardless of the toggle', () => {
    const widths = { ...PATTERN_DEFAULTS.widths, rails: 0.25, ties: 0.25 };
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      orientation: 'vertical',
      rails: { mode: 'count', count: [12, 12] },
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
      widths,
      contour: { show: false },
    };
    const primitives = rawContourPrimitivesForTest(pattern, REGION);
    const manifest = buildSketchManifest(pattern, REGION, {});
    const rails = railEntities(manifest);
    expect(rails.length).toBeGreaterThan(1); // non-vacuous
    const gaps = rails.flatMap((rail) => [
      distanceToContour(fromCarvePoint(rail.p1, REGION), primitives),
      distanceToContour(fromCarvePoint(rail.p2, REGION), primitives),
    ]);
    expect(Math.max(...gaps)).toBeGreaterThan(widths.rails / 2 - 0.01); // a real, non-trivial gap exists
  });
});
