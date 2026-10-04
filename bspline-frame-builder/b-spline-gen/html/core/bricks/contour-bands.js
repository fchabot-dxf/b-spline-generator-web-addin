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
import { inwardSignFor, cumulativeLengths, pointAtArcLength } from './geometry.js';
import { radialSignAt } from './arc-voussoir.js';
import { ribbonPieces, boundaryAtDepth } from './primitive-ribbon.js';
import { scaledSet, BRICK_PATTERNS } from './library.js';
import { axisLen, courseHeightFor } from './layouts/bond.js';

const ARC_TESS_STEPS = 16; // only for inwardSignFor's own tessellation -- a smoothness floor for
// deciding which way is "inward", never a correctness requirement (ribbonPieces itself never
// tessellates an arc's own interior; its only geometry is the exact analytic circle).

function tessellate(primitives) {
  const points = [];
  for (const prim of primitives) {
    if (prim.type === 'arc') {
      for (let k = 0; k < ARC_TESS_STEPS; k++) {
        const t = prim.theta1 + ((prim.theta2 - prim.theta1) * k) / ARC_TESS_STEPS;
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

/**
 * @param {({type:'line', p0:{x,y}, p1:{x,y}}|{type:'arc', cx:number, cy:number, r:number, theta1:number, theta2:number})[]} primitives
 *   — the closed contour's own ordered RAW primitives, depth-0 (the true board/frame outline).
 * @param {{widthIn:number, pattern:'soldier'|'stretcher'|'header'|'flemish'|'stack', cornerStyle?:'mitre'|'butt'|'lapped'|'block'}[]} bands — outer -> inner
 * @param {object} opts
 * @param {object} opts.set — a library.BRICK_SETS entry
 * @param {number} [opts.scale=1] — uniform multiplier on the set's own brick length/height (grout unaffected)
 * @param {number} opts.seed
 * @returns {{ bricks: Array, innerPath: {x:number,y:number}[] }} innerPath = the last band's own
 *   inner edge (tessellated), where bricksFillShape (the Wall tool) should start from.
 */
export function bricksContourBands(primitives, bands, opts) {
  const { seed } = opts;
  const set = scaledSet(opts.set, opts.scale); // scaled ONCE here; the inner ribbonPieces calls
  // below get this already-scaled set directly (no opts.scale passed to them) so it's never applied twice.
  const inwardSign = inwardSignFor(tessellate(primitives));
  const enriched = enrichPrimitives(primitives, inwardSign);

  const bricks = [];
  let depthSoFar = 0;
  let nextId = 0;

  const L = set.brickLengthIn, H = set.brickHeightIn;

  bands.forEach((band, bandIndex) => {
    const patternName = band.pattern || 'stretcher';
    const patternDef = BRICK_PATTERNS[patternName] || BRICK_PATTERNS.stretcher;
    // T86 item 1: 'butt'/'lapped'/'block' (declared per-band, default 'mitre' -- every existing
    // preset/caller that never declares this keeps today's exact symmetric-mitre behaviour).
    const cornerStyle = band.cornerStyle || 'mitre';
    // T86 item 2 (replaces de's separate band-course.js engine, parked): read the SAME declared
    // pitch/cross axes + stagger `layouts/bond.js`'s own Wall-side rows already use (`axisLen`/
    // `courseHeightFor`, imported not re-derived) instead of this file's own former bare
    // `pattern==='soldier'` ternary -- soldier/stretcher keep their EXACT prior naturalWidth/pitch
    // values (confirmed: `courseHeightFor`/`axisLen` reduce to the identical two numbers for those
    // two patterns), header/stack now resolve correctly too (previously sized AS IF stretcher,
    // band-course.js's own measured defect this replaces). flemish ('course-alternating') has no
    // single pitch at all -- its own `sequence` (below) carries [L,H] instead, and `pitch` here is
    // only the FILL-FRACTION base for its own end pieces (same role every other pattern already
    // gives it), not a per-piece length.
    const naturalWidth = courseHeightFor(patternDef, L, H);
    const pitch = patternDef.kind === 'course-alternating' ? L : axisLen(patternDef.pitchAxis, L, H);
    // the course-alternating (flemish) repeat unit: stretcher-length then header-length, exactly
    // `layouts/bond.js`'s own `flemishRow` -- [L, H], JOINTS still handled separately by the
    // existing jointWidth mechanism, never baked into the sequence itself.
    const sequence = patternDef.kind === 'course-alternating' ? [L, H] : undefined;
    const staggerFrac = patternDef.staggerFrac || 0;
    const rows = Math.max(1, Math.round(band.widthIn / naturalWidth));
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
        rowSequence, forcedFStart,
      );
      bricks.push(...pieces);
      nextId = afterId;
    }
    depthSoFar += naturalWidth * rows;
  });

  return { bricks, innerPath: boundaryAtDepth(enriched, depthSoFar) };
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
