/**
 * editor-contour-cut.js — F27 (Fred: "the scissors tool doesn't cut contour, it should"): SE16's ✂ cut tool
 * extended to the lattice CONTOUR (a rect Lattice border or Shape Lattice contour, preset or Offset-from-frame).
 *
 * FINAL RULING (Fred, after several superseded intermediate rulings — see WORK-LOG-fb-app.md's own F27 entry
 * for the full chain): a contour cut is a COLOUR BOUNDARY ONLY, never a structural one — that distinction is
 * declared as data (CUT_KIND in editor-cut-tool.js: rails/ties are 'structural', the contour is 'colour').
 * Structural (rail/tie) cuts create a genuinely separate, independently-draggable PIECE, pinned back together
 * only by an explicit Fusion Coincident. A contour cut never does that: the ring's own overall shape,
 * connectivity, and Fusion geometry are unaffected by HOW MANY times it's been cut — cutting only ever splits
 * ONE segment's own primitive into two geometrically-contiguous curves at the SAME point it was always drawn
 * through (Fred: "the geometry still needs cut in two" — each half becomes its own selectable/colourable
 * `<path>`), never moving anything, never opening/disconnecting the loop (there is no such state to reach).
 *
 * A contour is N per-segment `<path>` elements (T73/SE14b) to begin with — even BEFORE any cut — each one an L
 * or A primitive, sharing `BOUNDARY_REF_ATTR` and ordered by `CONTOUR_SEG_INDEX_ATTR`, a CLOSED loop (the last
 * segment's own end meets the first's own start). `cutAt` (editor-cut-tool.js) splits ONE segment's primitive
 * into two, sharing one point, exactly like a rail line splits — this module provides that primitive split/
 * merge math, the same way `splitLine` in editor-lattice-chains.js does for a rail; DOM/attribute bookkeeping
 * (index renumbering, segmentColors) stays in editor-cut-tool.js next to the rail cutAt/join it mirrors. Fusion
 * (editor-sketch-manifest.js's own "send as drawn" path): each contour piece, cut or not, already goes as its
 * own Slot/ArcCenterSlot entity with a Coincident at every segment boundary (a pre-existing, generic per-
 * adjacent-primitive pass, unchanged by F27) — a cut segment becoming two DOM pieces therefore already earns
 * one more Fusion entity and its own new Coincident FOR FREE, with no dedicated F27 Fusion code needed at all;
 * an ARC segment's two cut halves are two ordinary ArcCenterSlots sharing the SAME centre/radius/width, split
 * at the cut angle (Fred: "they're simply arcs sharing their center point") — the existing ArcCenterSlot entity
 * already carries its own startAngleDeg/sweepDeg, so no new "arc slot from angle a to b" primitive was needed.
 *
 * Pure geometry only — no DOM.
 */
import { _parseD } from './editor-expand-path.js';
import { arcCenterParam } from './path-layout.js';
import { arcPointAtAngle as _arcPointAt } from './editor-primitives.js'; // audit tidy-up: the one copy

/** This codebase's own established invariant for a GENERATED silhouette's own arcs (editor-shape-lattice-
 *  generator.js's own primitivesToPathD doc comment; editor-sketch-manifest.js's own header): rx===ry,
 *  phi===0, always — the contour cut tool only ever meets segments THIS generator drew. */

/** `theta`, the branch nearest `ref` (within one turn) — the standard "unwrap onto a reference" normalization,
 *  needed because `Math.atan2` alone can land a bearing on the wrong side of a wraparound (e.g. an arc
 *  crossing +-PI) relative to the primitive's own `theta1`. */
function _normalizeNear(theta, ref) {
  const twoPi = Math.PI * 2;
  let t = theta;
  while (t - ref > Math.PI) t -= twoPi;
  while (t - ref < -Math.PI) t += twoPi;
  return t;
}

/** `theta` normalized onto `prim`'s own span (`theta1` .. `theta1+dTheta`, whichever sign), then clamped to it
 *  if it still falls outside (the caller is expected to have already picked the RIGHT primitive by distance —
 *  this only resolves a point already known to be near it exactly onto the curve). */
function _clampThetaToArc(prim, theta) {
  const mid = prim.theta1 + prim.dTheta / 2;
  const t = _normalizeNear(theta, mid);
  const lo = Math.min(prim.theta1, prim.theta1 + prim.dTheta), hi = Math.max(prim.theta1, prim.theta1 + prim.dTheta);
  return Math.max(lo, Math.min(hi, t));
}

/** A contour segment's own `d` (`primitiveToPathD`'s own single-command shape: ONE `M x y` then ONE `L`/`A`,
 *  never a `Z`) -> its primitive `{type:'L',p0,p1}` / `{type:'A',cx,cy,rx,ry,phi,theta1,dTheta}`, or null for an
 *  empty/unreadable `d`. A degenerate arc (radius 0) falls back to a line — the SAME convention
 *  `_primitivesFromSubpath` (editor-lattice-boundary.js) already uses for `arcCenterParam`'s own decline. */
export function primitiveFromContourD(d) {
  const subpaths = _parseD(d);
  const sp = subpaths[0];
  if (!sp || !sp.segs.length) return null;
  const seg = sp.segs[0], p0 = sp.start;
  if (seg.cmd === 'L') return { type: 'L', p0, p1: { x: seg.x, y: seg.y } };
  if (seg.cmd === 'A') {
    const param = arcCenterParam(p0.x, p0.y, seg.rx, seg.ry, seg.rot, !!seg.largeArc, !!seg.sweep, seg.x, seg.y);
    return param ? { type: 'A', ...param } : { type: 'L', p0, p1: { x: seg.x, y: seg.y } };
  }
  return null;
}

/** The two world endpoints of a contour primitive, in its own DRAWN order (start -> end). */
export function contourPrimitiveEnds(prim) {
  if (prim.type === 'L') return [prim.p0, prim.p1];
  return [_arcPointAt(prim, prim.theta1), _arcPointAt(prim, prim.theta1 + prim.dTheta)];
}

/** The point ON `prim` nearest `pt`, and its exact distance — pure geometry; editor-cut-tool.js applies the H1
 *  GRID/GEOMETRY snap policy on top of this, exactly like a plain line (`snapOnLine`/`projectOnSegment`). */
export function nearestOnContourPrimitive(prim, pt) {
  if (prim.type === 'L') {
    const { p0: a, p1: b } = prim;
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2)) : 0;
    const x = a.x + t * dx, y = a.y + t * dy;
    return { x, y, t, d: Math.hypot(x - pt.x, y - pt.y) };
  }
  const theta = _clampThetaToArc(prim, Math.atan2(pt.y - prim.cy, pt.x - prim.cx));
  const p = _arcPointAt(prim, theta);
  return { x: p.x, y: p.y, theta, d: Math.hypot(p.x - pt.x, p.y - pt.y) };
}

/** Split `prim` (a point already ON it — `nearestOnContourPrimitive`'s own `{x,y}`) into `[first, second]`,
 *  both sharing that exact point, first : second in the primitive's own drawn direction (dTheta's sign is
 *  preserved on each half of an arc). Null for an unrecognized type (defensive; never happens for a
 *  generator-drawn segment). */
export function splitContourPrimitive(prim, p) {
  if (prim.type === 'L') {
    return [{ type: 'L', p0: { ...prim.p0 }, p1: { x: p.x, y: p.y } }, { type: 'L', p0: { x: p.x, y: p.y }, p1: { ...prim.p1 } }];
  }
  if (prim.type === 'A') {
    const theta = _clampThetaToArc(prim, Math.atan2(p.y - prim.cy, p.x - prim.cx));
    const sweep1 = theta - prim.theta1;
    return [
      { type: 'A', cx: prim.cx, cy: prim.cy, rx: prim.rx, ry: prim.ry, phi: prim.phi, theta1: prim.theta1, dTheta: sweep1 },
      { type: 'A', cx: prim.cx, cy: prim.cy, rx: prim.rx, ry: prim.ry, phi: prim.phi, theta1: theta, dTheta: prim.dTheta - sweep1 },
    ];
  }
  return null;
}

/** A DOM-facing contour segment's own `d` goes through primitiveToPathD's `_fmt` (3-decimal rounding) on every
 *  write, so two independently-rounded copies of "the same" coordinate can differ by up to that grain -- this
 *  is the realistic "still the same point/angle" floor for a Join tap, not a made-up number (MEASURED: a cut
 *  followed immediately by a Join tap at the exact same point failed at the old 1e-6 floor, off by ~5e-4). */
export const CONTOUR_JOINT_EPS = 2e-3;

/** Audit (batch 2): the decimals EVERY contour-piece write uses (scissors cut, Join, stripe). At 3 a scissors-cut
 *  arc's halves often no longer merged back (MEASURED by the audit probe: 95/200 shallow-arc cuts), so the cut
 *  read as a reshaped contour -- the lattice refilled, the shape detached, Join found no joint. At 6: 0/200. */
export const CONTOUR_D_DIGITS = 6;

/** The single primitive `a` then `b` (in that drawn order, `a`'s own end == `b`'s own start) merge back into,
 *  if they are two halves of what one cut would have produced — same type, and for a LINE the same straight
 *  direction (collinear, not just any two lines happening to share a type — a genuine corner is two DIFFERENT
 *  directions and must not merge); for an ARC the SAME circle (centre + radius + rotation) with `a`'s own end
 *  angle continuing directly into `b`'s own start angle; else null. A tap on two adjacent primitives that are
 *  NOT a cut's own two halves (a genuine shape corner, e.g. a horn meeting a shoulder arc) must not merge —
 *  Join only undoes a cut, never reshapes the contour. */
export function mergeContourPrimitives(a, b) {
  if (!a || !b || a.type !== b.type) return null;
  if (a.type === 'L') {
    const dxA = a.p1.x - a.p0.x, dyA = a.p1.y - a.p0.y, lenA = Math.hypot(dxA, dyA);
    const dxB = b.p1.x - b.p0.x, dyB = b.p1.y - b.p0.y, lenB = Math.hypot(dxB, dyB);
    if (lenA < 1e-9 || lenB < 1e-9) return null;
    // collinear AND same direction (not just the same infinite line the opposite way): the cross product of
    // the two unit directions is ~0, and their dot product is positive.
    const cross = (dxA / lenA) * (dyB / lenB) - (dyA / lenA) * (dxB / lenB);
    const dot = (dxA / lenA) * (dxB / lenB) + (dyA / lenA) * (dyB / lenB);
    if (Math.abs(cross) > 1e-3 || dot < 0.999) return null;
    return { type: 'L', p0: { ...a.p0 }, p1: { ...b.p1 } };
  }
  const same = (x, y, tol = CONTOUR_JOINT_EPS) => Math.abs(x - y) < tol;
  if (!same(a.cx, b.cx) || !same(a.cy, b.cy) || !same(a.rx, b.rx) || !same(a.ry, b.ry) || !same(a.phi, b.phi, 1e-2)) return null;
  const aEnd = a.theta1 + a.dTheta;
  // angle tolerance: CONTOUR_JOINT_EPS (a linear distance) divided by the radius, the matching ANGULAR grain
  // at this arc's own scale (a large-radius arc needs a tighter angle for the SAME positional precision).
  if (!same(_normalizeNear(aEnd, b.theta1), b.theta1, CONTOUR_JOINT_EPS / Math.max(a.rx, 1e-6) + 1e-6)) return null; // not actually contiguous
  if (Math.sign(a.dTheta || 1) !== Math.sign(b.dTheta || 1)) return null; // opposite winding: not one cut's own two halves
  return { type: 'A', cx: a.cx, cy: a.cy, rx: a.rx, ry: a.ry, phi: a.phi, theta1: a.theta1, dTheta: a.dTheta + b.dTheta };
}

/** F27 (properties-shape-lattice.js's own `detectShapeLatticeDetach`, T59): the ORDERED list of DRAWN
 *  primitives with every outstanding cut undone (repeated adjacent `mergeContourPrimitives`, left to right,
 *  until none merge any further) -- i.e. what the boundary's own primitive list would be if it had never been
 *  cut at all. That hook flags a live boundary that no longer matches its own generator's fresh output as a
 *  genuine hand-edit ("detached" from the parametric shape, `shape.source` -> 'picked', never silently
 *  overwritten again) -- a segment COUNT difference used to be an unconditional tell for that, correct before
 *  F27 (the only way the count could change was an out-of-band DOM edit) but WRONG now that a colour-boundary
 *  cut is a declared, sanctioned way for the count to differ (FINAL RULING, see this file's own header) — a
 *  cut it never actually detached the shape, and `detectShapeLatticeDetach` must not treat it as if it had (a
 *  false 'picked' would silently stop Regenerate/Shape-panel edits from reaching this boundary at all, on TOP
 *  of the Regenerate-doesn't-clear-cuts symptom that first surfaced this: live-caught by
 *  tools/repro/contour_cut_acceptance.mjs, not inferred from reading the code). No wraparound merge (last
 *  primitive against the first): a cut/join never reorders the array, only splits/removes WITHIN it, so the
 *  seam between the fresh generator's own last and first primitive is never a cut's own two halves — merging
 *  it would risk collapsing a genuine sharp corner that happens to pass the same-type/tangent test by
 *  coincidence, which no real cut sequence can produce here. */
export function collapseContourCuts(primitives) {
  const arr = primitives.slice();
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < arr.length - 1; i++) {
      const m = mergeContourPrimitives(arr[i], arr[i + 1]);
      if (m) { arr.splice(i, 2, m); merged = true; break; }
    }
  }
  return arr;
}
