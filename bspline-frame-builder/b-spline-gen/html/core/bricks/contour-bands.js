/**
 * core/bricks/contour-bands.js — PORTABLE (see rng.js). Core primitive #3 (the advisor, after
 * Fred's own UI lock -- "the Brick tab has three tools: Brush, Wall, Frame" -- contour bands get
 * their OWN entry point rather than being folded only into an option of bricksFillShape):
 *
 *   bricksContourBands(primitives, bands, opts) -> { bricks, innerPath }
 *
 * H23 item 76 (advisor, 4th architecture attempt, after three reverted attempts at patching the
 * OLD bricksAlongPath/offsetPathInward-based row machinery -- see WORK-LOG's own "primitive-
 * ribbon.js" entry for the full account): EACH ROW is built as an independent ribbon directly from
 * the ORIGINAL frame `primitives` (lines + true circular arcs) plus that row's own depth range,
 * never by compounding an offset through a PREVIOUSLY-offset polyline. "No band depends on the
 * previous band's own polyline, only on the original primitives + d." This is what finally
 * sidesteps the compounding-error-through-a-degenerate-region class of bug the three reverted
 * attempts kept hitting.
 *
 * `primitives`: the CLOSED contour's own ordered list, each either `{type:'line', p0, p1}` or
 * `{type:'arc', cx, cy, r, theta1, theta2}` -- RAW geometry only (no inward-normal/radialSign
 * convention baked in yet; this function derives the path's own GLOBAL inward sign ONCE, same as
 * `radialSignAt` needs, and enriches each primitive with it before handing rows to
 * primitive-ribbon.js's own `ribbonPieces`). No declared corner list: `ribbonPieces` derives every
 * joint directly from where consecutive primitives actually meet, degenerating to "no clip" on its
 * own for a tangent-continuous (non-corner) transition.
 *
 * A band's own BRICKS ARE NEVER STRETCHED to fit `widthIn` exactly -- a brick's cross-dimension is
 * always its natural size (brickLengthIn for 'soldier', brickHeightIn for 'stretcher'; MEASURED,
 * not assumed: a first pass here offset each band's centreline by widthIn/2 directly, which is
 * only correct when widthIn happens to equal that natural size -- confirmed wrong by a rendered
 * preview showing visible gaps/overlaps at every band seam once a preset's own declared widthIn
 * diverged from the pattern's real brick size). Instead `widthIn` is SNAPPED to the nearest whole
 * number of that pattern's own brick-width rows (at least 1), each row its own independent ribbon,
 * stacked outer -> inner within the band -- so a wider band is genuinely MULTIPLE COURSES of
 * full-size bricks, never one row of stretched ones, and the next band always starts exactly where
 * the actual (snapped) rows end, with no seam gap.
 */
import { inwardSignFor, pointInPolygon, cumulativeLengths, pointAtArcLength, polygonIntersection, signedArea, clipToField, polygonDifference, offsetPathInward } from './geometry.js';
import { radialSignAt } from './arc-voussoir.js';
import { ribbonPieces, boundaryAtDepth, lineBetweenLinesDropsAt } from './primitive-ribbon.js';
import { openRibbonOutline } from './ribbon-outline.js'; // F35 item 55 (seat E): a Brush stroke's grout region
import { scaledSet, BRICK_PATTERNS, MIN_PIECE_FRACTION } from './library.js';
import { bricksFillShape } from './fill-shape.js';
import { axisLen, courseHeightFor } from './layouts/bond.js';

const ARC_TESS_STEPS = 16; // only for inwardSignFor's own tessellation -- a smoothness floor for
// deciding which way is "inward", never a correctness requirement (ribbonPieces itself never
// tessellates an arc's own interior; its only geometry is the exact analytic circle).

function tessellate(primitives, steps = ARC_TESS_STEPS) {
  const points = [];
  for (const prim of primitives) {
    if (prim.type === 'arc') {
      for (let k = 0; k < steps; k++) {
        const t = prim.theta1 + ((prim.theta2 - prim.theta1) * k) / steps;
        points.push({ x: prim.cx + prim.r * Math.cos(t), y: prim.cy + prim.r * Math.sin(t) });
      }
    } else {
      points.push(prim.p0);
    }
  }
  return points;
}

/** Enrich each RAW primitive with the one orientation fact it needs for `ribbonPieces`' own
 *  offsetting (a line's constant inward normal; an arc's own radialSign) -- derived from the WHOLE
 *  path's own global inward sign, computed ONCE, never re-derived per primitive (the exact bug
 *  class `radialSignAt`'s own fix, item 76 above, closed). */
function enrichPrimitives(primitives, inwardSign) {
  return primitives.map((prim) => {
    if (prim.type === 'line') {
      const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y, len = Math.hypot(dx, dy) || 1;
      return { ...prim, nx: (-dy / len) * inwardSign, ny: (dx / len) * inwardSign };
    }
    const midT = (prim.theta1 + prim.theta2) / 2;
    const mid = { x: prim.cx + prim.r * Math.cos(midT), y: prim.cy + prim.r * Math.sin(midT) };
    const direction = Math.sign(prim.theta2 - prim.theta1) || 1;
    const tangent = { tx: -Math.sin(midT) * direction, ty: Math.cos(midT) * direction };
    const radialSign = radialSignAt(tangent, mid.x, mid.y, prim.cx, prim.cy, inwardSign);
    return { ...prim, radialSign };
  });
}

/** Fred (live, 2026-10-04): "White rock frame bands are ugly ... it just uses the same logic as red brick, but
 *  it's wrong for it" -- a White Rocks band was laid as a brick COURSE, soldier/stretcher pieces cut from rock
 *  textures. Declared rule: a set whose OWN layout is a band-capable area pattern (library.js BRICK_SETS
 *  `layout`, e.g. White Rocks' 'fieldstone'; BRICK_PATTERNS `bandCapable`) lays EVERY band with that pattern,
 *  whatever pattern or preset the band names -- course patterns don't apply to rocks, exactly as the Wall
 *  already lays such a set with its own layout. Null for a brick set: its bands keep their own patterns.
 *  Closed contours only: the area band fills the RING between two closed boundaries (buildAreaBandBricks'
 *  slit polygon); an open brush stroke has no ring, so its bands keep their own patterns. */
export function setBandPattern(set, closed = true) {
  if (!closed) return null;
  // a set may declare the area pattern its bands lay (`bandLayout`, e.g. Grey stone: rubble walls, stone-ring bands)
  const name = set && (set.bandLayout || set.layout);
  const def = name && BRICK_PATTERNS[name];
  return def && def.kind === 'tile2d' && def.bandCapable ? name : null;
}

/** Every band's own row count + naturalWidth/pitch/sequence/stagger, precomputed ONCE -- shared by
 *  the `centered` total-width pre-pass (T86 item 7) and the main build loop below, so the two never
 *  compute a band's own row geometry two different ways.
 *
 *  T86 item 20: a band-capable AREA pattern (fieldstone -- `BRICK_PATTERNS[name].bandCapable`) has
 *  no "natural brick-row width" to snap to at all (it's a Poisson-disc/power-diagram fill, not
 *  stacked courses) -- `naturalWidth = band.widthIn` and `rows = 1` makes `naturalWidth * rows`
 *  (what every other caller of this plan already uses for "how much depth did this band consume")
 *  equal the band's own DECLARED width exactly, no rounding, instead of snapping to a meaningless
 *  row count the way a course pattern does. */
function planBands(bands, L, H, set, closed) {
  const setPattern = setBandPattern(set, closed);
  return bands.map((band) => {
    const patternName = setPattern || band.pattern || 'stretcher';
    const patternDef = BRICK_PATTERNS[patternName] || BRICK_PATTERNS.stretcher;
    const isAreaBand = patternDef.kind === 'tile2d' && !!patternDef.bandCapable;
    const cornerStyle = band.cornerStyle || 'mitre';
    const naturalWidth = isAreaBand ? band.widthIn : courseHeightFor(patternDef, L, H);
    const pitch = patternDef.kind === 'course-alternating' ? L : axisLen(patternDef.pitchAxis, L, H);
    const sequence = patternDef.kind === 'course-alternating' ? [L, H] : undefined;
    const staggerFrac = patternDef.staggerFrac || 0;
    const rows = isAreaBand ? 1 : Math.max(1, Math.round(band.widthIn / naturalWidth));
    // T86 item 30: a band narrowed to fit (narrowSingleBand) is ONE row of the declared depth; its bricks are cut to it
    if (band.narrowedTo > 0) return { patternName, cornerStyle, naturalWidth: band.narrowedTo, pitch, sequence, staggerFrac, rows: 1, isAreaBand };
    return { patternName, cornerStyle, naturalWidth, pitch, sequence, staggerFrac, rows, isAreaBand };
  });
}

/** Represents the RING between two closed boundaries (`outer`, `inner`, both CCW/CW-consistent
 *  tessellated polylines from `boundaryAtDepth`) as a single SIMPLE polygon -- the standard
 *  "keyhole"/slit technique: walk `outer` forward, a zero-WIDTH bridge out to `inner[0]`, walk
 *  `inner` in REVERSE back to `inner[0]`, the SAME bridge back. The two bridge edges are the exact
 *  same segment traversed in opposite directions, so they contribute zero net area/crossings to any
 *  ray-cast or Greiner-Hormann walk -- no changes needed in `pointInPolygon`/`polygonIntersection`
 *  themselves, this is purely a way to hand an annulus to algorithms that only know "simple
 *  polygon". KNOWN, ACCEPTED minor cosmetic residual: a stone whose own cell happens to straddle the
 *  bridge's own single radial seam can get an extra (unnecessary but geometrically correct) cut
 *  there -- one specific position around the ring, not a general defect, same class of residual
 *  already documented for cross-row seams elsewhere in this file's own git history. */
/** The index to start the slit's own bridge at -- the LONGEST edge in `outer`, a deliberate choice:
 *  a tessellated boundary's own longest edge is reliably the middle of a long straight run (an arc
 *  contributes many short, closely-spaced tessellation points; a line contributes exactly two, far
 *  apart), i.e. as far from any corner's own degenerate ray-casting/clipping behaviour as this
 *  boundary gets. T86 item 21 (the advisor's own amendment, from the mixed-preset shot): starting
 *  the bridge at `outer[0]` -- WHATEVER point `boundaryAtDepth`'s own tessellation happens to begin
 *  at, often a board corner -- MEASURED a real, substantial coverage gap concentrated right there
 *  (64.4% in a 1.1x1.3in sample box around the corner, vs 92%+ once the bridge starts mid-edge
 *  instead) -- a corner's own sharp turn plus the slit's own degenerate double-edge apparently
 *  interact badly with Poisson-disc's own candidate acceptance nearby. Picking a safer start point
 *  is a complete fix at the SOURCE (no change needed to fieldstoneLayout, pointInPolygon, or
 *  polygonIntersection at all) -- confirmed by direct measurement, not assumed from the theory alone. */
function longestEdgeStart(poly) {
  let bestI = 0, bestLenSq = -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const lenSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (lenSq > bestLenSq) { bestLenSq = lenSq; bestI = i; }
  }
  return bestI;
}
function nearestIndex(point, poly) {
  let bestJ = 0, bestDistSq = Infinity;
  for (let j = 0; j < poly.length; j++) {
    const distSq = (poly[j].x - point.x) ** 2 + (poly[j].y - point.y) ** 2;
    if (distSq < bestDistSq) { bestDistSq = distSq; bestJ = j; }
  }
  return bestJ;
}
function ribbonSlitPolygon(outerIn, innerIn) {
  if (outerIn.length < 3 || innerIn.length < 3) return outerIn;
  // rotate `outer` to the longest-edge start, then find `inner`'s own NEAREST point to that SAME
  // world position -- NOT the same array index: `outer`/`inner` are tessellated independently (each
  // arc's own offset radius differs by depth, so the SAME primitive can contribute a different
  // point count at each depth -- MEASURED a real case, 102 outer points vs 38 inner, where rotating
  // both by the same raw index landed `inner`'s own bridge on a world position having nothing to do
  // with `outer`'s, collapsing the ribbon's own stone count by 40%). Nearest-point matching is
  // robust to this by construction -- `inner` is always roughly a scaled-down `outer`, so its own
  // closest point to any `outer` position IS the corresponding radial spot, regardless of how the
  // two arrays' own lengths/tessellation densities differ.
  const k = Math.min(longestEdgeStart(outerIn), outerIn.length - 1);
  const outer = [...outerIn.slice(k), ...outerIn.slice(0, k)];
  const innerK = nearestIndex(outer[0], innerIn);
  const inner = [...innerIn.slice(innerK), ...innerIn.slice(0, innerK)];
  const innerReversedTail = inner.slice(1).reverse();
  return [...outer, outer[0], inner[0], ...innerReversedTail, inner[0], outer[0]];
}

/** T86 item 20 (Fred: "a frame of fieldstone and a wall of soldier with dot raised"): a band-
 *  capable AREA pattern (today, only fieldstone) fills its own RIBBON region -- the ring between
 *  the band's own outer edge (`depthSoFar`) and inner edge (`depthSoFar + widthIn`) -- with the
 *  SAME `fieldstoneLayout` Wall fill already uses (same tiers, same `largeStones` range), reusing
 *  `bricksFillShape`'s own full pipeline (piece/sample/height-offset assignment) unchanged: the
 *  ribbon is just handed in as `polygon` via `ribbonSlitPolygon` above, exactly like any other
 *  (possibly concave) board outline `bricksFillShape` already clips against -- "corners included, no
 *  mitres needed" per the dispatch, since a stone's own clip against the ring's real edges already
 *  handles a corner correctly with no separate corner-piece machinery the rectangular bond patterns
 *  need. `set.layout` is forced to `patternName` (not read from the real set) so the BAND's own
 *  pattern choice decides which `fill-shape.js` LAYOUTS entry runs, independent of whatever the
 *  Wall's own current set defaults to. */
function buildAreaBandBricks(enriched, d0, d1, band, patternName, set, seed, bandIndex, nextId) {
  const outer = boundaryAtDepth(enriched, d0).filter((p) => p != null);
  const inner = boundaryAtDepth(enriched, d1).filter((p) => p != null);
  if (outer.length < 3 || inner.length < 3) return { pieces: [], nextId };
  const ribbon = ribbonSlitPolygon(outer, inner);
  const { bricks } = bricksFillShape(ribbon, null, {
    set: { ...set, layout: patternName }, seed, largeStones: band.largeStones,
    fences: [outer, inner], // the ring's own edges bound its stones exactly (fieldstone.js fencePoints)
  });
  const pieces = bricks.map((b, i) => ({ ...b, id: `${patternName}-${nextId + i}`, bandIndex, rowIndex: 0, pieceIndex: i }));
  return { pieces, nextId: nextId + pieces.length };
}

/**
 * @param {({type:'line', p0:{x,y}, p1:{x,y}}|{type:'arc', cx:number, cy:number, r:number, theta1:number, theta2:number})[]} primitives
 *   — the contour's own ordered RAW primitives, depth-0 (the true board/frame outline, or -- T86
 *   item 7, `opts.closed=false` -- an OPEN stroke's own fitted line segments).
 * @param {{widthIn:number, pattern:'soldier'|'stretcher'|'header'|'flemish'|'stack', cornerStyle?:'mitre'|'butt'|'lapped'|'block'}[]} bands — outer -> inner (closed), or edge -> edge across the centreline (open + centered)
 * @param {object} opts
 * @param {object} opts.set — a library.BRICK_SETS entry
 * @param {number} [opts.scale=1] — uniform multiplier on the set's own brick length/height (grout unaffected)
 * @param {number} opts.seed
 * @param {boolean} [opts.closed=true] — T86 item 7: false for an OPEN primitive list (a brush
 *   stroke's own fitted line segments) -- no wraparound joint at the two true ends (square/butt
 *   cut, `ribbonPieces`' own open-path support), and `inwardSign` is never auto-detected (an open
 *   polyline has no "inside" to detect) -- each line's own `(-dy,dx)/len` normal is used AS-IS
 *   (a fixed left-of-travel convention), never flipped.
 * @param {boolean} [opts.centered=false] — T86 item 7: only meaningful with `closed:false`. `bands`
 *   stack straddling the stroke's own centreline (depth 0) instead of starting from it and going
 *   only inward -- the SAME forward per-row loop below, just started at `-totalWidth/2` instead of
 *   `0`, so `bands[0]` sits at one edge of the stack and `bands[last]` at the other, exactly
 *   mirroring "width = sum of the bands, centred" (the dispatch's own phrase) with no separate
 *   left/right construction.
 * @returns {{ bricks: Array, innerPath: {x:number,y:number}[] }} innerPath = the last band's own
 *   inner edge (tessellated), where bricksFillShape (the Wall tool) should start from -- `[]` when
 *   `opts.closed===false` (`boundaryAtDepth` is a closed-contour concept; an open stroke has no
 *   Wall-starting inner edge to give it).
 */
/** T86 (advisor, size sheet v3: T1 7x9 three_band at 1.25 in, the middle band fanned out past the board): no band
 *  piece is laid outside the board -- item 19's wall invariant, extended to bands. A piece with real area outside
 *  the outline (more than BOARD_CLIP_TOLERANCE_SQIN) is cut to it (geometry polygonIntersection); what is left under
 *  library.js MIN_PIECE_FRACTION of a brick drops. A piece inside the board is kept exactly as built. WHY it reaches out:
 *  a band deeper than the board's medial line (half the waist) inverts the offset ring -- a waist arc's offset circle
 *  grows past the far side and meets its neighbours outside the board; the fit rule for that is T86 item 28. */
const BOARD_CLIP_TOLERANCE_SQIN = 1e-3; // above the fine tessellation's own chord error on a piece
const BOARD_CLIP_ARC_STEPS = 128; // per arc: a chord sags < 1e-4 in on the templates' fillets
function clipBandPiecesToBoard(bricks, board, set) {
  const minArea = MIN_PIECE_FRACTION * set.brickLengthIn * set.brickHeightIn;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of board) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const out = [];
  for (const b of bricks) {
    const area = Math.abs(signedArea(b.polygon));
    const inside = polygonIntersection(b.polygon, board);
    const kept = inside.length >= 3 ? Math.abs(signedArea(inside)) : 0;
    if (area - kept <= BOARD_CLIP_TOLERANCE_SQIN && b.polygon.every((p) => p.x >= x0 - 1e-6 && p.x <= x1 + 1e-6 && p.y >= y0 - 1e-6 && p.y <= y1 + 1e-6)) { out.push(b); continue; }
    if (kept >= minArea) out.push({ ...b, polygon: inside });
  }
  return out;
}

/** T86 16(c) part 2 (Fred's T18 / T19 / T14 necks): where the board is narrower than twice the band, a row's pieces from
 *  OPPOSITE sides lay over the same ground (each is built from its own primitive with no knowledge of the other).
 *  Declared rule: every point of the band area belongs to the piece whose OWN depth there is smallest -- depth from
 *  the primitive the piece was offset from, exactly as it was built (sourceDepth) -- i.e. the side of the medial line
 *  it lies on; ties go to the lower source index (seed-stable). Each side stops half the set's grout joint short of
 *  the line (advisor, from seat A's Fusion e2e: a 0-gap seam becomes zero-area sliver profiles in the Bricks sketch),
 *  so the seam is a joint like any other. Each piece is cut against the ORIGINAL pieces it
 *  conflicts with, never against already-cut ones, so no region is handed round a cycle (attempt A, WORK-LOG) and
 *  the smallest-depth piece always keeps its ground. The one ground that goes: a far piece's tongue left past the
 *  line inside a near-side joint, cut off from its own piece (MEASURED on the 171-case sweep: every gap that opens
 *  is narrower than the same board's widest existing joint -- it is joint, not a hole). Conflicting = two pieces that overlap by more than
 *  MEDIAL_OVERLAP_SQIN and are either two runs of different source primitives -- across a neck, or (T86 item 21b)
 *  joint neighbours whose corner pieces reach past their mitre, which IS their medial line -- or a corner's fan slice
 *  against a run or a quoin: the fan is the filler and yields, by declaration, everything the other covers plus a
 *  joint (a fan's own dropped fillet gives no usable depth past the fillet's centre).
 *  A piece no conflict touches is returned as the same object (clean boards are byte-identical). Under-size pieces
 *  after the cut: see the drop loop below. */
const MEDIAL_OVERLAP_SQIN = 1e-4;
const FAN = -1; // origins src of a joint's fan slice (primitive-ribbon kiteFan)
const QUOIN = -2; // a block corner's quoin (a declared corner owner); -3 is an area band's stone, never cut here
const MEDIAL_HOLE_SQIN = 0.002; // a drop opening less than this (a grout-wide fleck, 0.034 x 0.06 in) is not a hole
const MEDIAL_DROP_PASSES = 16; // a bound on the one-at-a-time drop trials below (T14's X takes 4)
function sourceDepth(prim) {
  if (prim.type === 'line') return (p) => (p.x - prim.p0.x) * prim.nx + (p.y - prim.p0.y) * prim.ny;
  return (p) => prim.radialSign * (prim.r - Math.hypot(p.x - prim.cx, p.y - prim.cy));
}
/** (da - db) scaled by its own gradient: the signed distance (to first order) from p to the medial line da = db,
 *  negative on a's side. Depth differences change at |n_a - n_b| per inch (2 for two facing sides), so the raw
 *  difference would make a half-joint setback a quarter joint wide at a neck. */
const MEDIAL_GRAD_STEP_IN = 1e-5;
function medialDistance(da, db, p) {
  const f = (q) => da(q) - db(q), h = MEDIAL_GRAD_STEP_IN;
  const gx = (f({ x: p.x + h, y: p.y }) - f({ x: p.x - h, y: p.y })) / (2 * h);
  const gy = (f({ x: p.x, y: p.y + h }) - f({ x: p.x, y: p.y - h })) / (2 * h);
  return f(p) / Math.max(Math.hypot(gx, gy), 1e-6);
}
/** `piece` minus `cutter`, checked: a cut may remove only the ground the two share. MEASURED (T18 1.25 in, the joint
 *  rule's shoulder): a cutter that only TOUCHED a piece (shared area 0) came back from polygonDifference as a 0.016 sq in
 *  remnant of a 0.468 sq in voussoir, and its mirror twin came back LARGER than it went in. No shared ground: the
 *  piece is kept whole; a result that disagrees with area(piece) - area(shared) by more than CUT_CHECK_SQIN: the cut is
 *  refused and the piece kept whole (an overlap the sweep sees, never a brick silently lost). */
const CUT_CHECK_SQIN = 1e-3;
const SEAM_TOLERANCE_IN = 0.002; // a seam this much under the joint is a joint (arc chords sag ~0.004 in at 1.25 in)
/** The shortest distance between two polygons' outlines (vertex to edge, both ways); 0 when they cross. */
function polygonDistance(A, B) {
  let best = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) for (const p of P) for (let k = 0; k < Q.length; k++) {
    const u = Q[k], v = Q[(k + 1) % Q.length], dx = v.x - u.x, dy = v.y - u.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - u.x) * dx + (p.y - u.y) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - u.x - t * dx, p.y - u.y - t * dy));
  }
  return best;
}
function checkedDifference(piece, cutter) {
  const shared = Math.abs(signedArea(polygonIntersection(piece, cutter)));
  if (shared < 1e-9) return [piece]; // a sharp tip in a joint-wide strip shares ~1e-7 sq in
  const left = polygonDifference(piece, cutter);
  const kept = left.reduce((sum, q) => sum + Math.abs(signedArea(q)), 0);
  return Math.abs(kept - (Math.abs(signedArea(piece)) - shared)) > CUT_CHECK_SQIN ? [piece] : left;
}

function yieldAtMedialLine(bricks, origins, primitives, set) {
  const box = (p) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); } return [x0, y0, x1, y1]; };
  const boxes = bricks.map((b) => box(b.polygon));
  const conflicts = bricks.map(() => []);
  for (let i = 0; i < bricks.length; i++) {
    const oi = origins[i];
    if (oi.src < QUOIN) continue;
    for (let j = i + 1; j < bricks.length; j++) {
      const oj = origins[j], a = boxes[i], b = boxes[j];
      if (oj.src < QUOIN || oj.src === oi.src) continue;
      if (Math.min(oi.src, oj.src) === QUOIN && Math.max(oi.src, oj.src) !== FAN) continue; // a run meets a quoin on its cut
      if (oi.src === FAN && oj.src === FAN) continue; // two fan slices meet on their planned joint
      const reach = set.grout.widthIn; // T86 21b: a pair closer than a joint is a conflict too (touching = a 0-gap seam)
      if (a[2] + reach < b[0] || b[2] + reach < a[0] || a[3] + reach < b[1] || b[3] + reach < a[1]) continue;
      const lens = polygonIntersection(bricks[i].polygon, bricks[j].polygon);
      const overlapping = lens.length >= 3 && Math.abs(signedArea(lens)) > MEDIAL_OVERLAP_SQIN;
      if (!overlapping && polygonDistance(bricks[i].polygon, bricks[j].polygon) >= set.grout.widthIn - SEAM_TOLERANCE_IN) continue;
      conflicts[i].push(j); conflicts[j].push(i);
    }
  }
  if (!conflicts.some((c) => c.length)) return bricks;
  const depth = primitives.map(sourceDepth);
  const minArea = MIN_PIECE_FRACTION * set.brickLengthIn * set.brickHeightIn;
  const setback = set.grout.widthIn / 2; // each side stops half the band's joint short of the medial line
  const grown = bricks.map((b, i) => (conflicts[i].length ? offsetPathInward(b.polygon, 2 * setback, -inwardSignFor(b.polygon)) : b.polygon));
  const cutOne = (i, dropped) => {
    const b = bricks[i];
    if (dropped.has(i)) return [];
    let pieces = [b.polygon];
    const di = origins[i].src >= 0 ? depth[origins[i].src] : null;
    for (const j of conflicts[i]) {
      if (dropped.has(j)) continue;
      if (origins[j].src === FAN || origins[i].src === QUOIN) continue; // a run or a quoin keeps its ground against a fan
      if (origins[i].src === FAN) { // a fan yields to a run (or a quoin) all it covers, plus a joint
        pieces = pieces.flatMap((q) => checkedDifference(q, grown[j]));
        continue;
      }
      // the ground piece j takes from piece i: where j covers it AND j's own depth is smaller (ties: lower source),
      // plus a strip half a joint wide on i's side of the line wherever j comes within half a joint of it (j grown
      // by the setback: at the lens tips j's own edge reaches the line and would otherwise touch i there), so the seam
      // is a joint like any other
      const dj = depth[origins[j].src];
      const taken = clipToField(grown[j], (p) => medialDistance(dj, di, p) - setback, origins[j].src > origins[i].src);
      if (taken.length < 3) continue;
      pieces = pieces.flatMap((q) => checkedDifference(q, taken));
    }
    if (pieces.length === 1) return pieces[0];
    // a cut can split a piece; the largest part stays the brick (the rest is a fragment in the other side's joint)
    return pieces.reduce((best, q) => (Math.abs(signedArea(q)) > Math.abs(signedArea(best)) ? q : best), []);
  };
  const areaOf = (poly) => (poly.length < 3 ? 0 : Math.abs(signedArea(poly)));
  // the ground of piece i (its cut) that no other piece covers once the others are re-cut without it
  const orphaned = (i, poly, others) => {
    const bi = box(poly);
    let left = areaOf(poly);
    others.forEach((q, k) => {
      if (k === i || q.length < 3) return;
      const bk = box(q);
      if (bk[2] < bi[0] || bi[2] < bk[0] || bk[3] < bi[1] || bi[3] < bk[1]) return;
      left -= areaOf(polygonIntersection(poly, q));
    });
    return left;
  };
  // A piece the cut leaves under MIN_PIECE_FRACTION drops, one at a time, smallest first, and the cuts are redone
  // without it so its ground goes to the piece across the line. A drop that would open a hole (the re-cut pieces do
  // not cover the dropped piece's ground -- T14's X: a kite's tip beside the X is its own side's, nobody else's) is
  // undone and the piece stays, under-size: a small piece beats a hole. A sliver whose drop opens
  // less than MEDIAL_HOLE_SQIN still drops: a fleck that size reads as joint, a brick that size does not.
  let dropped = new Set();
  const kept = new Set();
  let cut = bricks.map((b, i) => cutOne(i, dropped));
  for (let pass = 0; pass < MEDIAL_DROP_PASSES; pass++) {
    let smallest = -1, smallestArea = minArea;
    cut.forEach((poly, i) => {
      if (!conflicts[i].length || dropped.has(i) || kept.has(i)) return;
      if (areaOf(poly) < smallestArea) { smallest = i; smallestArea = areaOf(poly); }
    });
    if (smallest < 0) break;
    const trial = new Set([...dropped, smallest]);
    // a piece's cut depends only on its own conflicts, so only the dropped piece's partners change
    const trialCut = cut.slice();
    trialCut[smallest] = [];
    for (const j of conflicts[smallest]) trialCut[j] = cutOne(j, trial);
    if (orphaned(smallest, cut[smallest], trialCut) > MEDIAL_HOLE_SQIN) { kept.add(smallest); continue; }
    dropped = trial; cut = trialCut;
  }
  const out = [];
  bricks.forEach((b, i) => {
    if (dropped.has(i) || cut[i].length < 3) return;
    out.push(cut[i] === b.polygon ? b : { ...b, polygon: cut[i] });
  });
  return out;
}

/**
 * T86 item 28 (Fred, the 3-band preset on a 7x9 at 1.25 in: "make the app do the best result"): the FIT RULE for a
 * band stack. The stack's total depth may take at most BAND_FIT_SHARE of the board's narrowest gap between opposite
 * sides (narrowestGap), so a wall always remains where the board allows. A deeper stack is reduced in the declared
 * order BAND_FIT_STEPS, innermost band first, one step at a time, until it fits:
 *   'row'    -- the innermost course band loses one of its extra rows
 *   'course' -- the innermost area band (herringbone, ...) shrinks to one course
 *   'drop'   -- the innermost band goes
 * The outermost band is never reduced: a board too narrow even for it keeps it as requested (today's lay and its
 * warning); after a reduction that still does not fit, the note says `fits: false`. A stack that fits is laid exactly as requested (no note). Ties into 16(c) part 2: a stack
 * deeper than half the gap is what inverts the innermost ring (the band overrun, a41a0b0).
 */
export const BAND_FIT_SHARE = 1 / 3;
export const BAND_FIT_STEPS = Object.freeze(['row', 'course', 'drop']);

/** The board's narrowest gap between opposite sides: from the middle of every boundary edge, a ray along the inward
 *  normal to the FIRST boundary it meets; the shortest. T86 item 31 (MEASURED: T7 read 0.007 in, T14 0.384, T17 0.345):
 *   - a ray whose first hit is a NEIGHBOURING primitive is a corner's wedge, not a gap: ignored (not continued past it);
 *   - a waist between two REFLEX primitive junctions is crossed by no edge normal (T14's hourglass: every side ray meets
 *     its corner first), so each reflex junction also reads its distance to the NEAREST point of a primitive that is
 *     neither its own nor a neighbour -- counted only where a circle fits across (WAIST_CLEARANCE_SHARE): the segment's
 *     middle at least that share of half its length from every boundary. Nearest, not a bisector ray: T16's junctions
 *     turn 104 deg and their bisectors met the far side 3.90 in away, past the 2.47 in waist. MEASURED (7x9), the
 *     clearance share of each template's nearest junction reading: real waists / necks 0.94-1.0 (T6 T9 T14-T19), a
 *     notch lip read down the board's side to the next edge 0.05-0.35 (T1 T3 T4 T5 T8 T10-T13).
 *  `source[k]` = the primitive that boundary vertex k (and edge k -> k+1) belongs to; omitted, every edge is its own. */
export const WAIST_CLEARANCE_SHARE = 0.9;
export function narrowestGap(board, source = board.map((_, k) => k)) {
  const n = board.length, m = Math.max(...source) + 1;
  // signedArea is NEGATIVE for a counter-clockwise loop (x right, y up; measured on a unit square), whose inside is
  // on the left of each edge: (-dy, dx)
  const inward = signedArea(board) < 0 ? 1 : -1;
  const neighbours = (p, q) => p !== q && ((p + 1) % m === q || (q + 1) % m === p);
  const firstHit = (ox, oy, nx, ny, from, skip) => {
    let t0 = Infinity, hit = -1;
    for (let j = 0; j < n; j++) {
      if (skip.includes(j)) continue;
      const c = board[j], d = board[(j + 1) % n];
      const ex = d.x - c.x, ey = d.y - c.y;
      const den = nx * ey - ny * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - ox) * ey - (c.y - oy) * ex) / den; // along the ray
      const u = ((c.x - ox) * ny - (c.y - oy) * nx) / den; // along edge j
      if (t > 1e-6 && u >= 0 && u <= 1 && t < t0) { t0 = t; hit = j; }
    }
    if (hit >= 0) plain = Math.min(plain, t0);
    return hit >= 0 && !from.some((p) => neighbours(p, source[hit])) ? t0 : Infinity;
  };
  let plain = Infinity; // every first hit, filter or not: the reading when no ray qualifies (a lens, a triangle -- every
  // primitive the others' neighbour)
  const edgeNormal = (k) => {
    const a = board[k], b = board[(k + 1) % n], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    return len < 1e-9 ? null : { x: (-dy / len) * inward, y: (dx / len) * inward, dx, dy };
  };
  const clearance = (x, y) => {
    let c = Infinity;
    for (let k = 0; k < n; k++) {
      const a = board[k], b = board[(k + 1) % n], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const w = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
      c = Math.min(c, Math.hypot(x - a.x - w * dx, y - a.y - w * dy));
    }
    return c;
  };
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const nrm = edgeNormal(i);
    if (!nrm) continue;
    const a = board[i], b = board[(i + 1) % n];
    best = Math.min(best, firstHit((a.x + b.x) / 2, (a.y + b.y) / 2, nrm.x, nrm.y, [source[i]], [i]));
  }
  for (let v = 0; v < n; v++) {
    const pv = (v - 1 + n) % n;
    if (source[pv] === source[v]) continue; // a primitive junction only
    const n1 = edgeNormal(pv), n2 = edgeNormal(v);
    if (!n1 || !n2 || (n1.dx * n2.dy - n1.dy * n2.dx) * inward >= 0) continue; // reflex: turns away from the inside
    const V = board[v], own = [source[pv], source[v]];
    for (let j = 0; j < n; j++) {
      if (own.some((p) => p === source[j] || neighbours(p, source[j]))) continue;
      const c = board[j], d = board[(j + 1) % n], ex = d.x - c.x, ey = d.y - c.y, l2 = ex * ex + ey * ey;
      if (l2 < 1e-18) continue;
      const u = Math.max(0, Math.min(1, ((V.x - c.x) * ex + (V.y - c.y) * ey) / l2));
      const qx = c.x + u * ex, qy = c.y + u * ey, t = Math.hypot(qx - V.x, qy - V.y);
      if (!(t < best && t > 1e-6)) continue;
      const mx = (V.x + qx) / 2, my = (V.y + qy) / 2;
      if (!pointInPolygon(mx, my, board)) continue; // across the board, not the outside (a notch's mouth)
      if (clearance(mx, my) >= WAIST_CLEARANCE_SHARE * (t / 2)) best = t;
    }
  }
  return Number.isFinite(best) ? best : plain;
}

function fitBandStack(bands, planned, gap, L, H) {
  const limit = BAND_FIT_SHARE * gap;
  const depthOf = (plans) => plans.reduce((sum, p) => sum + p.naturalWidth * p.rows, 0);
  const requested = depthOf(planned);
  if (requested <= limit) return null;
  const oneCourse = courseHeightFor(BRICK_PATTERNS.stretcher, L, H);
  const kept = planned.map((p) => ({ ...p }));
  const steps = [];
  while (depthOf(kept) > limit && kept.length > 1) { // the outermost band is never reduced
    const i = kept.length - 1, p = kept[i];
    if (!p.isAreaBand && p.rows > 1) { p.rows--; steps.push({ band: i, step: 'row' }); }
    else if (p.isAreaBand && p.naturalWidth > oneCourse) { p.naturalWidth = oneCourse; steps.push({ band: i, step: 'course' }); }
    else { kept.pop(); steps.push({ band: i, step: 'drop' }); }
  }
  if (!steps.length) return null; // a single band: laid as requested (today's lay and its warning)
  const fitted = kept.map((p, i) => ({ ...bands[i], widthIn: p.naturalWidth * p.rows }));
  return { bands: fitted, note: { requested: bands.length, kept: fitted.length, steps, gapIn: gap, limitIn: limit, requestedDepthIn: requested, depthIn: depthOf(kept), fits: depthOf(kept) <= limit } };
}

/** T86 item 30 (Fred's item 28 ruling, "make the app do the best result"; advisor (b')): a SINGLE band too deep for a
 *  feature of the board -- its row would drop a line lying between two lines (lineBetweenLinesDropsAt) -- is laid at the
 *  deepest depth where no such line drops, less a joint, instead of stranding fans and leaving the feature bare. Narrowing
 *  is LOCAL: MEASURED over 456 lays (8 presets x 19 templates x 0.75 / 1 / 1.25 in, 7x9) it changes none, and over 2,052
 *  (+ 1.5 in, 6x9 / 9x12) 36 -- T6 / T9 / T15 at 1.25-1.5 in, bare band ground up to 8.8 sq in -> 0; a BAND_FIT_SHARE of
 *  narrowestGap would have narrowed 201 of the 456 (when it still read T7 as 0.007 in -- item 31). Returns the narrowed
 *  band + its note step, or null when the band lays as requested. */
const NARROW_BISECT_STEPS = 24;
function narrowSingleBand(enriched, band, planned, halfJoint, joint) {
  const depth = planned.naturalWidth * planned.rows;
  const rowEdge = (d) => d - halfJoint; // the row's inner edge under the joint rule (it stops half a joint short of the wall)
  if (!lineBetweenLinesDropsAt(enriched, rowEdge(depth))) return null;
  let lo = 0, hi = depth;
  for (let k = 0; k < NARROW_BISECT_STEPS; k++) { const mid = (lo + hi) / 2; if (lineBetweenLinesDropsAt(enriched, rowEdge(mid))) hi = mid; else lo = mid; }
  const toIn = lo - joint;
  if (!(toIn > joint)) return null; // nothing sensible left to lay: as requested, with today's warning
  // the wall's boundary is taken PAST the cliff (hi: the line has dropped) and half a joint further: at the band's own
  // wall depth (lo) the consumed feature is still a sliver of wall -- T9 7x9 1.5 in a 0.018 in skeleton, a tapering neck
  // (T15 / T6 1.5 in) a spike under 0.01 in -- which bondLayout fills with cells over the band (MEASURED: 0.03-0.99 sq in).
  // Wall ground narrower than a joint is mortar. Cost: on a narrowed lay the band-to-wall seam is 1.5 joints.
  return { band: { ...band, widthIn: toIn, narrowedTo: toIn }, step: { band: 0, step: 'narrow', toIn }, requestedDepthIn: depth, wallDepthIn: rowEdge(hi) + halfJoint };
}

export function bricksContourBands(primitives, bands, opts) {
  const { seed } = opts;
  const closed = opts.closed !== false;
  const set = scaledSet(opts.set, opts.scale); // scaled ONCE here; the inner ribbonPieces calls
  // below get this already-scaled set directly (no opts.scale passed to them) so it's never applied twice.
  const inwardSign = closed ? inwardSignFor(tessellate(primitives)) : 1;
  const enriched = enrichPrimitives(primitives, inwardSign);

  const bricks = [];
  const origins = []; // per brick, for yieldAtMedialLine: { src } (-1 a fan, -2 a quoin, -3 an area band's stone)
  const L = set.brickLengthIn, H = set.brickHeightIn;
  let plannedBands = planBands(bands, L, H, set, closed);
  // T86 item 28: a closed, outer stack (the frame) obeys the fit rule; centred and open ones (brush ribbons) have no board
  const fitBoard = closed && !opts.centered ? tessellate(primitives, BOARD_CLIP_ARC_STEPS) : null;
  const fitBoardSource = fitBoard ? primitives.flatMap((prim, k) => (prim.type === 'arc' ? Array(BOARD_CLIP_ARC_STEPS).fill(k) : [k])) : null;
  // opts.bandFit === false: a schematic on a tiny board (the band-preset / corner icons), drawn as requested
  const fit = fitBoard && opts.bandFit !== false ? fitBandStack(bands, plannedBands, narrowestGap(fitBoard, fitBoardSource), L, H) : null;
  if (fit) { bands = fit.bands; plannedBands = planBands(bands, L, H, set, closed); }
  // T86 item 30: a single band (as requested, or what item 28 left) too deep for a feature narrows to fit it
  let narrowNote = null, narrowWallDepth = 0;
  // course bands only: an AREA band (fieldstone) fills its ring polygon, it has no run to drop and strand
  if (closed && !opts.centered && opts.bandFit !== false && bands.length === 1 && !plannedBands[0].isAreaBand) {
    const narrowed = narrowSingleBand(enriched, bands[0], plannedBands[0], set.grout.widthIn / 2, set.grout.widthIn);
    if (narrowed) {
      bands = [narrowed.band]; plannedBands = planBands(bands, L, H, set, closed); narrowWallDepth = narrowed.wallDepthIn;
      narrowNote = fit
        ? { ...fit.note, steps: [...fit.note.steps, narrowed.step], depthIn: narrowed.step.toIn, fits: true }
        : { requested: 1, kept: 1, steps: [narrowed.step], requestedDepthIn: narrowed.requestedDepthIn, depthIn: narrowed.step.toIn, fits: true };
    }
  }
  let depthSoFar = opts.centered
    ? -plannedBands.reduce((sum, b) => sum + b.naturalWidth * b.rows, 0) / 2
    : 0;
  const ribbonStartDepth = depthSoFar; // F35 item 55: an open centred ribbon's first edge
  let nextId = 0;
  // T86 item 21b, the JOINT RULE: every seam is the declared joint, rows and bands included (advisor; seat A's Fusion
  // e2e counted 147 profiles for 126 pieces, the extras from 0-gap wall-vs-band contacts, and two abutting courses
  // read as one slab in 3D). Each row stops half a joint short of the row (or band) beside it and of the wall; only
  // the stack's own outer edge (the board, or an open stroke's two edges) has no joint.
  const halfJoint = set.grout.widthIn / 2;
  const stackStart = depthSoFar, stackEnd = depthSoFar + plannedBands.reduce((sum, b) => sum + b.naturalWidth * b.rows, 0);
  const rowDepths = (d0, d1) => [
    d0 > stackStart + 1e-9 ? d0 + halfJoint : d0,
    d1 < stackEnd - 1e-9 || closed ? d1 - halfJoint : d1,
  ];

  bands.forEach((band, bandIndex) => {
    // T86 item 2: read the SAME declared pitch/cross axes + stagger `layouts/bond.js`'s own
    // Wall-side rows already use (`axisLen`/`courseHeightFor`, imported not re-derived) instead of
    // this file's own former bare `pattern==='soldier'` ternary -- soldier/stretcher keep their
    // EXACT prior naturalWidth/pitch values (confirmed: `courseHeightFor`/`axisLen` reduce to the
    // identical two numbers for those two patterns), header/stack now resolve correctly too
    // (previously sized AS IF stretcher, band-course.js's own measured defect this replaces).
    // flemish ('course-alternating') has no single pitch at all -- its own `sequence` (below)
    // carries [L,H] instead, and `pitch` here is only the FILL-FRACTION base for its own end
    // pieces (same role every other pattern already gives it), not a per-piece length.
    const { patternName, cornerStyle, naturalWidth, pitch, sequence, staggerFrac, rows, isAreaBand } = plannedBands[bandIndex];
    if (isAreaBand) {
      const [a0, a1] = rowDepths(depthSoFar, depthSoFar + band.widthIn);
      const { pieces, nextId: afterId } = buildAreaBandBricks(enriched, a0, a1, band, patternName, set, seed, bandIndex, nextId);
      bricks.push(...pieces);
      for (let i = 0; i < pieces.length; i++) origins.push({ src: -3 }); // an area band's stones
      nextId = afterId;
      depthSoFar += naturalWidth * rows;
      return; // forEach callback -- next band
    }
    for (let row = 0; row < rows; row++) {
      const [d0, d1] = rowDepths(depthSoFar + naturalWidth * row, depthSoFar + naturalWidth * (row + 1));
      const odd = row % 2 === 1;
      // flemish: ALWAYS rotate its own 2-element sequence by one position on odd rows -- the
      // discrete equivalent of bond.js's own hardcoded "offset by half the period" for a 2-element
      // repeat (never gated by staggerFrac, which flemish doesn't declare at all: there is only one
      // correct flemish stagger, not a tunable one). Every other 'course'-kind pattern instead
      // forces its own START end piece to the declared `staggerFrac` fraction on odd rows (e.g.
      // stretcher's own 0.5 = a real half-brick running-bond offset) -- `forcedFStart` is already
      // one of `FILL_FRACTIONS`' own declared values, never a new kind of cut (see
      // `planCornerRun`'s own header).
      const rowSequence = sequence && odd ? [sequence[1], sequence[0]] : sequence;
      const forcedFStart = !sequence && staggerFrac > 0 && odd ? staggerFrac : undefined;
      const { pieces, nextId: afterId, sources } = ribbonPieces(
        enriched, d0, d1, set, patternName, pitch, set.grout.widthIn,
        seed ^ (bandIndex * 0x1000193) ^ (row * 0x01000000), 'frame', nextId, cornerStyle, bandIndex,
        rowSequence, forcedFStart, closed, row,
      );
      bricks.push(...pieces);
      for (const src of sources) origins.push({ src });
      nextId = afterId;
    }
    depthSoFar += naturalWidth * rows;
  });

  // centred bands straddle the path by design, and an open path has no board: only a closed outer stack is clipped
  // a band at least as deep as the board is wide (its bounding box's shorter side) has no medial line to split at --
  // every piece crosses the board: laid as requested, like item 28's "too narrow for even one band" (MEASURED: a
  // life-size 8 in soldier band on a 7 x 9 board, tests/bricks-no-corrupt-polygon.test.js, ~3000 conflicting pairs,
  // 2 s per lay). Not narrowestGap: its normal rays read T14's X corners as a gap narrower than a 1.25 in band.
  const boardWidth = fitBoard ? Math.min(...['x', 'y'].map((k) => Math.max(...fitBoard.map((p) => p[k])) - Math.min(...fitBoard.map((p) => p[k])))) : 0;
  const split = depthSoFar < boardWidth ? yieldAtMedialLine(bricks, origins, enriched, set) : bricks;
  const laid = fitBoard ? clipBandPiecesToBoard(split, fitBoard, set) : bricks;
  // the wall keeps half its own joint from the band (grout is one global width, so band + wall = one joint)
  const wallDepth = Math.max(bands.length ? depthSoFar + halfJoint : depthSoFar, narrowWallDepth);
  return { bricks: laid, innerPath: closed ? boundaryAtDepth(enriched, wallDepth) : [], ...(narrowNote ? { bandsReduced: narrowNote } : fit ? { bandsReduced: fit.note } : {}),
    // F35 item 55 (seat E): an open centred ribbon's outline (a Brush stroke's grout region), additive
    ...(!closed && opts.centered ? { ribbonOutline: openRibbonOutline(enriched, ribbonStartDepth, depthSoFar) } : {}) };
}

/**
 * The band-pattern (u,v) hook (F35 item 7's own declared proposal, library.js's own
 * `BRICK_PATTERNS` header: "a Frame band's is its own path-local frame (arc-length + perpendicular
 * offset, f3's own territory, not built here)" -- this is that territory). `bricksContourBands`
 * itself only ever consumes 'course'-kind patterns (soldier/stretcher); this is the separate,
 * smaller piece that lets a CONSUMER (de's own per-band pattern picker) place anything it wants --
 * including a 'tile2d' pattern -- along a curved Frame band, by giving it a way to turn its own
 * flat (u,v) pattern-space coordinates into real (x,y) world points without needing to know
 * anything about lines-vs-arcs, joints, or inward offsetting itself.
 *
 * Deliberately just a composition of two ALREADY-exact, already-tested primitives, nothing new
 * geometrically: `v` (signed depth from the board's own true outline, same convention every band/
 * row in `bricksContourBands` above already uses: 0 = the true outer edge, increasing = inward)
 * selects WHICH offset boundary via `boundaryAtDepth` (exact for lines, exact analytic circles for
 * arcs -- only the RETURN value is a tessellated polyline, the geometry itself is not approximated);
 * `u` (arc length along THAT boundary, wrapping -- a closed contour) locates the point on it via
 * `pointAtArcLength`. `u`'s own total range therefore shrinks/grows with `v` exactly the way a real
 * curved brick course does (an inner course has a shorter true circumference than an outer one,
 * same as the arc-voussoir pieces already taper) -- not corrected away, since that's the physically
 * correct behaviour, not an artifact.
 *
 * Returns a closure, not a one-shot function: `boundaryAtDepth`/`enrichPrimitives` do real work (the
 * whole path's own global inward sign, once), so a caller sampling many (u,v) points for one band
 * (exactly what a pattern generator does) pays that cost ONCE, not per sample.
 *
 * @param {Array} primitives — the SAME raw closed-contour primitives `bricksContourBands` takes.
 * @returns {(u:number, v:number) => {x:number,y:number,tx:number,ty:number,nx:number,ny:number}}
 *   `tx,ty` = unit tangent (the direction `u` increases in); `nx,ny` = unit normal, INWARD-positive
 *   (the direction `v` increases in) -- together a right-handed local frame at that (u,v).
 */
export function bandFrameAt(primitives) {
  const inwardSign = inwardSignFor(tessellate(primitives));
  const enriched = enrichPrimitives(primitives, inwardSign);
  const boundaryCache = new Map(); // v (depth) -> {boundary, cum} -- callers sample many u's per v (one row's whole pattern)
  return function sample(u, v) {
    let entry = boundaryCache.get(v);
    if (!entry) {
      // `boundaryAtDepth`'s own joint lookup (`jointPointAt` -> `curveIntersection`) can return
      // null at a depth no EXISTING caller happens to land on exactly (bricksContourBands only ever
      // calls it at depths quantised to a whole number of brick rows) -- MEASURED on T1 at an
      // arbitrary v=0.3: a null between two otherwise-valid points near a shoulder fillet's own
      // joint. That's a separate, pre-existing gap in the shared joint machinery (not something this
      // hook fixes), so this sampler just drops it -- the polyline connects its two real neighbours
      // directly instead, a locally tiny straight-line simplification, not a wrong answer.
      const boundary = boundaryAtDepth(enriched, v).filter((p) => p != null);
      // `pointAtArcLength`'s own `closed` flag only wraps `u` modulo whatever `cum` already spans --
      // it does NOT know to add a final closing edge back to the start on its own (editor-brick-
      // tool.js's own `buildArcSegments`, the established caller of this exact pair, explicitly
      // appends `points[0]` before computing `cum` for this reason). MEASURED missing this step on
      // the plain SQUARE fixture: an inset-by-1 square's own true 32in perimeter (4 sides of 8) came
      // back as `cum`'s own total of 24in (the left edge silently never walked, `u` jumping straight
      // from the top-left corner back to the bottom-left one with zero length) before this fix.
      const closedBoundary = boundary.length > 1 ? boundary.concat([boundary[0]]) : boundary;
      entry = { boundary: closedBoundary, cum: cumulativeLengths(closedBoundary) };
      boundaryCache.set(v, entry);
    }
    const { boundary, cum } = entry;
    const { x, y, tx, ty } = pointAtArcLength(boundary, cum, u, true);
    return { x, y, tx, ty, nx: -ty, ny: tx };
  };
}
