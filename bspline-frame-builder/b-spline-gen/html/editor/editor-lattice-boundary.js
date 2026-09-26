/**
 * editor-lattice-boundary.js — SE13 Slice 1: the pure boundary-cutting
 * engine (SE13-BOUNDARY-LATTICE-DESIGN.md §2/§3). Line × closed-boundary
 * → the spans of that line lying INSIDE the boundary. Two pieces:
 *
 *   shapeToPrimitives(el) — turn a boundary source element (rect/circle/
 *     ellipse/polygon/path/text) into a flat list of self-contained
 *     primitives ({type:'L',p0,p1} | {type:'A',cx,cy,rx,ry,phi,theta1,
 *     dTheta} | {type:'C',p0,p1,p2,p3} | {type:'CIRCLE',cx,cy,r}), all in
 *     the element's own LOCAL frame (no world transform baked in — same
 *     contract every OUTLINE_KINDS entry already uses).
 *
 *   insideSpans(scanLine, primitives) — the actual cut: every primitive's
 *     own crossing(s) with the scan line, half-open per primitive (T39's
 *     own session first proved this pattern via T40's outer/inner join
 *     trimming; the specific half-open CONVENTION — which end is included,
 *     which excluded — is the reference site's own logic, credited in the
 *     design doc, not their style), sorted and paired even-odd (handles
 *     holes for free — no subpath-identity bookkeeping needed).
 *
 * Reuses existing primitives rather than re-deriving them: _parseD (this
 * module's own path tokenizer, editor-expand-path.js), _lineIntersect /
 * _lineCircleIntersect / _arcWorldPointTangent (same file), arcCenterParam
 * (path-layout.js). No DOM, no svg.js, no `editor` object — plain data in,
 * plain data out, same contract editor-lattice-pattern.js's own
 * computePattern already sets for this codebase's "pure" modules.
 */
import { _parseD, _lineIntersect, _lineCircleIntersect, _arcWorldPointTangent, pathOutlinePathD } from './editor-expand-path.js';
import { arcCenterParam } from './path-layout.js';
// T51 (SE13 boundary-fill fix): the Expand tool's own analytic offset
// engine, now understanding `mode:'inner'` (editor-expand-analytic.js) —
// the TRUE inward-offset boundary for a stroked boundary shape, reused
// here rather than approximating it as a per-crossing shrink (T50's own
// dead end, deleted — see shapeToInnerBoundaryPrimitives' own doc comment).
import { rectOutlinePathD, ellipseOutlinePathD } from './editor-expand-analytic.js';

const TAU = Math.PI * 2;

/** The generated silhouette's own stroke width — a small, FIXED value,
 *  deliberately NOT `editor._strokeWidth` (the general drawing tool's own
 *  CURRENT setting). Same bug class `emitSegment` (editor-lattice.js) was
 *  already fixed for once: "a live browser test found a 0.5in board-wide
 *  stroke on a 0.5in rail pitch" — found again live once, this project's
 *  own history: a 0.5in default stroke on the silhouette's own pinched
 *  waist inset the boundary's own inner-fill cut (`_effectiveContourWidth`/
 *  `edge:'inner-stroke'`, editor-lattice-pattern.js) far enough inward to
 *  leave ZERO room for any rail/tie at all — confirmed live (0 rails/0
 *  ties after Generate), not assumed from reading the code alone.
 *  T68 AMEND 1: declared HERE (a pure, DOM-free module both the app's own
 *  drawing AND the manifest producer already import from) rather than in
 *  `properties-shape-lattice.js` (which re-exports it for its own local
 *  use) — a manifest-producer module importing a constant FROM a DOM-
 *  touching properties panel would invert this codebase's own established
 *  dependency direction; this way each side genuinely reads the SAME
 *  declared number from a neutral home instead. */
export const SILHOUETTE_STROKE_WIDTH = 0.02;

/** T73 AMEND 4 (Fred, live screenshot: "these corners need to be rounded
 *  since they are slots"): every drawn contour element's own stroke
 *  style — declared HERE, ONCE (the same neutral, DOM-free home
 *  SILHOUETTE_STROKE_WIDTH/CONTOUR_SIZE_INSET_IN already use), so
 *  `regenerateSilhouette`'s own per-segment elements (properties-shape-
 *  lattice.js) and the Border clone (editor-lattice-pattern.js's own
 *  Border-piece emission — a SINGLE combined closed-loop path, unlike the
 *  per-segment elements, so its own INTERNAL joints are exactly where a
 *  default miter join would look sharp/pointed on a thick stroke) never
 *  drift into two different corner styles. `linecap` matters for the
 *  per-segment elements' own open ends (a gap between two adjacent
 *  segments, still touching, reads as a smooth round tip rather than a
 *  flat one); `linejoin` matters for the Border clone's own internal
 *  vertices — applying BOTH everywhere is harmless where one is a no-op
 *  (a lone-primitive path has no internal joint to round) and keeps this
 *  a single declared style, not "which one applies where" case analysis
 *  at each call site. */
export const CONTOUR_STROKE_STYLE = { linecap: 'round', linejoin: 'round' };

/** T71 (SE15 T69-fix-3, Fred: "W and H is good" + AMEND 13's own final
 *  margin value): the Shape Lattice contour's own overall size is the
 *  board minus a fixed 1in margin (0.5in inset per side, centred) —
 *  declared HERE for the SAME reason SILHOUETTE_STROKE_WIDTH is (a pure,
 *  DOM-free module both the app's own drawing, `properties-shape-
 *  lattice.js`'s `regenerateSilhouette`, AND the manifest producer,
 *  `editor-sketch-manifest.js`'s `buildSketchManifest`, already import
 *  from) — one declaration, two consumers, never two divergent margin
 *  numbers. */
export const CONTOUR_SIZE_INSET_IN = 0.5;

/** The board `region` ({x,y,w,h}), shrunk by CONTOUR_SIZE_INSET_IN on
 *  every side and re-centred — the ONE region BOTH the app's own drawn
 *  contour and the manifest's own contour entities must build their
 *  geometry from, so neither ever draws/declares a different size than
 *  the other (T68's own parity discipline, extended to this margin). */
export function insetRegionForContour(region) {
  return {
    x: region.x + CONTOUR_SIZE_INSET_IN,
    y: region.y + CONTOUR_SIZE_INSET_IN,
    w: region.w - 2 * CONTOUR_SIZE_INSET_IN,
    h: region.h - 2 * CONTOUR_SIZE_INSET_IN,
  };
}

/** Same plain-DOM-element adapter contract OUTLINE_KINDS' own callers use
 *  (editor-io.js's `_outlineAdapter`) — `el.attr(name)` / `el.array()` /
 *  `el.type`. Accepts either that adapter shape directly, or a live
 *  svg.js element (which already implements the same interface) — no
 *  conversion needed either way, matching how OUTLINE_KINDS itself is
 *  agnostic to which one it's handed. */

/** Turn an SVG `points` attribute ("x,y x,y ...", comma and/or whitespace
 *  separated) into a flat [[x,y],...] list — same parsing convention
 *  editor-io.js's own `_outlineAdapter.array()` already uses for
 *  polyline/polygon, duplicated here rather than imported since that one
 *  is module-private and this is a 6-line, already-proven-correct parse. */
function _pointsOf(el) {
  const raw = (el.attr('points') || '').trim();
  if (!raw) return [];
  const nums = raw.split(/[\s,]+/).filter(Boolean).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}

function _lineSeg(p0, p1) {
  return { type: 'L', p0, p1 };
}

/** One closed ring's worth of `L` primitives from a point list (rect's own
 *  4 corners, or a polygon's own vertex list) — implicitly closed (last
 *  point connects back to the first), matching SVG's own polygon/rect
 *  semantics (never open, unlike polyline, which is why polyline is NOT
 *  a supported boundary kind — a boundary needs a closed edge). */
function _ringFromPoints(pts) {
  const segs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = { x: pts[i][0], y: pts[i][1] };
    const b = { x: pts[(i + 1) % pts.length][0], y: pts[(i + 1) % pts.length][1] };
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) continue; // a degenerate repeated point — no segment to add
    segs.push(_lineSeg(a, b));
  }
  return segs;
}

/** One subpath's own `_parseD` segments -> primitives, closed whether or
 *  not the subpath carries a literal `Z`. T43's own finding (this
 *  session): SVG's fill semantics treat every subpath as implicitly
 *  closed regardless of a literal Z (opentype's own glyph contours never
 *  emit one) — a BOUNDARY is exactly a fill-rule concept ("what's
 *  inside"), so the same convention applies here, not just re-used by
 *  coincidence. A degenerate `A` (arcCenterParam returns null) falls back
 *  to a straight line — the SAME fallback `_offsetArcSeg` itself already
 *  uses for the identical case, not a new decision. */
function _primitivesFromSubpath(subpath) {
  const segs = [];
  let cur = subpath.start;
  for (const seg of subpath.segs) {
    if (seg.cmd === 'L') {
      segs.push(_lineSeg(cur, { x: seg.x, y: seg.y }));
    } else if (seg.cmd === 'C') {
      segs.push({
        type: 'C',
        p0: cur,
        p1: { x: seg.x1, y: seg.y1 },
        p2: { x: seg.x2, y: seg.y2 },
        p3: { x: seg.x, y: seg.y },
      });
    } else if (seg.cmd === 'A') {
      const param = arcCenterParam(cur.x, cur.y, seg.rx, seg.ry, seg.rot, !!seg.largeArc, !!seg.sweep, seg.x, seg.y);
      if (!param) {
        segs.push(_lineSeg(cur, { x: seg.x, y: seg.y }));
      } else {
        const { cx, cy, rx, ry, phi, theta1, dTheta } = param;
        segs.push({ type: 'A', cx, cy, rx, ry, phi, theta1, dTheta });
      }
    }
    cur = { x: seg.x, y: seg.y };
  }
  // Implicit close: connect the last point back to the subpath's own
  // start whenever it isn't already there (covers BOTH the "no literal Z"
  // case and the "has Z" case, where _parseD already appended this same
  // closing L itself — Math.hypot below is ~0 then, so nothing doubles up).
  if (Math.hypot(cur.x - subpath.start.x, cur.y - subpath.start.y) > 1e-9) {
    segs.push(_lineSeg(cur, subpath.start));
  }
  return segs;
}

/** `d` (a path/polygon/rect already reduced to one) -> ALL primitives
 *  across every subpath, flattened — `insideSpans` doesn't need subpath
 *  grouping (§2's own even-odd design: sort+pair the WHOLE crossing list,
 *  no per-subpath bookkeeping), so flattening here is the natural,
 *  smaller interface rather than pushing that decision onto the caller. */
function _primitivesFromD(d) {
  const subpaths = _parseD(d);
  const out = [];
  for (const subpath of subpaths) {
    if (!subpath.segs.length) continue;
    out.push(..._primitivesFromSubpath(subpath));
  }
  return out;
}

/**
 * A boundary source element -> its flat primitive list, LOCAL frame.
 * Async uniformly (matches OUTLINE_KINDS' own established convention,
 * editor-outline-preview.js — every entry `await`s cleanly even though
 * only `text` actually needs to) since `text` requires an async font
 * fetch (localGlyphPathD, editor-expand-text.js) that the other 5 kinds
 * never touch. Returns `[]` for an unsupported/degenerate source rather
 * than throwing — same "decline gracefully" contract every OutlinePathD
 * function in this session already uses.
 */
/** T68 AMEND 1 (advisor, measured live on the DEFAULT Shape Lattice
 *  layer): `editor-sketch-manifest.js`'s own `resolveShapeBoundaryExtent`
 *  was computing the lattice-fill's own extent from the RAW, un-inset
 *  boundary primitives, while the app's own drawing
 *  (`shapeToInnerBoundaryPrimitives` below, via `generatePattern`) insets
 *  by half the boundary's own stroke width FIRST — a real, measured
 *  divergence (extra rails at the board's own outer edge, every rail's
 *  own x-extent off by exactly the inset amount), not a hypothetical.
 *  `shapeToInnerBoundaryPrimitives`'s own 'path' case (below) is exactly
 *  "offset this d string inward, then re-parse it into primitives" — for
 *  a GENERATED preset (`manifestFromShape`'s own ONLY supported case),
 *  the drawn boundary element is ALWAYS a plain `<path>` built directly
 *  from `primitivesToPathD`'s own output (`regenerateSilhouette`), so
 *  this exact 2-step computation applies with no DOM needed at all (no
 *  rect/ellipse/polygon/text dispatch to make, unlike the general case
 *  below). Extracted here as its own pure, exported function so BOTH the
 *  live-DOM path (`shapeToInnerBoundaryPrimitives`'s own 'path' branch)
 *  and the manifest producer call the IDENTICAL implementation — the
 *  advisor's own fix instruction, "one function... never two
 *  computations" — rather than two independently-written copies of the
 *  same offset-then-reparse steps that could silently drift apart again. */
export function insetPathDToPrimitives(d, strokeHalfWidth) {
  if (!strokeHalfWidth || strokeHalfWidth <= 0) return _primitivesFromD(d);
  const innerD = pathOutlinePathD(d, strokeHalfWidth * 2, { mode: 'inner' }).d;
  return innerD ? _primitivesFromD(innerD) : [];
}

/** T72 (bug: the default Bottle preset generated 0 rails/ties after T71's
 *  own contour-size inset): `insetPathDToPrimitives` above declines to `[]`
 *  on a collapsed inner ring (self-intersection, or "thinner than
 *  strokeWidth somewhere" — pathOutlinePathD's own T51 doc comment), and
 *  BOTH its callers' own onward math treats an EMPTY inset boundary
 *  exactly like a genuinely degenerate shape (an empty primitive list
 *  bboxes to null), silently discarding the WHOLE lattice fill — the
 *  CORRECT, deliberate behavior for a hand-picked boundary (a real thin
 *  arm the user actually drew; using the raw, un-inset edge there would
 *  put rails ON TOP of the drawn stroke — `editor-lattice-boundary.test.js`
 *  own "the WHOLE shape declines... not a local trim" case documents
 *  exactly this), but the WRONG one for a GENERATED preset silhouette:
 *  measured live, Bottle's own near-zero-radius neck fillet self-
 *  intersects at this half-stroke inset amount once the overall contour
 *  shrinks by T71's own margin, even though the rest of the shape's own
 *  interior offsets fine — a numerical artifact of curve-fitting math, not
 *  a feature the user actually drew thin on purpose. This wrapper is for
 *  that ONE narrower, generated-preset-only case: fall back to the RAW
 *  (un-inset) boundary, the direct analog of `_closedSubpathD`'s own
 *  'both'-mode fallback ("collapsed — drop the inner ring, don't emit a
 *  bowtie", returning `outer.d` instead of nothing). Never call this for a
 *  hand-picked boundary shape — that path keeps calling
 *  `insetPathDToPrimitives` directly, unchanged. */
export function insetGeneratedPresetPathDToPrimitives(d, strokeHalfWidth) {
  const inset = insetPathDToPrimitives(d, strokeHalfWidth);
  return inset.length ? inset : _primitivesFromD(d);
}

export async function shapeToPrimitives(el) {
  const type = el.type;
  if (type === 'rect') {
    const x = parseFloat(el.attr('x')) || 0;
    const y = parseFloat(el.attr('y')) || 0;
    const w = parseFloat(el.attr('width')) || 0;
    const h = parseFloat(el.attr('height')) || 0;
    if (w <= 0 || h <= 0) return [];
    return _ringFromPoints([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  }
  if (type === 'circle') {
    const cx = parseFloat(el.attr('cx')) || 0;
    const cy = parseFloat(el.attr('cy')) || 0;
    const r = parseFloat(el.attr('r')) || 0;
    if (r <= 0) return [];
    return [{ type: 'CIRCLE', cx, cy, r }];
  }
  if (type === 'ellipse') {
    const cx = parseFloat(el.attr('cx')) || 0;
    const cy = parseFloat(el.attr('cy')) || 0;
    const rx = parseFloat(el.attr('rx')) || 0;
    const ry = parseFloat(el.attr('ry')) || 0;
    if (rx <= 0 || ry <= 0) return [];
    // An ellipse boundary, expressed as a single A-shaped primitive
    // (theta1=0, dTheta=TAU) reusing the SAME dispatch insideSpans already
    // has for A: rx===ry (a degenerate ellipse == circle) gets the exact
    // closed-form circular-arc path; rx!==ry (the real ellipse case, most
    // of them) goes through insideSpans' own numeric branch — a genuine
    // quadratic closed-form solve for the unrotated case IS possible
    // (line x ellipse reduces to one) but wasn't built this slice: the
    // numeric path already handles it correctly and well under tolerance
    // (verified below), and building a second exact solver just for this
    // one sub-case, when the general numeric path already covers it
    // robustly, would be untested surface area for marginal benefit —
    // not "exact where declared," just declared exact prematurely. Named
    // here so a future reader doesn't assume this IS closed-form from an
    // earlier draft of this comment (it briefly claimed that, wrongly).
    return [{ type: 'A', cx, cy, rx, ry, phi: 0, theta1: 0, dTheta: TAU }];
  }
  if (type === 'polygon') {
    return _ringFromPoints(_pointsOf(el));
  }
  if (type === 'path') {
    return _primitivesFromD(el.attr('d') || '');
  }
  if (type === 'text') {
    const { localGlyphPathD } = await import('./editor-expand-text.js');
    const glyphD = await localGlyphPathD(el);
    if (!glyphD) return [];
    return _primitivesFromD(glyphD);
  }
  return []; // polyline (never closed) and any other kind: not a valid boundary
}

/** An SVG `points` list -> a closed `M x0 y0 L x1 y1 ... Z` path string —
 *  what `pathOutlinePathD` (a `d`-string-in API) needs from a polygon,
 *  which `shapeToPrimitives` itself never has to build (it goes straight
 *  to primitives via `_ringFromPoints`). */
function _ringD(pts) {
  const [first, ...rest] = pts;
  return `M ${first[0]} ${first[1]} ${rest.map((p) => `L ${p[0]} ${p[1]}`).join(' ')} Z`;
}

/**
 * T51 (SE13 boundary-fill fix, advisor review of T50): a boundary source
 * element's own TRUE INWARD-OFFSET boundary — `d`, or `null` if it
 * collapses (the stroke swallows the whole shape, or every subpath of a
 * multi-subpath source does) — reusing the SAME analytic/biarc offset
 * engine the Expand tool already built (`rectOutlinePathD`/
 * `ellipseOutlinePathD`/`pathOutlinePathD`, now understanding
 * `mode:'inner'`) rather than a second offsetting implementation. NOT
 * called for `circle` — see `shapeToInnerBoundaryPrimitives`'s own
 * special-case comment for why. `strokeHalfWidth` is in the SAME
 * local-frame units as the element's own geometry (world-space inches,
 * once the caller bakes the element's transform — same split
 * `shapeToPrimitives` itself uses).
 */
async function _innerRingD(el, half) {
  const type = el.type;
  const strokeWidth = half * 2;
  if (type === 'rect') {
    const x = parseFloat(el.attr('x')) || 0;
    const y = parseFloat(el.attr('y')) || 0;
    const w = parseFloat(el.attr('width')) || 0;
    const h = parseFloat(el.attr('height')) || 0;
    if (w <= 0 || h <= 0) return null;
    return rectOutlinePathD({ x, y, width: w, height: h, strokeWidth, mode: 'inner' }).d;
  }
  if (type === 'ellipse') {
    const cx = parseFloat(el.attr('cx')) || 0;
    const cy = parseFloat(el.attr('cy')) || 0;
    const rx = parseFloat(el.attr('rx')) || 0;
    const ry = parseFloat(el.attr('ry')) || 0;
    if (rx <= 0 || ry <= 0) return null;
    return ellipseOutlinePathD({ cx, cy, rx, ry, strokeWidth, mode: 'inner' }).d;
  }
  if (type === 'polygon') {
    const pts = _pointsOf(el);
    if (pts.length < 3) return null;
    return pathOutlinePathD(_ringD(pts), strokeWidth, { mode: 'inner' }).d;
  }
  if (type === 'path') {
    return pathOutlinePathD(el.attr('d') || '', strokeWidth, { mode: 'inner' }).d;
  }
  if (type === 'text') {
    const { localGlyphPathD } = await import('./editor-expand-text.js');
    const glyphD = await localGlyphPathD(el);
    if (!glyphD) return null;
    return pathOutlinePathD(glyphD, strokeWidth, { mode: 'inner' }).d;
  }
  return null; // polyline etc: not a valid boundary kind (matches shapeToPrimitives)
}

/**
 * Like `shapeToPrimitives`, but cuts against the shape's own TRUE
 * inward-offset boundary instead of its raw edge — the fix for T50's own
 * dead end (a per-crossing scan-direction shrink that only happened to be
 * exact at a circle's own center row, letting rails survive INSIDE the
 * stroke band elsewhere — see WORK-LOG-lane-b.md, T51). `strokeHalfWidth
 * <= 0` (an unstroked boundary, or `boundary.edge==='centerline'`)
 * delegates straight to `shapeToPrimitives` — no offset to apply, and no
 * reason to route through the offset engine at all. A collapsed inner
 * ring (stroke swallows the shape, or a thin feature swallows just its
 * own region — see `pathOutlinePathD`'s own T51 doc comment for the
 * "whole subpath, not a local trim" scope of that collapse) returns `[]`,
 * same "declined gracefully" convention as everywhere else in this file.
 */
export async function shapeToInnerBoundaryPrimitives(el, strokeHalfWidth) {
  if (!strokeHalfWidth || strokeHalfWidth <= 0) return shapeToPrimitives(el);
  // A circle's own inner offset is a smaller CONCENTRIC CIRCLE, exactly —
  // built directly rather than routed through circleOutlinePathD's own
  // `d`-string (2 semicircle `A` commands meeting at the LEFT/RIGHT
  // poles) and back through `_parseD`/`arcCenterParam`. Found live (not
  // assumed): `arcCenterParam`'s own endpoint->center reconstruction is
  // not bit-exact (an inverse trig/sqrt computation), landing each arc's
  // own reconstructed center ~1e-8 off the true one — for a scan line at
  // EXACTLY y=cy (the poles' own shared y, and exactly where a rail is
  // likely to land for a grid-centered circle), that tiny asymmetry
  // pushed BOTH poles' own half-open `t` just past their own inclusion
  // boundary, silently producing a ZERO-span row through the shape's own
  // widest, most visible diameter — a regression this test file's own
  // "THE T50 REGRESSION ITSELF" case would not have caught (it checks a
  // row BEYOND the inner radius, not exactly AT the center). The single-
  // primitive `type:'CIRCLE'` path (`insideSpans`' own `_crossCircle`)
  // has no seam and no such reconstruction step, so it has no such error
  // to trigger in the first place.
  if (el.type === 'circle') {
    const cx = parseFloat(el.attr('cx')) || 0;
    const cy = parseFloat(el.attr('cy')) || 0;
    const r = parseFloat(el.attr('r')) || 0;
    if (r <= 0) return [];
    const innerR = r - strokeHalfWidth;
    return innerR > 1e-9 ? [{ type: 'CIRCLE', cx, cy, r: innerR }] : [];
  }
  // T68 AMEND 1: routes through the SAME shared `insetPathDToPrimitives`
  // the manifest producer now calls directly, rather than the generic
  // `_innerRingD` + `_primitivesFromD` two-step — identical result for
  // 'path' (the only type a generated Shape Lattice preset ever draws),
  // now genuinely ONE implementation instead of two that happened to
  // agree.
  if (el.type === 'path') {
    return insetPathDToPrimitives(el.attr('d') || '', strokeHalfWidth);
  }
  const innerD = await _innerRingD(el, strokeHalfWidth);
  return innerD ? _primitivesFromD(innerD) : [];
}

/** The primitive's own two ends, in "low"/"high" scan-parameter order —
 *  the half-open rule's whole job is knowing which one to EXCLUDE so a
 *  vertex shared by two adjacent primitives is counted exactly once.
 *  `dTheta`'s sign already encodes an arc's own low->high travel
 *  direction; a line/cubic's own t=0..1 is already low->high by
 *  construction (t IS the "low" parameter, t=1 the "high" one to
 *  exclude) — nothing to normalize there. */

/** Circle/full-ellipse-as-A: every crossing is valid, no shared-vertex
 *  concern at all (a full circle/ellipse is its own complete loop, no
 *  neighbor to double-count against). */
function _crossCircle(scanPoint, scanDir, cx, cy, r, out) {
  for (const p of _lineCircleIntersect(scanPoint, scanDir, { x: cx, y: cy }, r)) {
    out.push(_alongScan(scanPoint, scanDir, p));
  }
}

function _alongScan(scanPoint, scanDir, p) {
  return (p.x - scanPoint.x) * scanDir.x + (p.y - scanPoint.y) * scanDir.y;
}

/** Exact L crossing, half-open at the segment's own t=1 (its "high" end —
 *  excluded so the NEXT segment's own t=0 at the same shared vertex is
 *  the one that reports it). */
function _crossLine(scanPoint, scanDir, seg, out) {
  const dx = seg.p1.x - seg.p0.x, dy = seg.p1.y - seg.p0.y;
  const hits = _lineIntersect(seg.p0, { x: dx, y: dy }, scanPoint, scanDir);
  if (!hits.length) return;
  const p = hits[0];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-18) return; // degenerate zero-length segment, already filtered by _ringFromPoints for polygons, but a path could still carry one
  const t = ((p.x - seg.p0.x) * dx + (p.y - seg.p0.y) * dy) / lenSq;
  if (t < -1e-9 || t >= 1 - 1e-9) return; // half-open: [0,1)
  out.push(_alongScan(scanPoint, scanDir, p));
}

/** Exact circular-arc crossing (rx===ry, `dTheta` finite): every full-
 *  circle intersection point, kept only if its own angle falls within
 *  [theta1, theta1+dTheta) — half-open at the arc's own end, same reason
 *  as the line case. */
function _crossCircularArc(scanPoint, scanDir, arc, out) {
  for (const p of _lineCircleIntersect(scanPoint, scanDir, { x: arc.cx, y: arc.cy }, arc.rx)) {
    const dx = p.x - arc.cx, dy = p.y - arc.cy;
    const cosPhi = Math.cos(arc.phi), sinPhi = Math.sin(arc.phi);
    const lx = cosPhi * dx + sinPhi * dy, ly = -sinPhi * dx + cosPhi * dy;
    let theta = Math.atan2(ly, lx); // rx===ry here, no per-axis rescale needed
    let delta = theta - arc.theta1;
    if (arc.dTheta >= 0) {
      while (delta < 0) delta += TAU;
      while (delta >= TAU) delta -= TAU;
    } else {
      while (delta > 0) delta -= TAU;
      while (delta <= -TAU) delta += TAU;
    }
    const t = delta / arc.dTheta;
    if (t < -1e-9 || t >= 1 - 1e-9) continue;
    out.push(_alongScan(scanPoint, scanDir, p));
  }
}

/** Signed distance of a world point from the scan line, along the scan
 *  line's own NORMAL — the scan line itself is where this is exactly 0.
 *  General on purpose (doesn't assume horizontal/vertical) so the SAME
 *  numeric root-finder below serves both rails and ties with no
 *  axis-specific branch. */
function _signedDistFromScan(scanPoint, scanNormal, p) {
  return (p.x - scanPoint.x) * scanNormal.x + (p.y - scanPoint.y) * scanNormal.y;
}

/** Numeric crossings of a general curve (cubic OR elliptical/rotated arc)
 *  against the scan line: sample `f(t) = signed distance from scan line`
 *  densely, bisect every sign-changing bracket to well under the
 *  dispatch's own 1e-6 target. Robust (always converges given a real
 *  bracket, no derivative, no risk of a Newton step diverging near an
 *  inflection) — the advisor's own ruling on this design's Q4 made this
 *  the PRIMARY path for a pen/freehand boundary, not a rare fallback, so
 *  correctness/robustness was weighted over raw speed. */
function _numericCrossings(scanPoint, scanDir, pointAt, out, samples = 64) {
  const scanNormal = { x: -scanDir.y, y: scanDir.x };
  const f = (t) => _signedDistFromScan(scanPoint, scanNormal, pointAt(t));
  let prevT = 0, prevF = f(0);
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const fv = f(t);
    if (prevF === 0) {
      // landed exactly on a sample boundary -- treat prevT as a root (half-open handled by the caller below)
      out.push({ t: prevT, point: pointAt(prevT) });
    } else if ((prevF < 0) !== (fv < 0)) {
      let lo = prevT, hi = t, flo = prevF;
      for (let k = 0; k < 40; k++) { // 40 bisections: well past double-precision's own useful limit
        const mid = (lo + hi) / 2, fm = f(mid);
        if (fm === 0 || (hi - lo) < 1e-9) { lo = hi = mid; break; }
        if ((flo < 0) === (fm < 0)) { lo = mid; flo = fm; } else { hi = mid; }
      }
      const rt = (lo + hi) / 2;
      out.push({ t: rt, point: pointAt(rt) });
    }
    prevT = t; prevF = fv;
  }
}

function _cubicPointAt(seg) {
  return (t) => {
    const u = 1 - t;
    return {
      x: u * u * u * seg.p0.x + 3 * u * u * t * seg.p1.x + 3 * u * t * t * seg.p2.x + t * t * t * seg.p3.x,
      y: u * u * u * seg.p0.y + 3 * u * u * t * seg.p1.y + 3 * u * t * t * seg.p2.y + t * t * t * seg.p3.y,
    };
  };
}

function _ellipticalArcPointAt(arc) {
  return (tNorm) => _arcWorldPointTangent(arc.cx, arc.cy, arc.rx, arc.ry, arc.phi, arc.theta1 + tNorm * arc.dTheta).point;
}

/**
 * `scanLine`: `{point:{x,y}, dir:{x,y}}`, `dir` a UNIT vector (horizontal
 * rail at y=Y: `{point:{x:0,y:Y}, dir:{x:1,y:0}}`; vertical tie at x=X:
 * `{point:{x:X,y:0}, dir:{x:0,y:1}}`). Returns sorted `[lo,hi]` pairs —
 * the "along the scan line" coordinate (for the horizontal-rail example
 * above, that IS world x directly, since `point.x=0` and `dir=(1,0)`).
 */
export function insideSpans(scanLine, primitives) {
  const { point, dir } = scanLine;
  const crossings = [];
  for (const prim of primitives) {
    if (prim.type === 'CIRCLE') {
      _crossCircle(point, dir, prim.cx, prim.cy, prim.r, crossings);
    } else if (prim.type === 'L') {
      _crossLine(point, dir, prim, crossings);
    } else if (prim.type === 'A') {
      const isCircular = Math.abs(prim.rx - prim.ry) < 1e-6 * Math.max(prim.rx, prim.ry, 1);
      if (isCircular) {
        _crossCircularArc(point, dir, prim, crossings);
      } else {
        const hits = [];
        _numericCrossings(point, dir, _ellipticalArcPointAt(prim), hits);
        for (const h of hits) if (h.t >= -1e-9 && h.t < 1 - 1e-9) crossings.push(_alongScan(point, dir, h.point));
      }
    } else if (prim.type === 'C') {
      const hits = [];
      _numericCrossings(point, dir, _cubicPointAt(prim), hits);
      for (const h of hits) if (h.t >= -1e-9 && h.t < 1 - 1e-9) crossings.push(_alongScan(point, dir, h.point));
    }
  }
  crossings.sort((a, b) => a - b);
  const spans = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const lo = crossings[i], hi = crossings[i + 1];
    if (hi - lo > 1e-9) spans.push([lo, hi]); // drop zero-length (tangent) spans
  }
  return spans;
}

/**
 * T73 AMEND 3 (Fred: "I need rails to coincide to contour") — the
 * attribution `insideSpans` above deliberately doesn't do: given a WORLD
 * point already known to sit ON some primitive in the list (a rail/tie
 * end computed via the SAME 'on-boundary' endRule this amend introduced),
 * find WHICH one, and whether the point is essentially at that
 * primitive's own start/end (`'S'`/`'E'`) or genuinely mid-primitive
 * (`null`) — the exact distinction `manifestFromLattice`'s own Coincident
 * emission needs (point-to-point at a joint, point-on-curve mid-span,
 * same "3-way end/mid-span/none" shape `pieceEndOrCurveTarget`,
 * editor-sketch-manifest.js, already establishes for rail/tie/node
 * relations — this is that SAME distinction, for a contour primitive
 * instead of a lattice-grid piece). Only 'L' and 'A' are handled: every
 * preset this module's own callers ever hand it is built exclusively from
 * those two (this file's own header, T58's own established invariant),
 * and 'A' is always a true circular arc here (rx===ry, phi===0 — the SAME
 * invariant `manifestFromShape`'s own ArcCenter emission already leans
 * on), so a plain radius/angle-sweep check is exact, not an approximation
 * this file otherwise reserves for elliptical/cubic curves. Returns
 * `{index, end, tangent}` for the FIRST matching primitive within `tol`
 * (`tangent` a UNIT vector along the primitive AT that point — a line's
 * own constant direction, or an arc's radius rotated 90° the sweep's own
 * way — T73 AMEND 3b's own near-tangent-graze check needs this: the angle
 * between a rail/tie's own direction and the contour's own tangent right
 * where they meet), or `null` if the point isn't on anything (shouldn't
 * happen for a genuine `insideSpans`-derived crossing, but a caller with a
 * stale/mismatched primitive list should get a clean miss, not a wrong
 * answer).
 */
export function primitiveHitAt(pt, primitives, tol) {
  for (let i = 0; i < primitives.length; i++) {
    const prim = primitives[i];
    if (prim.type === 'L') {
      const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const t = Math.max(0, Math.min(1, ((pt.x - prim.p0.x) * dx + (pt.y - prim.p0.y) * dy) / (len * len)));
      const projX = prim.p0.x + t * dx, projY = prim.p0.y + t * dy;
      if (Math.hypot(pt.x - projX, pt.y - projY) > tol) continue;
      const along = t * len;
      return { index: i, end: along <= tol ? 'S' : (along >= len - tol ? 'E' : null), tangent: { x: dx / len, y: dy / len } };
    }
    if (prim.type === 'A') {
      if (Math.abs(Math.hypot(pt.x - prim.cx, pt.y - prim.cy) - prim.rx) > tol) continue;
      const TAU = Math.PI * 2;
      const rawTheta = Math.atan2(pt.y - prim.cy, pt.x - prim.cx);
      const theta = (((rawTheta - prim.theta1) % TAU) + TAU) % TAU;
      const sweep = prim.dTheta;
      const sweepAbs = Math.abs(sweep);
      const traveled = sweep >= 0 ? theta : ((TAU - theta) % TAU);
      const angTol = tol / Math.max(prim.rx, 1e-6);
      if (traveled > sweepAbs + angTol) continue;
      // d/dθ of (cx + r·cosθ, cy + r·sinθ) is r·(-sinθ, cosθ) — the CCW
      // tangent; a CW sweep (dTheta<0) travels the opposite way.
      const dir = sweep >= 0 ? 1 : -1;
      const tangent = { x: -Math.sin(rawTheta) * dir, y: Math.cos(rawTheta) * dir };
      return { index: i, end: traveled <= angTol ? 'S' : (traveled >= sweepAbs - angTol ? 'E' : null), tangent };
    }
  }
  return null;
}

/**
 * T48 (SE13 Slice 2): a conservative axis-aligned bounding box over a
 * primitive list — the cheap pre-filter `editor-lattice-pattern.js`'s own
 * boundary branch needs ("compute insideSpans only for rows/columns whose
 * lattice cell range overlaps the boundary's own bbox", §4). Deliberately
 * LOOSE, never tight, for the two curved kinds: a cubic's true extrema
 * aren't computed (its 4 control points bound it via the convex-hull
 * property, so min/max over them is always a valid, if sometimes slightly
 * wider, box) and a rotated/elliptical arc uses the full circle of radius
 * max(rx,ry) about its own center (every point on ANY ellipse is within
 * max(rx,ry) of its center, regardless of phi or the arc's own sweep) —
 * a pre-filter only needs to never EXCLUDE a row/column that has real
 * geometry; a few extra empty rows/columns checked and discarded cost
 * nothing observable. Returns `null` for an empty primitive list (the
 * degenerate/no-boundary case `computePattern`'s caller already declines
 * gracefully for, same convention as `insideSpans` returning `[]`).
 */
export function primitivesBBox(primitives) {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  const consider = (x, y) => {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  };
  for (const prim of primitives) {
    if (prim.type === 'L') {
      consider(prim.p0.x, prim.p0.y);
      consider(prim.p1.x, prim.p1.y);
    } else if (prim.type === 'C') {
      consider(prim.p0.x, prim.p0.y);
      consider(prim.p1.x, prim.p1.y);
      consider(prim.p2.x, prim.p2.y);
      consider(prim.p3.x, prim.p3.y);
    } else if (prim.type === 'CIRCLE') {
      consider(prim.cx - prim.r, prim.cy - prim.r);
      consider(prim.cx + prim.r, prim.cy + prim.r);
    } else if (prim.type === 'A') {
      const R = Math.max(prim.rx, prim.ry);
      consider(prim.cx - R, prim.cy - R);
      consider(prim.cx + R, prim.cy + R);
    }
  }
  if (xMin > xMax) return null; // no primitives considered -- empty/degenerate
  return { xMin, yMin, xMax, yMax };
}

/**
 * T49 (SE13 Slice 3, "fix first"): a scan line exactly COLLINEAR with a
 * boundary edge — not just crossing it, lying exactly ON it (a snapped
 * rect/polygon boundary, Snap being on by default, routinely has an edge
 * on an exact grid row/column). `_lineIntersect`'s own parallel guard
 * (`Math.abs(denom) < 1e-9`) already reports zero crossings for that edge
 * — correct for the general "is this line segment merely PARALLEL"
 * question `insideSpans` asks, but it silently drops the edge from the
 * inside/outside computation entirely rather than answering "the edge IS
 * the boundary here." `insideSpans` itself is left untouched (already
 * reviewed, tested, independently parity-checked by the advisor) — this
 * is a SEPARATE, additive query the caller (`editor-lattice-pattern.js`)
 * unions in on top of `insideSpans`' own result, per the declared product
 * rule: a collinear edge yields a span along itself (the edge row is
 * kept), UNLESS the boundary is DRAWN separately (the Border piece) —
 * that gating is the caller's own decision, not this function's.
 *
 * Only `L` primitives are considered: a curve can be TANGENT to a scan
 * line at a single point (already a legitimate zero-length span,
 * correctly dropped by `insideSpans` itself) but "runs collinear with it
 * over a whole span" is a straight-edge-only degeneracy.
 */
export function collinearSpans(scanLine, primitives) {
  const { point, dir } = scanLine;
  const raw = [];
  for (const prim of primitives) {
    if (prim.type !== 'L') continue;
    if (!_onScanLine(point, dir, prim.p0) || !_onScanLine(point, dir, prim.p1)) continue;
    const t0 = _alongScan(point, dir, prim.p0);
    const t1 = _alongScan(point, dir, prim.p1);
    const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
    if (hi - lo > 1e-9) raw.push([lo, hi]);
  }
  if (!raw.length) return [];
  raw.sort((a, b) => a[0] - b[0]);
  const merged = [raw[0].slice()];
  for (let i = 1; i < raw.length; i++) {
    const last = merged[merged.length - 1];
    if (raw[i][0] <= last[1] + 1e-9) last[1] = Math.max(last[1], raw[i][1]);
    else merged.push(raw[i].slice());
  }
  return merged;
}

/** Is world point `p` on the scan line's own infinite extension (not just
 *  parallel to it, but the SAME line)? Cross-product of (p - scanPoint)
 *  against the unit direction `dir` is exactly 0 only on the line itself. */
function _onScanLine(scanPoint, dir, p) {
  const dx = p.x - scanPoint.x, dy = p.y - scanPoint.y;
  return Math.abs(dx * dir.y - dy * dir.x) < 1e-7;
}
