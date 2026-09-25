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
import { _parseD, _lineIntersect, _lineCircleIntersect, _arcWorldPointTangent } from './editor-expand-path.js';
import { arcCenterParam } from './path-layout.js';

const TAU = Math.PI * 2;

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
