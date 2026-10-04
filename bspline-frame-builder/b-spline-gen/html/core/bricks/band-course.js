/**
 * core/bricks/band-course.js — PORTABLE (see rng.js). F35 item 8: the per-band pattern picker's own
 * brick generator. `bricksContourBands` (f3's file, contour-bands.js, deliberately UNTOUCHED here)
 * only ever lays out a binary soldier/stretcher switch; this is the separate engine that lays out any
 * `BRICK_PATTERNS` entry of kind 'course' or 'course-alternating' (stretcher/stack/soldier/header/
 * flemish) along a REAL curved band, using f3's own exported `bandFrameAt(primitives)` (u,v) hook --
 * the "separate, smaller piece" its own header names as exactly this use case. 'tile2d' patterns
 * (herringbone/basketweave) are NOT handled here (library.js's own BRICK_PATTERNS header: "a tile2d
 * CELL's own shape distorting around curvature is a separate, harder question, still open") -- the
 * UI greys them out for Frame bands rather than silently mishandling them.
 *
 * APPROACH: every unit (brick) is a flat rectangle in (u,v) PATTERN space -- u = along the band
 * (arc length), v = across it (depth from the band's own outer edge) -- placed by the EXACT SAME
 * pitch/cross-axis/stagger math `layouts/bond.js` already uses for a flat Wall course (reusing its
 * own exported `axisLen`, never re-derived), then each unit's own (u,v) rectangle corners are mapped
 * to real (x,y) world points via `bandFrameAt`'s sampler -- this is what makes every brick follow the
 * band's own straights, arcs and mitred corners exactly (bandFrameAt already solves all of that; this
 * file never looks at whether a given (u,v) happens to be over a line or an arc).
 *
 * CLOSED-LOOP WRAP (the one thing flat Wall coursing never has to solve): a Frame band is a closed
 * loop, so a row's own bricks must tile it with NO seam -- `placeUniformRow`/`placeFlemishRow` below
 * snap the brick/period COUNT to the nearest whole number that fits the band's own TRUE perimeter at
 * that row's depth (never stretching a BRICK's own declared length -- only the joint absorbs the
 * lap's small mismatch, same "snap to a whole number, adjust the joint" convention
 * `bricksContourBands`'s own band-widthIn snapping and `resolveZones`'s row-count snapping already
 * use). The true perimeter at a given depth isn't exposed by `bandFrameAt` directly (it only returns
 * point samples, by design -- see its own header: "without needing to know anything about lines-vs-
 * arcs... itself"), so `perimeterAt` below finds it empirically: `bandFrameAt`'s own `u` parameter IS
 * already arc length (verified by contour-bands.js's own bandFrameAt test block), so the wrap point
 * is simply the smallest u>0 where `sample(u,v)` returns to `sample(0,v)` -- found by a coarse scan
 * (using the primitives' own RAW depth-0 perimeter, computed directly and exactly from their declared
 * line lengths / r*angle, as a generous search bound) then a ternary-search refinement. This uses
 * ONLY `bandFrameAt`'s public sampler -- never contour-bands.js's own private `enrichPrimitives`/
 * `boundaryAtDepth`, which is why contour-bands.js itself needs no changes for this file to exist.
 */
import { bandFrameAt } from './contour-bands.js';
import { BRICK_PATTERNS } from './library.js';
import { pickSample } from './piece-plan.js';
import { mulberry32, seedFor } from './rng.js';
import { axisLen } from './layouts/bond.js';

function rawPerimeter(primitives) {
  let total = 0;
  for (const prim of primitives) {
    total += prim.type === 'arc'
      ? prim.r * Math.abs(prim.theta2 - prim.theta1)
      : Math.hypot(prim.p1.x - prim.p0.x, prim.p1.y - prim.p0.y);
  }
  return total;
}

function dist(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }

/** The true closed-loop perimeter at depth `v`, found empirically via `sample`'s own arc-length `u`
 *  parameter (see this file's own header). `guess` (the RAW depth-0 perimeter) sizes the coarse-scan
 *  bound generously (1.6x) -- real frame offsets at brick-scale depths never shrink/grow a contour's
 *  own perimeter anywhere near that much. */
function perimeterAt(sample, v, guess) {
  const p0 = sample(0, v);
  const hi = Math.max(guess * 1.6, 1);
  const steps = 500;
  let bestU = hi, bestD = Infinity;
  for (let i = 1; i <= steps; i++) {
    const u = (hi * i) / steps;
    const d = dist(sample(u, v), p0);
    if (d < bestD) { bestD = d; bestU = u; }
  }
  let lo = Math.max(1e-6, bestU - hi / steps), hiR = bestU + hi / steps;
  for (let iter = 0; iter < 60; iter++) {
    const m1 = lo + (hiR - lo) / 3, m2 = hiR - (hiR - lo) / 3;
    if (dist(sample(m1, v), p0) < dist(sample(m2, v), p0)) hiR = m2; else lo = m1;
  }
  return (lo + hiR) / 2;
}

/** 'course' kind (stretcher/stack/soldier/header): one row of uniformly-pitched bricks around the
 *  closed loop -- the same pitch/stagger math as `bond.js`'s own `uniformRow`, snapped to close the
 *  lap exactly (see this file's own header). */
function placeUniformRow(courseIndex, pattern, perimeter, L, H, J) {
  const cL = axisLen(pattern.pitchAxis, L, H);
  const rawPitch = cL + J;
  const count = Math.max(1, Math.round(perimeter / rawPitch));
  const pitch = perimeter / count;
  const staggerFrac = pattern.staggerFrac || 0;
  const stagger = (staggerFrac > 0 && courseIndex % 2 === 1) ? pitch * staggerFrac : 0;
  const units = [];
  for (let i = 0; i < count; i++) {
    const u0 = i * pitch + stagger;
    units.push({ u0, u1: u0 + cL });
  }
  return units;
}

/** 'course-alternating' (flemish): bond.js's own `flemishRow` textbook unit sequence
 *  ([stretcher(L), header(H)], period L+J+H+J, alternate rows offset by half that period), snapped
 *  to a whole number of PERIODS around the loop -- `k` uniformly rescales each unit's own along-u
 *  extent (never its cross/depth dimension) so the snapped period still tiles exactly; the same
 *  "snap the whole repeat, absorb the lap in there" principle as `placeUniformRow` above, applied to
 *  the repeat unit instead of a single brick. */
function placeFlemishRow(courseIndex, perimeter, L, H, J) {
  const period = L + J + H + J;
  const count = Math.max(1, Math.round(perimeter / period));
  const scaledPeriod = perimeter / count;
  const k = scaledPeriod / period;
  const phase = (courseIndex % 2 === 1) ? scaledPeriod / 2 : 0;
  const units = [];
  for (let i = 0; i < count; i++) {
    const base = i * scaledPeriod + phase;
    units.push({ u0: base, u1: base + L * k });
    units.push({ u0: base + (L + J) * k, u1: base + (L + J) * k + H * k });
  }
  return units;
}

const EDGE_SUBDIV = 4; // uniform u-space subdivision of each unit's own OUTER edge -- exact on a
// straight run (the extra points are colinear, harmless) and closely hugs a true arc on a curved one.

/** MEASURED bug, fixed here: `bandFrameAt`'s own `u=0` is "the first vertex of the boundary AT THAT
 *  DEPTH" -- at a mitred corner, that vertex shifts along the corner's own bisector (confirmed
 *  against the exact case contour-bands.test.js's own bandFrameAt block already proves: v=1 insets a
 *  plain 90-degree corner to exactly (1,1), a shift with a TANGENTIAL component, not a pure
 *  perpendicular one). So `sample(u, v0)` and `sample(u, v1)` do NOT give two points at "the same
 *  lateral position, different depth" for the SAME `u` -- their own `u=0` origins have drifted apart
 *  by a DIFFERENT amount at every corner the boundary has passed through before reaching that `u`.
 *  Reusing one `u` window for both a brick's outer and inner edge (the first version of this
 *  function) therefore put the inner edge on the WRONG PHYSICAL EDGE entirely for any brick whose
 *  `u` window straddles a corner at one depth but not the other (common: the two depths' own corner
 *  thresholds sit at different `u` values) -- MEASURED directly: hundreds of self-intersecting/
 *  overlapping bricks on T1's own curved bands. FIX: only ever sample the OUTER edge (`v0`) through
 *  `bandFrameAt`; the inner edge is built by projecting each outer-edge SAMPLE along its OWN local
 *  normal (`nx,ny`, already exactly correct at every point including mid-corner) by `v1-v0` -- exact
 *  on a straight run, and accurate for an arc whenever the row's own depth is small relative to the
 *  arc's radius (true for every brick-scale band in this app). Two adjacent bricks share their
 *  common boundary POINT (same outer sample, same normal), so this introduces no new seam. */
/** A brick whose `u`-span crosses a real corner (common: bricks are placed by arc length alone, with
 *  no knowledge of where the underlying primitives break) needs an EXTRA vertex AT the true corner,
 *  not a blended/faceted normal at its nearest sample -- MEASURED: two subdivision samples straddling
 *  a corner are each cleanly ON their own edge (never exactly at the vertex), so blending THEIR two
 *  normals and projecting from the sample itself (a first attempt) offset from the WRONG base point,
 *  landing well off the true mitre corner (confirmed: computed (9.8, 0.362) against a true mitre of
 *  (9.8, 0.2) for a plain 90-degree square corner). FIX: recover the exact corner by intersecting the
 *  two samples' own tangent LINES (each sample lies exactly on its own edge, so this is exact for any
 *  line-line corner, and a close local approximation at a line-arc/arc-arc one, the depths here being
 *  small relative to any real template's own radii) -- then insert that corner point into both the
 *  outer and inner edges, offsetting it along the TRUE mitre bisector. */
function lineIntersect(p1, t1, p2, t2) {
  const denom = t1.x * t2.y - t1.y * t2.x;
  if (Math.abs(denom) < 1e-9) return null; // tangent-continuous here -- no real corner to insert
  const s = ((p2.x - p1.x) * t2.y - (p2.y - p1.y) * t2.x) / denom;
  return { x: p1.x + s * t1.x, y: p1.y + s * t1.y };
}

const MITRE_SCALE_CAP = 4; // a near-reversal corner (a sharp hairpin, confirmed to occur on T1's own
// tight waist transitions) sends 1/cos(half-angle) towards infinity -- capping it falls back to a
// plain (un-mitred) normal offset past this point rather than projecting a point wildly far away,
// the same spirit as this codebase's existing "near-180, degenerate, fall back plain" case below.

function mitreOffset(corner, n1, n2, dv) {
  let bx = n1.nx + n2.nx, by = n1.ny + n2.ny;
  const blen = Math.hypot(bx, by) || 1;
  bx /= blen; by /= blen;
  const cosHalf = bx * n1.nx + by * n1.ny;
  if (Math.abs(cosHalf) < 1 / MITRE_SCALE_CAP) return { x: corner.x + n1.nx * dv, y: corner.y + n1.ny * dv };
  return { x: corner.x + (bx / cosHalf) * dv, y: corner.y + (by / cosHalf) * dv };
}

const CORNER_SCAN_MIN_STEPS = 400;
const CORNER_SCAN_STEP_IN = 0.02; // fine enough that a corner's own recovered `u` is accurate to well
// under a grout width, regardless of how many real corners a template has.

/** Row-wide corner detection, done ONCE per row (not once per unit, the first version of this file) --
 *  a single dense scan along this row's own outer boundary (`v0`), finding every tangent
 *  discontinuity, each resolved to its exact (x,y) via `lineIntersect` and its own mitre point/reach
 *  (see `mitreOffset` above). Each corner is listed at three equivalent `u` positions (shifted by
 *  -perimeter/0/+perimeter) so a UNIT's own [u0,u1] span -- which can itself be negative or exceed
 *  `perimeter` (a flemish period's own phase shift, or simply wrapping past the seam) -- is compared
 *  against it with a single, EXACT numeric range check, never a proximity guess.
 *
 *  MEASURED bug this replaces: a per-UNIT "guard" sample a fixed distance before/after its own span
 *  (the first version of this file) has to be wide enough to catch a corner even for a DEEP row
 *  (`dv` up to a full brickLengthIn for 'soldier') -- but that same width can ALSO catch a corner that
 *  genuinely belongs to a different, already-correctly-handled NEIGHBOURING unit, wrongly re-inserting
 *  it here too and inflating this unit's own polygon across unrelated territory (confirmed on a
 *  flemish row: a 0.75in-wide unit's own guard reached clean past its own 0.2in-wide neighbour into a
 *  corner that neighbour had already resolved, nearly doubling this unit's own width). An EXACT
 *  u-range check against a row-wide corner list cannot make that mistake. */
function findRowCorners(sample, v0, dv, perimeter) {
  const steps = Math.max(CORNER_SCAN_MIN_STEPS, Math.ceil(perimeter / CORNER_SCAN_STEP_IN));
  const step = perimeter / steps;
  const raw = [];
  let prev = sample(0, v0);
  for (let i = 1; i <= steps; i++) {
    // MEASURED bug: at i===steps, `i*step` is a FLOATING-POINT RECONSTRUCTION of `perimeter`
    // (step = perimeter/steps) that can land a few ULPs SHORT of the true value -- `sample()` then
    // treats it as still inside the final segment rather than wrapped, so `cur` comes out identical
    // to the previous sample and the row's own closing-seam corner is silently never detected at
    // all. Forcing the very last comparison to close against `sample(0, v0)` exactly sidesteps the
    // reconstruction entirely.
    const cur = i === steps ? sample(0, v0) : sample(i * step, v0);
    if (prev.tx * cur.tx + prev.ty * cur.ty < 0.9999) {
      const corner = lineIntersect(prev, { x: prev.tx, y: prev.ty }, cur, { x: cur.tx, y: cur.ty });
      if (corner) {
        const mitre = mitreOffset(corner, prev, cur, dv);
        raw.push({ u: (i - 0.5) * step, point: corner, mitre, reach: Math.hypot(mitre.x - corner.x, mitre.y - corner.y) });
      }
    }
    prev = cur;
  }
  const corners = [];
  for (const c of raw) for (const shift of [-perimeter, 0, perimeter]) corners.push({ ...c, u: c.u + shift });
  corners.sort((a, b) => a.u - b.u);
  return corners;
}

/** A sample too close to a corner has NO valid simple single-normal offset at all -- MEASURED: a
 *  sample 0.16in past a corner, offsetting a 0.2in-deep row, projected to a point CLOSER to the
 *  corner than the corner's own mitre vertex is, overlapping the next brick's own inner edge. The
 *  true inward-offset boundary near a corner is dominated by the corner's own mitre, not the local
 *  edge's normal, for exactly that reach on either side (the same reason a real mitred offset
 *  polygon has no point "inside" its own corner vertex) -- so a sample whose naive offset would land
 *  CLOSER TO THE CORNER than the corner's own mitre point does snaps to that mitre point instead.
 *  (A flat `dv` reach, tried first, is wrong in general -- MEASURED on T1's own tight waist: a
 *  soldier row's own 0.75in depth vastly exceeds that pattern's own 0.2in brick width, so a flat-`dv`
 *  reach swallowed an entire run of samples into the SAME corner, collapsing the row to one point.
 *  Each corner's own true mitre distance scales correctly with how sharp it actually is instead.) */
function unitPolygon(rowCorners, sample, u0, u1, v0, v1) {
  const dv = v1 - v0;
  const pts = [];
  for (let i = 0; i <= EDGE_SUBDIV; i++) {
    const u = u0 + ((u1 - u0) * i) / EDGE_SUBDIV;
    pts.push(sample(u, v0));
  }
  const innerOf = (p) => {
    let best = { x: p.x + p.nx * dv, y: p.y + p.ny * dv }, bestRatio = 1;
    for (const c of rowCorners) {
      const ratio = Math.hypot(p.x - c.point.x, p.y - c.point.y) / c.reach;
      if (ratio < bestRatio) { bestRatio = ratio; best = c.mitre; } // deepest into any one corner's own territory wins
    }
    return best;
  };
  const outer = pts.map((p) => ({ x: p.x, y: p.y }));
  const inner = pts.map(innerOf);
  // Only a corner whose own `u` genuinely falls strictly inside (u0,u1) is this unit's own outer
  // vertex to add -- an EXACT range check (never a proximity guess, see this function's own header).
  // Processed highest-u-first (and inserted back-to-front) so each `pos`, computed against the
  // ORIGINAL (un-inserted-into) subdivision, stays valid for every insertion still to come.
  const inside = rowCorners.filter((c) => c.u > u0 + 1e-9 && c.u < u1 - 1e-9).sort((a, b) => b.u - a.u);
  for (const c of inside) {
    let pos = 0;
    for (let i = 0; i <= EDGE_SUBDIV; i++) {
      if (u0 + ((u1 - u0) * i) / EDGE_SUBDIV < c.u) pos = i + 1;
    }
    outer.splice(pos, 0, c.point);
    inner.splice(pos, 0, c.mitre);
  }
  inner.reverse();
  return [...outer, ...inner];
}

/** A band's own `{pattern, kind, naturalWidth, rows}`, the SAME resolution `bandCourseBricks`' own
 *  loop needs -- exported so a caller doing its own depth bookkeeping across SEVERAL independent
 *  calls (editor-brick-tool.js's own per-band engine split, F35 item 8) never re-derives this
 *  formula, only ever reads it from here. */
export function resolveBandRows(band, L, H) {
  const patternName = band.pattern || 'stretcher';
  const def = BRICK_PATTERNS[patternName] || BRICK_PATTERNS.stretcher;
  const kind = (def.kind === 'course' || def.kind === 'course-alternating') ? def.kind : 'course';
  const pattern = kind === def.kind ? def : BRICK_PATTERNS.stretcher;
  const naturalWidth = kind === 'course-alternating' ? H : axisLen(pattern.crossAxis, L, H);
  const rows = Math.max(1, Math.round(band.widthIn / naturalWidth));
  return { pattern, kind, naturalWidth, rows };
}

/**
 * @param {Array} primitives — the SAME raw closed-contour primitives `bricksContourBands` takes.
 * @param {{widthIn:number, pattern:string}[]} bands — outer -> inner; `pattern` any BRICK_PATTERNS
 *   key of kind 'course'/'course-alternating' (a 'tile2d' entry falls back to 'stretcher' -- the UI
 *   never offers one here, this is just a defensive default, same fallback style `bond.js`'s own
 *   `patternFor` uses).
 * @param {object} set — a library.BRICK_SETS entry (already scale/grout-resolved by the caller, same
 *   convention `bricksContourBands` itself expects of its own `opts.set`).
 * @param {{seed:number, startDepth?:number}} opts — `startDepth` (default 0) offsets every band's own
 *   depth range, letting a caller place this call's own bands AFTER some OTHER already-accounted-for
 *   depth (editor-brick-tool.js's own per-band engine split calls this with the real cumulative depth
 *   of whatever bricksContourBands already rendered ahead of it) -- unlike `bricksContourBands`
 *   itself, which has no such parameter and always starts its own bands at depth 0.
 * @returns {{bricks: Array}} bricks shaped exactly like `ribbonPieces`' own output
 *   ({id, polygon, pieceId, sampleId, flip, heightOffset}) -- drop-in for `drawBricks`.
 */
export function bandCourseBricks(primitives, bands, set, opts) {
  const sample = bandFrameAt(primitives);
  const guess = rawPerimeter(primitives);
  const seed = opts.seed;
  const L = set.brickLengthIn, H = set.brickHeightIn, J = set.grout.widthIn;

  const bricks = [];
  let depthSoFar = opts.startDepth || 0;
  let nextId = 0;

  bands.forEach((band) => {
    const { pattern, kind, naturalWidth, rows } = resolveBandRows(band, L, H);

    for (let row = 0; row < rows; row++) {
      const v0 = depthSoFar + naturalWidth * row, v1 = v0 + naturalWidth;
      // v0 (the row's OWN outer edge), not the midpoint: every brick corner is sampled through v0
      // only (see unitPolygon's own header) -- pitch must be sized against that SAME boundary.
      const perimeter = perimeterAt(sample, v0, guess);
      const rowCorners = findRowCorners(sample, v0, naturalWidth, perimeter);
      const units = kind === 'course-alternating'
        ? placeFlemishRow(row, perimeter, L, H, J)
        : placeUniformRow(row, pattern, perimeter, L, H, J);
      for (const u of units) {
        const polygon = unitPolygon(rowCorners, sample, u.u0, u.u1, v0, v1);
        const { sampleId, flip } = pickSample(set, seed, 'bricks', nextId);
        const heightOffset = (mulberry32(seedFor(seed, 'bricks-jitter', nextId))() * 2 - 1) * (set.heightJitterIn || 0);
        bricks.push({ id: `frame-${nextId}`, polygon, pieceId: 'frame', sampleId, flip, heightOffset });
        nextId++;
      }
    }
    depthSoFar += naturalWidth * rows;
  });

  return { bricks };
}
