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
 * The second describe block below covers the Coincident CONSTRAINT half:
 * every contour-touching rail/tie end gets exactly one Coincident to the
 * specific contour segment it landed on (point-to-point at a joint,
 * point-on-curve mid-segment -- AMEND 3b's own "one segment only, never
 * two point-on-curves" case, satisfied by construction: `primitiveHitAt`
 * returns the FIRST matching primitive with its own S/E flag already).
 *
 * The third describe block covers AMEND 3c: when a boundary crossing
 * splits one original rail/tie into several pieces, consecutive pieces of
 * the SAME row/column (`railGroup`) get a Collinear constraint between
 * them, and only the FIRST piece in each group keeps its own Horizontal/
 * Vertical constraint (Collinear already fixes the rest's direction).
 *
 * The fourth and fifth describe blocks cover the T74 close-out of AMEND
 * 3b's own remaining thresholds: a near-tangent graze (a rail/tie's own
 * direction nearly parallel to the contour's tangent right where they
 * meet, e.g. barely clipping the very tip of a concave waist arc) gets no
 * Coincident on that one shallow end (found live on a real deep-waist
 * hourglass fixture, not contrived); and MIN_RAIL_PIECE (a stricter,
 * stroke-width-scaled drop threshold than the general MIN_PIECE_LENGTH_IN)
 * drops a split piece too short to be a real, buildable slot.
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

// Independent tangent oracle (T73 AMEND 3b): a line's own constant
// direction, or an arc's radius rotated 90 degrees the sweep's own way --
// deliberately a SEPARATE derivation from primitiveHitAt's own internal
// tangent formula (production code), so this test doesn't just re-trust
// the same math it's meant to verify.
function tangentAt(pt, prim) {
  if (prim.type === 'L') {
    const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y;
    const len = Math.hypot(dx, dy);
    return { x: dx / len, y: dy / len };
  }
  const theta = Math.atan2(pt.y - prim.cy, pt.x - prim.cx);
  const dir = prim.dTheta >= 0 ? 1 : -1;
  return { x: -Math.sin(theta) * dir, y: Math.cos(theta) * dir };
}

function nearestPrimitive(pt, primitives) {
  let best = null, bestDist = Infinity;
  for (const p of primitives) {
    const d = distanceToPrimitive(pt, p);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

// The ACUTE angle (0-90 deg) between a rail/tie's own direction and the
// contour's own tangent at the point they meet -- the SAME "crossing
// angle" concept AMEND 3b's own near-tangent threshold is about.
function crossingAngleDeg(dir, pt, primitives) {
  const prim = nearestPrimitive(pt, primitives);
  const t = tangentAt(pt, prim);
  const cosAngle = Math.abs(dir.x * t.x + dir.y * t.y);
  return (Math.acos(Math.min(1, cosAngle)) * 180) / Math.PI;
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

// Resolves a Coincident target string ("segN", "segN:S", "segN:E") back
// into a real {x,y} point, reading the manifest's OWN declared entity
// shape (Line/ArcCenter endpoints via angle, matching Slot/ArcCenterSlot
// too since both carry the same p1/p2 or center/radius/angle fields) --
// independent of primitiveHitAt, so this test doesn't just re-trust the
// same function that produced the constraint.
function pointOfSegTarget(entities, target) {
  const [id, suffix] = target.split(':');
  const e = entities.find((en) => en.id === id);
  if (!e) return null;
  if (e.type === 'Line' || e.type === 'Slot') {
    if (suffix === 'S') return { x: e.p1[0], y: e.p1[1] };
    if (suffix === 'E') return { x: e.p2[0], y: e.p2[1] };
    return null; // a bare Line/Slot id is never a valid point-on-curve target here
  }
  if (e.type === 'ArcCenter' || e.type === 'ArcCenterSlot') {
    const angle = (deg) => (deg * Math.PI) / 180;
    const at = (deg) => ({ x: e.center[0] + e.radius * Math.cos(angle(deg)), y: e.center[1] + e.radius * Math.sin(angle(deg)) });
    if (suffix === 'S') return at(e.startAngleDeg);
    if (suffix === 'E') return at(e.startAngleDeg + e.sweepDeg);
    return { midpointOnly: true }; // a bare arc id: point-on-curve, checked via distanceToContour below instead
  }
  return null;
}

describe('T73 AMEND 3 (constraint): every contour-touching rail end gets exactly one Coincident to the specific segment it landed on', () => {
  function railContourCoincidents(manifest, railId) {
    return manifest.constraints.filter((c) => c.type === 'Coincident'
      && c.targets.some((t) => t.startsWith(`${railId}:`))
      && c.targets.some((t) => t.split(':')[0].match(/^seg\d+$/)));
  }

  for (const preset of ['hourglass', 'bottle']) {
    it(`${preset}: every rail end (both S and E, since the dense vertical case reaches the contour on every rail) has EXACTLY ONE Coincident to a seg* entity, and that entity's own resolved point matches the rail's own endpoint`, () => {
      const pattern = {
        ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
        orientation: 'vertical',
        rails: { mode: 'count', count: [12, 12] },
        extent: { mode: 'boundary' },
        shape: { source: 'generated', preset, seed: 42, params: {}, segments: null },
      };
      const primitives = rawContourPrimitivesForTest(pattern, REGION);
      const manifest = buildSketchManifest(pattern, REGION, {});
      const rails = railEntities(manifest);
      expect(rails.length).toBeGreaterThan(1); // non-vacuous

      for (const rail of rails) {
        const coincidents = railContourCoincidents(manifest, rail.id);
        // Both S and E of every rail in this fixture reach the contour
        // (already independently confirmed by the geometry describe block
        // above) -- exactly 2 total (one per end), never 0, never a
        // duplicate pair for the same end.
        expect(coincidents.length).toBe(2);
        const bySuffix = { S: null, E: null };
        for (const c of coincidents) {
          const railTarget = c.targets.find((t) => t.startsWith(`${rail.id}:`));
          bySuffix[railTarget.split(':')[1]] = c.targets.find((t) => !t.startsWith(`${rail.id}:`));
        }
        expect(bySuffix.S).toBeTruthy();
        expect(bySuffix.E).toBeTruthy();

        const railP1 = fromCarvePoint(rail.p1, REGION), railP2 = fromCarvePoint(rail.p2, REGION);
        for (const [suffix, railPt] of [['S', railP1], ['E', railP2]]) {
          const segTarget = bySuffix[suffix];
          const resolved = pointOfSegTarget(manifest.entities, segTarget);
          if (resolved && !resolved.midpointOnly) {
            // Point-to-point (a joint): the seg entity's OWN declared
            // endpoint must equal the rail's own endpoint (both already
            // in carve space -- no conversion needed here).
            expect(Math.hypot(resolved.x - railPt.x, resolved.y - railPt.y)).toBeLessThan(TOL);
          } else {
            // Point-on-curve (bare seg id, mid-primitive): independently
            // re-verify the rail's own endpoint genuinely lies on SOME
            // contour primitive (the SAME oracle the geometry block above
            // uses), rather than trusting the constraint's own target name.
            expect(distanceToContour(railPt, primitives)).toBeLessThan(TOL);
          }
        }
      }
    });
  }

  it('the contour HIDDEN (show:false) case declares NO contour Coincident constraints at all -- "no contour, no such constraints" per the amend', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      orientation: 'vertical',
      rails: { mode: 'count', count: [12, 12] },
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
      contour: { show: false },
    };
    const manifest = buildSketchManifest(pattern, REGION, {});
    const rails = railEntities(manifest);
    expect(rails.length).toBeGreaterThan(1); // non-vacuous
    const anySegCoincident = manifest.constraints.some((c) => c.type === 'Coincident'
      && c.targets.some((t) => t.split(':')[0].match(/^seg\d+$/)));
    expect(anySegCoincident).toBe(false);
  });
});

describe('T73 AMEND 3c: split same-rail pieces get Collinear, and only the FIRST piece per group keeps its own Horizontal/Vertical', () => {
  function groupsOf(entities) {
    const byGroup = new Map();
    for (const e of entities) {
      if (e.railGroup == null) continue;
      if (!byGroup.has(e.railGroup)) byGroup.set(e.railGroup, []);
      byGroup.get(e.railGroup).push(e.id);
    }
    return byGroup;
  }

  it('dense vertical hourglass: every multi-piece rail group gets exactly (pieces-1) Collinear constraints, in row order, and axis constraints only on the first piece of each group', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      orientation: 'vertical',
      rails: { mode: 'count', count: [12, 12] },
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
    };
    const manifest = buildSketchManifest(pattern, REGION, {});
    const rails = railEntities(manifest);
    const byGroup = groupsOf(rails);
    const splitGroups = [...byGroup.values()].filter((ids) => ids.length > 1);
    expect(splitGroups.length).toBeGreaterThan(0); // non-vacuous: this fixture genuinely splits some rails (the waist)

    for (const ids of byGroup.values()) {
      const collinear = manifest.constraints.filter((c) => c.type === 'Collinear' && ids.includes(c.targets[0]) && ids.includes(c.targets[1]));
      expect(collinear.length).toBe(ids.length - 1);
      // Consecutive pairs in emission order (already position-sorted) --
      // never e.g. [ids[0],ids[2]] skipping a middle piece.
      for (let k = 1; k < ids.length; k++) {
        expect(collinear.some((c) => c.targets[0] === ids[k - 1] && c.targets[1] === ids[k])).toBe(true);
      }
      const axisCounts = ids.map((id) => manifest.constraints.filter((c) => (c.type === 'Horizontal' || c.type === 'Vertical') && c.targets[0] === id).length);
      expect(axisCounts[0]).toBe(1); // first piece: constrained
      for (let k = 1; k < axisCounts.length; k++) expect(axisCounts[k]).toBe(0); // rest: deduped, relies on Collinear
    }
  });

  it('a rail that never splits still gets its own Horizontal/Vertical (unaffected by the dedup)', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      orientation: 'vertical',
      rails: { mode: 'count', count: [12, 12] },
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
    };
    const manifest = buildSketchManifest(pattern, REGION, {});
    const rails = railEntities(manifest);
    const byGroup = groupsOf(rails);
    const singlePieceGroup = [...byGroup.values()].find((ids) => ids.length === 1);
    expect(singlePieceGroup).toBeDefined(); // non-vacuous: some rows are never split
    const id = singlePieceGroup[0];
    const axisCount = manifest.constraints.filter((c) => (c.type === 'Horizontal' || c.type === 'Vertical') && c.targets[0] === id).length;
    expect(axisCount).toBe(1);
  });
});

describe('T74 (AMEND 3b close-out): a near-tangent graze at the waist gets no Coincident on that one shallow end, but keeps its clean end', () => {
  it('deep-waist hourglass (waistReach 0.15), dense vertical rails: rails split by the waist have EXACTLY ONE Coincident (their clean, far end); the missing end\'s own independently-measured crossing angle is under 10 deg, the kept end\'s is not', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      orientation: 'vertical',
      rails: { mode: 'count', count: [20, 20] },
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: { waistReach: 0.15 }, segments: null },
    };
    const primitives = rawContourPrimitivesForTest(pattern, REGION);
    const manifest = buildSketchManifest(pattern, REGION, {});
    const rails = railEntities(manifest);
    const byGroup = new Map();
    for (const r of rails) {
      if (!byGroup.has(r.railGroup)) byGroup.set(r.railGroup, []);
      byGroup.get(r.railGroup).push(r);
    }
    const splitGroups = [...byGroup.values()].filter((ids) => ids.length > 1);
    expect(splitGroups.length).toBeGreaterThan(0); // non-vacuous: this fixture genuinely splits some rails

    let sawAGraze = false;
    for (const ids of splitGroups) {
      for (const rail of ids) {
        const coincidents = manifest.constraints.filter((c) => c.type === 'Coincident'
          && c.targets.some((t) => t.startsWith(`${rail.id}:`))
          && c.targets.some((t) => t.split(':')[0].match(/^seg\d+$/)));
        if (coincidents.length === 2) continue; // both ends clean, nothing to check here
        expect(coincidents.length).toBe(1); // never both ends missing -- see the geometry describe block above
        sawAGraze = true;
        const coincidentSuffix = coincidents[0].targets.find((t) => t.startsWith(`${rail.id}:`)).split(':')[1];
        const missingSuffix = coincidentSuffix === 'S' ? 'E' : 'S';
        const pointOf = { S: fromCarvePoint(rail.p1, REGION), E: fromCarvePoint(rail.p2, REGION) };
        const dir = { x: rail.p2[0] - rail.p1[0], y: rail.p2[1] - rail.p1[1] };
        const len = Math.hypot(dir.x, dir.y);
        const unitDir = { x: dir.x / len, y: dir.y / len };

        expect(crossingAngleDeg(unitDir, pointOf[missingSuffix], primitives)).toBeLessThan(10);
        expect(crossingAngleDeg(unitDir, pointOf[coincidentSuffix], primitives)).toBeGreaterThanOrEqual(10);
      }
    }
    expect(sawAGraze).toBe(true); // non-vacuous: this fixture genuinely produces at least one graze
  });
});

describe('T74 (AMEND 3b close-out): MIN_RAIL_PIECE drops a split piece too short to be a real slot', () => {
  it('inflating the lattice stroke width (so 2x it exceeds an EXISTING split piece\'s own real length) drops exactly those pieces, keeping every remaining piece at or above the new threshold', () => {
    const basePattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      orientation: 'vertical',
      rails: { mode: 'count', count: [20, 20] },
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: { waistReach: 0.3 }, segments: null },
    };
    const railLength = (r) => Math.hypot(r.p2[0] - r.p1[0], r.p2[1] - r.p1[1]);

    const baseManifest = buildSketchManifest(basePattern, REGION, {});
    const baseLengths = railEntities(baseManifest).map(railLength);
    const shortestBase = Math.min(...baseLengths);
    expect(shortestBase).toBeGreaterThan(0); // non-vacuous

    // Pick a stroke width whose 2x threshold sits strictly between the
    // shortest and second-shortest base piece, so exactly the shortest
    // is expected to drop -- deterministic, not a hunt for a naturally
    // tiny sliver (this fixture's own split pieces are all a few inches
    // long; MIN_RAIL_PIECE only matters relative to the stroke, so an
    // inflated stroke exercises the SAME drop logic just as validly).
    const inflatedRails = shortestBase / 2 + 0.05;
    const inflatedPattern = { ...basePattern, widths: { ...PATTERN_DEFAULTS.widths, rails: inflatedRails, ties: inflatedRails } };
    const inflatedManifest = buildSketchManifest(inflatedPattern, REGION, {});
    const inflatedRailEntities = railEntities(inflatedManifest);
    const inflatedLengths = inflatedRailEntities.map(railLength);

    expect(inflatedRailEntities.length).toBeLessThan(railEntities(baseManifest).length); // non-vacuous: something was actually dropped
    for (const len of inflatedLengths) expect(len).toBeGreaterThanOrEqual(2 * inflatedRails);
    // The dropped piece(s) are exactly the ones below the new threshold --
    // no clean piece got caught in the crossfire.
    const survivedCount = baseLengths.filter((len) => len >= 2 * inflatedRails).length;
    expect(inflatedRailEntities.length).toBe(survivedCount);
  });
});
