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
import { inwardSignFor, cumulativeLengths, pointAtArcLength, polygonIntersection, signedArea, clipToField, polygonDifference } from './geometry.js';
import { radialSignAt } from './arc-voussoir.js';
import { ribbonPieces, boundaryAtDepth } from './primitive-ribbon.js';
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
function buildAreaBandBricks(enriched, depthSoFar, band, patternName, set, seed, bandIndex, nextId) {
  const outer = boundaryAtDepth(enriched, depthSoFar).filter((p) => p != null);
  const inner = boundaryAtDepth(enriched, depthSoFar + band.widthIn).filter((p) => p != null);
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
 *  it lies on; ties go to the lower source index (seed-stable). Each piece is cut against the ORIGINAL pieces it
 *  conflicts with, never against already-cut ones, so no region is handed round a cycle (attempt A, WORK-LOG) and
 *  the smallest-depth piece always keeps its ground. The one ground that goes: a far piece's tongue left past the
 *  line inside a near-side joint, cut off from its own piece (MEASURED on the 171-case sweep: every gap that opens
 *  is narrower than the same board's widest existing joint -- it is joint, not a hole). Conflicting = two pieces of different
 *  source primitives that are not joint neighbours in either piece's row walk (neighbours already meet at their
 *  mitre, their own medial line; a corner's fan residual is 21b's) and overlap by more than MEDIAL_OVERLAP_SQIN.
 *  A piece no conflict touches is returned as the same object (clean boards are byte-identical). Under-size pieces
 *  after the cut: see the drop loop below. */
const MEDIAL_OVERLAP_SQIN = 1e-4;
const MEDIAL_HOLE_SQIN = 0.002; // a drop opening less than this (a grout-wide fleck, 0.034 x 0.06 in) is not a hole
const MEDIAL_DROP_PASSES = 16; // a bound on the one-at-a-time drop trials below (T14's X takes 4)
function sourceDepth(prim) {
  if (prim.type === 'line') return (p) => (p.x - prim.p0.x) * prim.nx + (p.y - prim.p0.y) * prim.ny;
  return (p) => prim.radialSign * (prim.r - Math.hypot(p.x - prim.cx, p.y - prim.cy));
}
function jointNeighbours(live, a, b) {
  if (!live) return false;
  const i = live.indexOf(a), j = live.indexOf(b), m = live.length;
  return i >= 0 && j >= 0 && ((i + 1) % m === j || (j + 1) % m === i);
}
function yieldAtMedialLine(bricks, origins, primitives, set) {
  const box = (p) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); } return [x0, y0, x1, y1]; };
  const boxes = bricks.map((b) => box(b.polygon));
  const conflicts = bricks.map(() => []);
  for (let i = 0; i < bricks.length; i++) {
    const oi = origins[i];
    if (oi.src < 0) continue;
    for (let j = i + 1; j < bricks.length; j++) {
      const oj = origins[j], a = boxes[i], b = boxes[j];
      if (oj.src < 0 || oj.src === oi.src) continue;
      if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
      if (jointNeighbours(oi.live, oi.src, oj.src) || jointNeighbours(oj.live, oi.src, oj.src)) continue;
      const lens = polygonIntersection(bricks[i].polygon, bricks[j].polygon);
      if (lens.length < 3 || Math.abs(signedArea(lens)) <= MEDIAL_OVERLAP_SQIN) continue;
      conflicts[i].push(j); conflicts[j].push(i);
    }
  }
  if (!conflicts.some((c) => c.length)) return bricks;
  const depth = primitives.map(sourceDepth);
  const minArea = MIN_PIECE_FRACTION * set.brickLengthIn * set.brickHeightIn;
  const cutAll = (dropped) => bricks.map((b, i) => {
    if (dropped.has(i)) return [];
    let pieces = [b.polygon];
    const di = depth[origins[i].src];
    for (const j of conflicts[i]) {
      if (dropped.has(j)) continue;
      // the ground piece j takes from piece i: where j covers it AND j's own depth is smaller (ties: lower source)
      const dj = depth[origins[j].src];
      const taken = clipToField(bricks[j].polygon, (p) => dj(p) - di(p), origins[j].src > origins[i].src);
      if (taken.length < 3) continue;
      pieces = pieces.flatMap((q) => polygonDifference(q, taken));
    }
    if (pieces.length === 1) return pieces[0];
    // a cut can split a piece; the largest part stays the brick (the rest is a fragment in the other side's joint)
    return pieces.reduce((best, q) => (Math.abs(signedArea(q)) > Math.abs(signedArea(best)) ? q : best), []);
  });
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
  let cut = cutAll(dropped);
  for (let pass = 0; pass < MEDIAL_DROP_PASSES; pass++) {
    let smallest = -1, smallestArea = minArea;
    cut.forEach((poly, i) => {
      if (!conflicts[i].length || dropped.has(i) || kept.has(i)) return;
      if (areaOf(poly) < smallestArea) { smallest = i; smallestArea = areaOf(poly); }
    });
    if (smallest < 0) break;
    const trial = new Set([...dropped, smallest]);
    const trialCut = cutAll(trial);
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
 *  normal to the first boundary it meets; the shortest. */
export function narrowestGap(board) {
  const n = board.length;
  // signedArea is NEGATIVE for a counter-clockwise loop (x right, y up; measured on a unit square), whose inside is
  // on the left of each edge: (-dy, dx)
  const inward = signedArea(board) < 0 ? 1 : -1;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = board[i], b = board[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = (-dy / len) * inward, ny = (dx / len) * inward;
    const ox = (a.x + b.x) / 2, oy = (a.y + b.y) / 2;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const c = board[j], d = board[(j + 1) % n];
      const ex = d.x - c.x, ey = d.y - c.y;
      const den = nx * ey - ny * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - ox) * ey - (c.y - oy) * ex) / den; // along the ray
      const u = ((c.x - ox) * ny - (c.y - oy) * nx) / den; // along edge j
      if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
    }
  }
  return best;
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

export function bricksContourBands(primitives, bands, opts) {
  const { seed } = opts;
  const closed = opts.closed !== false;
  const set = scaledSet(opts.set, opts.scale); // scaled ONCE here; the inner ribbonPieces calls
  // below get this already-scaled set directly (no opts.scale passed to them) so it's never applied twice.
  const inwardSign = closed ? inwardSignFor(tessellate(primitives)) : 1;
  const enriched = enrichPrimitives(primitives, inwardSign);

  const bricks = [];
  const origins = []; // per brick, for yieldAtMedialLine: { src, live } (src -1 = no single source primitive)
  const L = set.brickLengthIn, H = set.brickHeightIn;
  let plannedBands = planBands(bands, L, H, set, closed);
  // T86 item 28: a closed, outer stack (the frame) obeys the fit rule; centred and open ones (brush ribbons) have no board
  const fitBoard = closed && !opts.centered ? tessellate(primitives, BOARD_CLIP_ARC_STEPS) : null;
  // opts.bandFit === false: a schematic on a tiny board (the band-preset / corner icons), drawn as requested
  const fit = fitBoard && opts.bandFit !== false ? fitBandStack(bands, plannedBands, narrowestGap(fitBoard), L, H) : null;
  if (fit) { bands = fit.bands; plannedBands = planBands(bands, L, H, set, closed); }
  let depthSoFar = opts.centered
    ? -plannedBands.reduce((sum, b) => sum + b.naturalWidth * b.rows, 0) / 2
    : 0;
  let nextId = 0;

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
      const { pieces, nextId: afterId } = buildAreaBandBricks(enriched, depthSoFar, band, patternName, set, seed, bandIndex, nextId);
      bricks.push(...pieces);
      for (let i = 0; i < pieces.length; i++) origins.push({ src: -1, live: null });
      nextId = afterId;
      depthSoFar += naturalWidth * rows;
      return; // forEach callback -- next band
    }
    for (let row = 0; row < rows; row++) {
      const d0 = depthSoFar + naturalWidth * row, d1 = depthSoFar + naturalWidth * (row + 1);
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
      const { pieces, nextId: afterId, sources, liveIndices } = ribbonPieces(
        enriched, d0, d1, set, patternName, pitch, set.grout.widthIn,
        seed ^ (bandIndex * 0x1000193) ^ (row * 0x01000000), 'frame', nextId, cornerStyle, bandIndex,
        rowSequence, forcedFStart, closed, row,
      );
      bricks.push(...pieces);
      for (const src of sources) origins.push({ src, live: liveIndices });
      nextId = afterId;
    }
    depthSoFar += naturalWidth * rows;
  });

  // centred bands straddle the path by design, and an open path has no board: only a closed outer stack is clipped
  const laid = fitBoard ? clipBandPiecesToBoard(yieldAtMedialLine(bricks, origins, enriched, set), fitBoard, set) : bricks;
  return { bricks: laid, innerPath: closed ? boundaryAtDepth(enriched, depthSoFar) : [], ...(fit ? { bandsReduced: fit.note } : {}) };
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
