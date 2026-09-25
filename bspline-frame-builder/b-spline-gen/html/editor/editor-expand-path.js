/**
 * editor-expand-path.js — SE12 T39: the deferred piece named in T38's own
 * WORK-LOG twice (checkpoint 1 for polyline/polygon, checkpoint 2 for a
 * generic multi-segment 'path' kind) — one general
 * `pathOutlinePathD(d, strokeWidth, {mode, cap, join, tolerance})` that
 * walks ANY absolute SVG path (after normalizing relative/H/V/S/T/Q here)
 * segment by segment, offsetting each one with the exact/analytic/biarc-fit
 * tool this session already built for it (line -> lineOutlinePathD's own
 * math; circular A -> concentric A, exact; elliptical A and C -> the T38
 * biarc fitter, fitOffsetWithBiarcs), then stitches the offset pieces back
 * together with real joins at every vertex.
 *
 * Joins (Fred's own spec): at a vertex, exactly ONE of the two offset banks
 * is on the OUTER (convex) side of that turn — it gets a round join (a true
 * `A`, radius = strokeWidth/2, centered on the vertex). The OTHER bank is on
 * the INNER (concave) side — the two offset pieces there would otherwise
 * overlap in a small loop, so instead they're TRIMMED to their own
 * intersection point (a local line-line miter, using each piece's own
 * tangent at the vertex) rather than emitting the loop. A tangent-
 * continuous (smooth) vertex needs neither — the two pieces already meet.
 *
 * Open subpath -> a single capsule: left bank + end cap + right bank
 * (reversed) + start cap, same shape lineOutlinePathD's own 2-arc capsule
 * generalizes to N segments. Closed subpath -> outer ring + inner ring
 * (evenodd), with a GLOBAL collapse check (does the inner ring's own
 * winding come out backwards, or vanish to ~0 area, relative to the outer
 * ring? — the general form of "if w >= min side the inner ring vanishes"
 * circleOutlinePathD/rectOutlinePathD/ellipseOutlinePathD each already use
 * their own shape-specific version of) rather than trying to patch
 * individual self-intersecting vertices.
 *
 * Every sign in here (which side is outer at a turn, the round join's own
 * sweep flag, which offset side is "outward" for a closed ring) is the same
 * class of thing T34/T35/T38 each got wrong at least once by trusting
 * derivation alone — each is pinned down by a concrete worked example in
 * this file's own comments AND cross-checked by this module's tests against
 * real sampled geometry, not assumed correct because the algebra looks
 * right.
 */
import { arcCenterParam } from './path-layout.js';
import { fitOffsetWithBiarcs } from './editor-expand-biarc.js';
import { SUPPORTED_LINE_CAPS, _cubicPointTangentCurvature, _cubicOffsetPoint } from './editor-expand-analytic.js';

/** Absolute-only segment shapes this module works with internally, after
 *  `_parseD` has normalized away relative commands, H/V, and S/T/Q (S/T
 *  resolved via the standard reflected-control-point construction, Q
 *  elevated to C EXACTLY: C1 = P0 + 2/3(Q-P0), C2 = P2 + 2/3(Q-P2) — the
 *  same identity every renderer uses, not an approximation): only
 *  `{cmd:'L',x,y}`, `{cmd:'A',rx,ry,rot,largeArc,sweep,x,y}` (rot in
 *  DEGREES, matching arcCenterParam's own `phiDeg` convention) and
 *  `{cmd:'C',x1,y1,x2,y2,x,y}` remain. */
const NUMBER_RE = /[-+]?(?:\d+\.\d+|\.\d+|\d+)(?:[eE][-+]?\d+)?/y;

function _parseD(d) {
  const s = String(d || '').trim();
  let i = 0;

  function skipSep() { while (i < s.length && /[\s,]/.test(s[i])) i++; }
  function readNum() {
    skipSep();
    NUMBER_RE.lastIndex = i;
    const m = NUMBER_RE.exec(s);
    if (!m) throw new Error(`bad path data at ${i}: "${s.slice(i, i + 10)}"`);
    i = NUMBER_RE.lastIndex;
    return parseFloat(m[0]);
  }
  function readFlag() {
    skipSep();
    const c = s[i];
    if (c !== '0' && c !== '1') throw new Error(`bad arc flag at ${i}: "${s.slice(i, i + 10)}"`);
    i++;
    return c === '1' ? 1 : 0;
  }

  const CMD_RE = /[MLHVCSQTAZmlhvcsqtaz]/;
  const subpaths = [];
  let cur = null;
  let curX = 0, curY = 0, startX = 0, startY = 0;
  let prevCmd = null, prevCtrl = null; // for S/T reflection

  const closeIfOpen = () => {
    if (!cur) return;
    if (Math.hypot(curX - startX, curY - startY) > 1e-9) {
      cur.segs.push({ cmd: 'L', x: startX, y: startY });
    }
    cur.closed = true;
    curX = startX; curY = startY;
  };

  while (i < s.length) {
    skipSep();
    if (i >= s.length) break;
    const ch = s[i];
    let cmd;
    if (CMD_RE.test(ch)) { cmd = ch; i++; }
    else if (prevCmd) { cmd = prevCmd === 'M' ? 'L' : prevCmd; } // implicit repeat
    else throw new Error('path data must start with M/m');

    const isRel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();

    if (C === 'M') {
      const x = readNum(), y = readNum();
      curX = isRel ? curX + x : x; curY = isRel ? curY + y : y;
      if (cur) subpaths.push(cur);
      cur = { closed: false, start: { x: curX, y: curY }, segs: [] };
      startX = curX; startY = curY;
      prevCmd = 'M'; prevCtrl = null;
    } else if (C === 'L') {
      const x = readNum(), y = readNum();
      curX = isRel ? curX + x : x; curY = isRel ? curY + y : y;
      cur.segs.push({ cmd: 'L', x: curX, y: curY });
      prevCmd = cmd; prevCtrl = null;
    } else if (C === 'H') {
      const x = readNum();
      curX = isRel ? curX + x : x;
      cur.segs.push({ cmd: 'L', x: curX, y: curY });
      prevCmd = cmd; prevCtrl = null;
    } else if (C === 'V') {
      const y = readNum();
      curY = isRel ? curY + y : y;
      cur.segs.push({ cmd: 'L', x: curX, y: curY });
      prevCmd = cmd; prevCtrl = null;
    } else if (C === 'C') {
      const x1 = readNum(), y1 = readNum(), x2 = readNum(), y2 = readNum(), x = readNum(), y = readNum();
      const X1 = isRel ? curX + x1 : x1, Y1 = isRel ? curY + y1 : y1;
      const X2 = isRel ? curX + x2 : x2, Y2 = isRel ? curY + y2 : y2;
      const X = isRel ? curX + x : x, Y = isRel ? curY + y : y;
      cur.segs.push({ cmd: 'C', x1: X1, y1: Y1, x2: X2, y2: Y2, x: X, y: Y });
      prevCtrl = { x: X2, y: Y2 }; curX = X; curY = Y; prevCmd = cmd;
    } else if (C === 'S') {
      const x2 = readNum(), y2 = readNum(), x = readNum(), y = readNum();
      const X2 = isRel ? curX + x2 : x2, Y2 = isRel ? curY + y2 : y2;
      const X = isRel ? curX + x : x, Y = isRel ? curY + y : y;
      const prevWasCubic = prevCmd && (prevCmd.toUpperCase() === 'C' || prevCmd.toUpperCase() === 'S') && prevCtrl;
      const c1 = prevWasCubic ? { x: 2 * curX - prevCtrl.x, y: 2 * curY - prevCtrl.y } : { x: curX, y: curY };
      cur.segs.push({ cmd: 'C', x1: c1.x, y1: c1.y, x2: X2, y2: Y2, x: X, y: Y });
      prevCtrl = { x: X2, y: Y2 }; curX = X; curY = Y; prevCmd = cmd;
    } else if (C === 'Q') {
      const x1 = readNum(), y1 = readNum(), x = readNum(), y = readNum();
      const X1 = isRel ? curX + x1 : x1, Y1 = isRel ? curY + y1 : y1;
      const X = isRel ? curX + x : x, Y = isRel ? curY + y : y;
      const c1 = { x: curX + (2 / 3) * (X1 - curX), y: curY + (2 / 3) * (Y1 - curY) };
      const c2 = { x: X + (2 / 3) * (X1 - X), y: Y + (2 / 3) * (Y1 - Y) };
      cur.segs.push({ cmd: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: X, y: Y });
      prevCtrl = { x: X1, y: Y1 }; curX = X; curY = Y; prevCmd = cmd;
    } else if (C === 'T') {
      const x = readNum(), y = readNum();
      const X = isRel ? curX + x : x, Y = isRel ? curY + y : y;
      const prevWasQuad = prevCmd && (prevCmd.toUpperCase() === 'Q' || prevCmd.toUpperCase() === 'T') && prevCtrl;
      const q1 = prevWasQuad ? { x: 2 * curX - prevCtrl.x, y: 2 * curY - prevCtrl.y } : { x: curX, y: curY };
      const c1 = { x: curX + (2 / 3) * (q1.x - curX), y: curY + (2 / 3) * (q1.y - curY) };
      const c2 = { x: X + (2 / 3) * (q1.x - X), y: Y + (2 / 3) * (q1.y - Y) };
      cur.segs.push({ cmd: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: X, y: Y });
      prevCtrl = q1; curX = X; curY = Y; prevCmd = cmd;
    } else if (C === 'A') {
      const rx = readNum(), ry = readNum(), rot = readNum(), largeArc = readFlag(), sweep = readFlag();
      const x = readNum(), y = readNum();
      const X = isRel ? curX + x : x, Y = isRel ? curY + y : y;
      cur.segs.push({ cmd: 'A', rx, ry, rot, largeArc, sweep, x: X, y: Y });
      curX = X; curY = Y; prevCmd = cmd; prevCtrl = null;
    } else if (C === 'Z') {
      closeIfOpen();
      prevCmd = cmd; prevCtrl = null;
    } else {
      throw new Error(`unsupported path command "${cmd}"`);
    }
  }
  if (cur) subpaths.push(cur);
  return subpaths;
}

/** World point + theta-increasing ("CCW") unit tangent of a (possibly
 *  rotated) ellipse arc at local angle `theta` — the same toWorld pattern
 *  arcToCubics itself already uses (path-layout.js), generalized to also
 *  return the tangent so offset-curve callbacks don't need a second
 *  formula. */
function _arcWorldPointTangent(cx, cy, rx, ry, phi, theta) {
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const lx = rx * cosT, ly = ry * sinT;
  const point = { x: cosPhi * lx - sinPhi * ly + cx, y: sinPhi * lx + cosPhi * ly + cy };
  const dlx = -rx * sinT, dly = ry * cosT;
  const dx = cosPhi * dlx - sinPhi * dly, dy = sinPhi * dlx + cosPhi * dly;
  const mag = Math.hypot(dx, dy) || 1;
  return { point, tangentCCW: { x: dx / mag, y: dy / mag } };
}

function _offsetLineSeg(p0, seg, side, half) {
  const p1 = { x: seg.x, y: seg.y };
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null; // zero-length: nothing to offset, skip
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux; // left normal, same convention as every other offset in this module
  const off = side * half;
  const a = { x: p0.x + nx * off, y: p0.y + ny * off };
  const b = { x: p1.x + nx * off, y: p1.y + ny * off };
  const tangent = { x: ux, y: uy };
  return { startPoint: a, endPoint: b, startTangent: tangent, endTangent: tangent, commands: [['L', b.x, b.y]] };
}

/**
 * Which side is "outward" at an arc's OWN start point: worked example (unit
 * circle, theta1=0, traveled CCW so dTheta>0/travelSign=+1) — tangent there
 * is (0,1) (theta-increasing direction), left normal of that tangent is
 * (-1,0), but outward at theta=0 is (+1,0) — opposite of left, so outward
 * is RIGHT when travelSign>0 (CCW), i.e. outward is LEFT when travelSign<0
 * (CW). Matches `outwardIsLeft = travelSign < 0` below; cross-checked
 * against real sampled points in this module's own tests, not just this
 * comment's algebra (the session's established discipline after T34/T38
 * each got a sweep-style sign wrong by skipping that step once).
 */
function _offsetArcSeg(p0, seg, side, half, tolerance) {
  const param = arcCenterParam(p0.x, p0.y, seg.rx, seg.ry, seg.rot, !!seg.largeArc, !!seg.sweep, seg.x, seg.y);
  if (!param) return _offsetLineSeg(p0, seg, side, half); // degenerate arc = line, matches arcToCubics' own fallback
  const { cx, cy, rx, ry, phi, theta1, dTheta } = param;
  const travelSign = dTheta > 0 ? 1 : -1;
  const isCircular = Math.abs(rx - ry) < 1e-6 * Math.max(rx, ry, 1);
  const outwardIsLeft = travelSign < 0;
  const wantOutward = side === 1 ? outwardIsLeft : !outwardIsLeft;

  if (isCircular) {
    const newR = wantOutward ? rx + half : rx - half;
    if (newR <= 1e-9) return null; // stroke swallows this arc's own radius entirely
    const theta2 = theta1 + dTheta;
    const { point: startPoint, tangentCCW: t0ccw } = _arcWorldPointTangent(cx, cy, newR, newR, phi, theta1);
    const { point: endPoint, tangentCCW: t1ccw } = _arcWorldPointTangent(cx, cy, newR, newR, phi, theta2);
    const startTangent = { x: t0ccw.x * travelSign, y: t0ccw.y * travelSign };
    const endTangent = { x: t1ccw.x * travelSign, y: t1ccw.y * travelSign };
    const largeArc = Math.abs(dTheta) > Math.PI ? 1 : 0; // span unchanged -- concentric
    const sweep = seg.sweep ? 1 : 0; // travel sense unchanged -- concentric, same direction
    return {
      startPoint, endPoint, startTangent, endTangent,
      commands: [['A', newR, newR, 0, largeArc, sweep, endPoint.x, endPoint.y]],
    };
  }

  // Elliptical: no closed form -- biarc-fit, same primitive ellipseOutlinePathD
  // uses for a full ellipse, here over just [theta1, theta1+dTheta]. The
  // offset curve's tangent equals the SOURCE curve's own tangent at the
  // same parameter (a constant-distance normal offset doesn't rotate the
  // tangent) -- same fact _ellipseOffsetLoopD's own comment already
  // documents, reused rather than re-derived.
  const off = (wantOutward ? 1 : -1) * half;
  const paramToPoint = (t) => {
    const theta = theta1 + t * dTheta;
    const { point, tangentCCW } = _arcWorldPointTangent(cx, cy, rx, ry, phi, theta);
    const outwardCCW = { x: tangentCCW.y, y: -tangentCCW.x }; // same -90deg convention as _ellipsePointTangent
    return { x: point.x + off * outwardCCW.x, y: point.y + off * outwardCCW.y };
  };
  const paramToTangent = (t) => {
    const theta = theta1 + t * dTheta;
    const { tangentCCW } = _arcWorldPointTangent(cx, cy, rx, ry, phi, theta);
    return { x: tangentCCW.x * travelSign, y: tangentCCW.y * travelSign };
  };
  const { startPoint, segments } = fitOffsetWithBiarcs(paramToPoint, paramToTangent, 0, 1, tolerance);
  return {
    startPoint, endPoint: paramToPoint(1),
    startTangent: paramToTangent(0), endTangent: paramToTangent(1),
    commands: segments,
  };
}

function _offsetCubicSeg(p0, seg, side, half, tolerance) {
  const P0 = p0, P1 = { x: seg.x1, y: seg.y1 }, P2 = { x: seg.x2, y: seg.y2 }, P3 = { x: seg.x, y: seg.y };
  const paramToPoint = (t) => _cubicOffsetPoint(P0, P1, P2, P3, t, side, half);
  const paramToTangent = (t) => _cubicPointTangentCurvature(P0, P1, P2, P3, t).tangent;
  const { startPoint, segments } = fitOffsetWithBiarcs(paramToPoint, paramToTangent, 0, 1, tolerance);
  return {
    startPoint, endPoint: paramToPoint(1),
    startTangent: paramToTangent(0), endTangent: paramToTangent(1),
    commands: segments,
  };
}

function _offsetSegment(p0, seg, side, half, tolerance) {
  if (seg.cmd === 'L') return _offsetLineSeg(p0, seg, side, half);
  if (seg.cmd === 'A') return _offsetArcSeg(p0, seg, side, half, tolerance);
  if (seg.cmd === 'C') return _offsetCubicSeg(p0, seg, side, half, tolerance);
  return null;
}

function _lineIntersect(p1, d1, p2, d2) {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return null; // parallel/near-colinear tangents
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const t = (dx * d2.y - dy * d2.x) / denom;
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}

/**
 * The join between two consecutive offset pieces meeting at the path's own
 * `vertex`. Worked example fixing the round join's sweep flag (an L-shaped
 * RIGHT turn, (0,0)->(10,0)->(10,-10), vertex=(10,0), half=1): tA=(1,0),
 * tB=(0,-1), cross = tA.x*tB.y - tA.y*tB.x = -1 -> leftIsOuter=true (a
 * right turn's outer/convex bulge is on the LEFT, matching everyday
 * intuition: turning right, the outside of the turn is your left). For the
 * LEFT bank there (side=+1, genuinely outer): pA = vertex + leftNormal(tA)
 * = (10,1), pB = vertex + leftNormal(tB) = (11,0); toA=(0,1) at angle
 * pi/2, toB=(1,0) at angle 0; dTheta = 0 - pi/2 = -pi/2 -> sweep=0. NOT
 * hand-trusted: this module's own tests sample that exact arc via
 * arcCenterParam and confirm its midpoint (10.71, 0.71) lands up-and-right
 * of the vertex — away from the turn's own interior (down-left) — i.e. a
 * genuine outward bulge, not just that the formula ran.
 */
function _buildJoin(vertex, pA, tA, pB, tB, side, half) {
  const cross = tA.x * tB.y - tA.y * tB.x;
  if (Math.abs(cross) < 1e-7) return { commands: [['L', pB.x, pB.y]] }; // tangent-continuous: no join needed

  const leftIsOuter = cross < 0;
  const thisIsOuter = side === 1 ? leftIsOuter : !leftIsOuter;

  if (thisIsOuter) {
    const toA = { x: pA.x - vertex.x, y: pA.y - vertex.y };
    const toB = { x: pB.x - vertex.x, y: pB.y - vertex.y };
    let dTheta = Math.atan2(toB.y, toB.x) - Math.atan2(toA.y, toA.x);
    while (dTheta <= -Math.PI) dTheta += 2 * Math.PI;
    while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    const sweep = dTheta > 0 ? 1 : 0;
    return { commands: [['A', half, half, 0, 0, sweep, pB.x, pB.y]] };
  }

  // Inner (concave) side: trim BOTH pieces to the intersection of their own
  // local tangent lines through pA/pB, rather than emit the small overlap
  // loop a naive pA->ip->pB concatenation would produce (that overlap is
  // real, not cosmetic -- e.g. for a closed rect this was observed to
  // retrace the same line segment backward-then-forward, a degenerate
  // zero-width sliver an evenodd fill renders as a visible notch). A
  // collapse (near-parallel tangents, or an intersection absurdly far from
  // the vertex -- a thin-spike-style near-cusp) falls back to a direct
  // connector instead of a wild miter spike.
  const ip = _lineIntersect(pA, tA, pB, tB);
  if (!ip || Math.hypot(ip.x - vertex.x, ip.y - vertex.y) > 8 * half) {
    return { commands: [['L', pB.x, pB.y]] };
  }
  return { trimTo: ip, pB };
}

/**
 * Append one join's contribution to an in-progress command list, resolving
 * `_buildJoin`'s `trimTo` case against the ACTUAL shape of what's on each
 * side of it: a straight `L` boundary can be silently retargeted to `ip`
 * (still the exact same line, just shorter/longer), but a curved boundary
 * (an `A` from an exact circular offset, or any biarc-fitted chain) was
 * built assuming its own real endpoint, so retargeting it would distort
 * the curve -- an explicit connector segment is required there instead.
 * Four cases, decided independently per side:
 *   prev=L,  curr=L (single cmd): mutate prev's endpoint to ip, emit nothing
 *     (curr's own lone `L <endpoint>` already continues correctly from ip,
 *     since a straight command doesn't care what point precedes it).
 *   prev=L,  curr=curve: mutate prev's endpoint to ip, then bridge `L pB`
 *     so curr's own precomputed curve still starts from its real pB.
 *   prev=curve, curr=L (single cmd): bridge `L ip` only (curr continues
 *     from ip directly, same reasoning as the first case).
 *   prev=curve, curr=curve: bridge `L ip` then `L pB` (the original,
 *     fully general 2-point connector), preserving both curves untouched.
 */
function _appendJoin(commands, vertex, pA, tA, pB, tB, side, half, currCommands) {
  const join = _buildJoin(vertex, pA, tA, pB, tB, side, half);
  if (join.commands) { commands.push(...join.commands); return; }

  const last = commands[commands.length - 1];
  const prevIsLine = last && last[0] === 'L';
  const currIsLine = currCommands.length === 1 && currCommands[0][0] === 'L';

  if (prevIsLine) { last[1] = join.trimTo.x; last[2] = join.trimTo.y; }
  else commands.push(['L', join.trimTo.x, join.trimTo.y]);

  if (!currIsLine) commands.push(['L', join.pB.x, join.pB.y]);
}

function _buildBank(subpath, side, half, tolerance) {
  const pieces = [];
  let curOrig = subpath.start;
  for (const seg of subpath.segs) {
    const piece = _offsetSegment(curOrig, seg, side, half, tolerance);
    if (piece) pieces.push({ piece, vertex: curOrig });
    curOrig = { x: seg.x, y: seg.y };
  }
  if (!pieces.length) {
    return { startPoint: null, endPoint: null, startTangent: null, endTangent: null, commands: [], firstPieceCommands: null };
  }

  const commands = [];
  for (let i = 0; i < pieces.length; i++) {
    if (i > 0) {
      const prev = pieces[i - 1].piece;
      const curr = pieces[i].piece;
      _appendJoin(commands, pieces[i].vertex, prev.endPoint, prev.endTangent, curr.startPoint, curr.startTangent, side, half, curr.commands);
    }
    commands.push(...pieces[i].piece.commands);
  }
  return {
    startPoint: pieces[0].piece.startPoint,
    endPoint: pieces[pieces.length - 1].piece.endPoint,
    startTangent: pieces[0].piece.startTangent,
    endTangent: pieces[pieces.length - 1].piece.endTangent,
    commands,
    firstPieceCommands: pieces[0].piece.commands,
  };
}

/** Reverse a chain of L/A commands (biarc chains only ever emit L/A, so
 *  this covers every bank this module builds): walks the point sequence
 *  backward, and for each `A` flips its OWN sweep flag too (traveling the
 *  same circle the opposite way reverses ITS direction independently of
 *  the chain's overall order) -- one general operation reused for both the
 *  exact-circular case and any biarc-fitted chain, rather than a second
 *  "build already reversed" code path per segment kind. */
function _reverseCommands(startPoint, commands) {
  const pts = [startPoint];
  for (const c of commands) pts.push(c[0] === 'L' ? { x: c[1], y: c[2] } : { x: c[6], y: c[7] });
  const out = [];
  for (let i = commands.length - 1; i >= 0; i--) {
    const c = commands[i];
    const newEnd = pts[i];
    if (c[0] === 'L') out.push(['L', newEnd.x, newEnd.y]);
    else out.push(['A', c[1], c[2], c[3], c[4], c[5] ? 0 : 1, newEnd.x, newEnd.y]);
  }
  return { startPoint: pts[pts.length - 1], commands: out };
}

/** Round cap only — SUPPORTED_LINE_CAPS' own declared scope, same as
 *  lineOutlinePathD; butt/square are declined by the caller before this
 *  ever runs. Same sweep=0 convention lineOutlinePathD's own caps use
 *  (verified there against arcToCubics' sampled midpoint). */
function _buildCap(toPoint, half) {
  return [['A', half, half, 0, 0, 0, toPoint.x, toPoint.y]];
}

function _openCapsuleD(subpath, half, tolerance) {
  const left = _buildBank(subpath, 1, half, tolerance);
  const right = _buildBank(subpath, -1, half, tolerance);
  if (!left.startPoint || !right.startPoint) return null;

  const endCap = _buildCap(right.endPoint, half);
  const { commands: rCmds } = _reverseCommands(right.startPoint, right.commands);
  const startCap = _buildCap(left.startPoint, half);

  const commands = [...left.commands, ...endCap, ...rCmds, ...startCap];
  return `M ${left.startPoint.x} ${left.startPoint.y} ${commands.map((c) => c.join(' ')).join(' ')} Z`;
}

/**
 * The wrap-around join (last piece -> first piece) can't reuse
 * `_appendJoin` as-is: an internal join's "curr" piece hasn't been emitted
 * yet, so skipping its start is just "emit nothing, let it run next" — but
 * the FIRST piece here was already emitted at the very front of
 * `bank.commands`, before the ring's own `M`. So when the first piece is a
 * skippable single `L` (see `_appendJoin`'s own comment), the equivalent
 * trim is to retarget the ring's OWN starting point (M) to `ip` instead of
 * `bank.startPoint` — geometrically exact, since `ip` lies on that first
 * piece's own line by construction (same reasoning, applied to the one
 * point this module represents implicitly via `M` rather than a command).
 */
function _closedRing(subpath, side, half, tolerance) {
  const bank = _buildBank(subpath, side, half, tolerance);
  if (!bank.startPoint) return null;

  const join = _buildJoin(subpath.start, bank.endPoint, bank.endTangent, bank.startPoint, bank.startTangent, side, half);
  const commands = bank.commands.slice();
  let startPoint = bank.startPoint;

  if (join.commands) {
    commands.push(...join.commands);
  } else {
    const last = commands[commands.length - 1];
    const prevIsLine = last && last[0] === 'L';
    const currIsLine = bank.firstPieceCommands.length === 1 && bank.firstPieceCommands[0][0] === 'L';
    if (prevIsLine) { last[1] = join.trimTo.x; last[2] = join.trimTo.y; }
    else commands.push(['L', join.trimTo.x, join.trimTo.y]);
    if (currIsLine) startPoint = join.trimTo;
    else commands.push(['L', join.pB.x, join.pB.y]);
  }

  return { startPoint, commands, d: `M ${startPoint.x} ${startPoint.y} ${commands.map((c) => c.join(' ')).join(' ')} Z` };
}

function _signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    area += p.x * q.y - q.x * p.y;
  }
  return area / 2;
}

function _orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Proper-crossing test between two segments (ignores shared-endpoint/
 *  collinear touches — fine for a "does this ring bowtie" check, where a
 *  genuine crossing is what matters). */
function _segmentsCross(p1, p2, p3, p4) {
  const d1 = _orient(p3, p4, p1), d2 = _orient(p3, p4, p2);
  const d3 = _orient(p1, p2, p3), d4 = _orient(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Whether a closed ring's own sampled polyline crosses itself anywhere --
 * the LOCAL counterpart to `_signedArea`'s GLOBAL winding check. A whole-
 * ring inversion (offset so wide the ring flips orientation) shows up as a
 * sign flip or near-zero net area; a genuinely NARROW feature (a spike
 * thinner than strokeWidth) instead produces a ring whose two walls cross
 * each other partway along — net area can still read positive and same-
 * signed as the outer ring even though the ring is not a simple polygon,
 * so the sign check alone misses it (found via the T39 thin-spike test:
 * the sign check alone left a visible bowtie in the middle of the inner
 * ring, undetected). O(n^2) over the ring's own sample points, fine at
 * this module's sample counts (tens of points per ring, not thousands).
 */
function _hasSelfIntersection(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a1 = points[i], a2 = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // wraparound-adjacent: shares a vertex, not a real crossing
      const b1 = points[j], b2 = points[(j + 1) % n];
      if (_segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** Sample a built ring's own OUTPUT commands into a dense point list --
 *  used only to decide validity (winding sign / near-zero area), never
 *  emitted as output geometry (the actual `d` keeps its exact L/A
 *  commands regardless). */
function _sampleRing(startPoint, commands, samplesPerArc = 6) {
  const pts = [startPoint];
  let cur = startPoint;
  for (const c of commands) {
    if (c[0] === 'L') { cur = { x: c[1], y: c[2] }; pts.push(cur); continue; }
    const [, rx, ry, rot, largeArc, sweep, ex, ey] = c;
    const param = arcCenterParam(cur.x, cur.y, rx, ry, rot, !!largeArc, !!sweep, ex, ey);
    if (param) {
      const { cx, cy, rx: R, ry: Ry, phi, theta1, dTheta } = param;
      for (let i = 1; i <= samplesPerArc; i++) {
        pts.push(_arcWorldPointTangent(cx, cy, R, Ry, phi, theta1 + (dTheta * i) / samplesPerArc).point);
      }
    }
    cur = { x: ex, y: ey }; pts.push(cur);
  }
  return pts;
}

/** Same idea as `_sampleRing`, but over the ORIGINAL (un-offset) subpath's
 *  own segments -- used once, to read the source path's own winding
 *  direction so the closed-ring builder knows which offset side is
 *  "outward." */
function _sampleOriginal(subpath, samples = 8) {
  const pts = [subpath.start];
  let cur = subpath.start;
  for (const seg of subpath.segs) {
    if (seg.cmd === 'L') { cur = { x: seg.x, y: seg.y }; pts.push(cur); continue; }
    if (seg.cmd === 'A') {
      const param = arcCenterParam(cur.x, cur.y, seg.rx, seg.ry, seg.rot, !!seg.largeArc, !!seg.sweep, seg.x, seg.y);
      if (param) {
        const { cx, cy, rx, ry, phi, theta1, dTheta } = param;
        for (let i = 1; i <= samples; i++) pts.push(_arcWorldPointTangent(cx, cy, rx, ry, phi, theta1 + (dTheta * i) / samples).point);
      }
      cur = { x: seg.x, y: seg.y }; pts.push(cur); continue;
    }
    // 'C'
    const P0 = cur, P1 = { x: seg.x1, y: seg.y1 }, P2 = { x: seg.x2, y: seg.y2 }, P3 = { x: seg.x, y: seg.y };
    for (let i = 1; i <= samples; i++) pts.push(_cubicPointTangentCurvature(P0, P1, P2, P3, i / samples).point);
    cur = { x: seg.x, y: seg.y };
  }
  return pts;
}

function _segToD(seg) {
  if (seg.cmd === 'L') return `L ${seg.x} ${seg.y}`;
  if (seg.cmd === 'A') return `A ${seg.rx} ${seg.ry} ${seg.rot} ${seg.largeArc ? 1 : 0} ${seg.sweep ? 1 : 0} ${seg.x} ${seg.y}`;
  return `C ${seg.x1} ${seg.y1} ${seg.x2} ${seg.y2} ${seg.x} ${seg.y}`;
}

function _passthroughD(subpath) {
  const body = subpath.segs.map(_segToD).join(' ');
  return `M ${subpath.start.x} ${subpath.start.y} ${body}${subpath.closed ? ' Z' : ''}`;
}

/**
 * Closed subpath, mode-gated exactly like every shape kind in this session
 * (circleOutlinePathD etc.): 'fill' = the path's own exact edge (no
 * offset); 'both' = outer ring only; 'stroke' (default) = outer + inner
 * (evenodd), inner DROPPED whole when it collapses.
 *
 * "Which offset side is outward" needs the path's own winding direction
 * (worked example: CCW unit square (0,0),(1,0),(1,1),(0,1) -- shoelace via
 * `_signedArea` gives +1 (positive); at the first edge (0,0)->(1,0) the
 * LEFT normal is (0,1), pointing INTO the square -- so for this
 * (positive-area) winding, LEFT is INTERIOR and outward is the RIGHT side.
 * Hence `outerSide = area>0 ? -1 : 1`, cross-checked in this module's own
 * tests against a concrete CCW square rather than trusted from this
 * comment alone.
 */
function _closedSubpathD(subpath, half, tolerance, mode) {
  if (mode === 'fill') return _passthroughD(subpath);

  const originalArea = _signedArea(_sampleOriginal(subpath));
  const outerSide = originalArea > 0 ? -1 : 1;
  const outer = _closedRing(subpath, outerSide, half, tolerance);
  if (!outer) return null;
  if (mode === 'both') return outer.d;

  const inner = _closedRing(subpath, -outerSide, half, tolerance);
  if (!inner) return outer.d;
  const innerPts = _sampleRing(inner.startPoint, inner.commands);
  const innerArea = _signedArea(innerPts);
  const outerArea = _signedArea(_sampleRing(outer.startPoint, outer.commands));
  if (Math.sign(innerArea) !== Math.sign(outerArea) || Math.abs(innerArea) < 1e-9 || _hasSelfIntersection(innerPts)) {
    return outer.d; // collapsed (thinner than strokeWidth somewhere) -- drop the inner ring, don't emit a bowtie
  }
  return `${outer.d} ${inner.d}`;
}

function _openSubpathD(subpath, half, tolerance, mode) {
  if (mode === 'fill') return _passthroughD(subpath);
  return _openCapsuleD(subpath, half, tolerance); // an open stroke has one boundary regardless of stroke/both
}

/**
 * The general offset outline of ANY absolute-or-relative SVG path `d`
 * string, walking every subpath it contains. See this module's own header
 * for the join/assembly rules. Returns `{d, unsupported}` like every other
 * *OutlinePathD in this session — `unsupported` names the reason (a
 * declined cap, or a `d` string this module's parser can't read) rather
 * than throwing, so a caller (editor-outline-preview.js's OUTLINE_KINDS)
 * can silently skip the preview exactly like every other decline already
 * does.
 */
export function pathOutlinePathD(d, strokeWidth, { mode = 'stroke', cap = 'round', join = 'round', tolerance = 0.001 } = {}) {
  if (!SUPPORTED_LINE_CAPS[cap]) return { d: null, unsupported: cap };
  if (join !== 'round') return { d: null, unsupported: `join:${join}` }; // only join style built this turn

  let subpaths;
  try {
    subpaths = _parseD(d);
  } catch {
    return { d: null, unsupported: 'parse' };
  }
  if (!subpaths.length) return { d: null, unsupported: 'empty' };

  const half = strokeWidth / 2;
  const parts = [];
  for (const subpath of subpaths) {
    if (!subpath.segs.length) continue; // e.g. a lone "M x y" with no drawing -- nothing to outline
    const piece = subpath.closed
      ? _closedSubpathD(subpath, half, tolerance, mode)
      : _openSubpathD(subpath, half, tolerance, mode);
    if (piece) parts.push(piece);
  }
  if (!parts.length) return { d: null, unsupported: 'degenerate' };
  return { d: parts.join(' '), unsupported: null };
}
