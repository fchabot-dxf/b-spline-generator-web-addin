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
import { inwardSignFor, cumulativeLengths, pointAtArcLength, polygonIntersection, signedArea } from './geometry.js';
import { radialSignAt } from './arc-voussoir.js';
import { ribbonPieces, boundaryAtDepth } from './primitive-ribbon.js';
import { scaledSet, BRICK_PATTERNS } from './library.js';
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
  const name = set && set.layout;
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
 *  BAND_MIN_PIECE_FRACTION of a brick drops. A piece inside the board is kept exactly as built. WHY it reaches out:
 *  a band deeper than the board's medial line (half the waist) inverts the offset ring -- a waist arc's offset circle
 *  grows past the far side and meets its neighbours outside the board; the fit rule for that is T86 item 28. */
const BAND_MIN_PIECE_FRACTION = 0.25; // the same quarter-brick floor as layouts/bond.js and layouts/fieldstone.js
const BOARD_CLIP_TOLERANCE_SQIN = 1e-3; // above the fine tessellation's own chord error on a piece
const BOARD_CLIP_ARC_STEPS = 128; // per arc: a chord sags < 1e-4 in on the templates' fillets
function clipBandPiecesToBoard(bricks, board, set) {
  const minArea = BAND_MIN_PIECE_FRACTION * set.brickLengthIn * set.brickHeightIn;
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

export function bricksContourBands(primitives, bands, opts) {
  const { seed } = opts;
  const closed = opts.closed !== false;
  const set = scaledSet(opts.set, opts.scale); // scaled ONCE here; the inner ribbonPieces calls
  // below get this already-scaled set directly (no opts.scale passed to them) so it's never applied twice.
  const inwardSign = closed ? inwardSignFor(tessellate(primitives)) : 1;
  const enriched = enrichPrimitives(primitives, inwardSign);

  const bricks = [];
  const L = set.brickLengthIn, H = set.brickHeightIn;
  const plannedBands = planBands(bands, L, H, set, closed);
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
      const { pieces, nextId: afterId } = ribbonPieces(
        enriched, d0, d1, set, patternName, pitch, set.grout.widthIn,
        seed ^ (bandIndex * 0x1000193) ^ (row * 0x01000000), 'frame', nextId, cornerStyle, bandIndex,
        rowSequence, forcedFStart, closed, row,
      );
      bricks.push(...pieces);
      nextId = afterId;
    }
    depthSoFar += naturalWidth * rows;
  });

  // centred bands straddle the path by design, and an open path has no board: only a closed outer stack is clipped
  const laid = closed && !opts.centered ? clipBandPiecesToBoard(bricks, tessellate(primitives, BOARD_CLIP_ARC_STEPS), set) : bricks;
  return { bricks: laid, innerPath: closed ? boundaryAtDepth(enriched, depthSoFar) : [] };
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
