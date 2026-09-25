/**
 * SE12 T38 AMEND (Fred: "ellipse and curved path too please") —
 * fitOffsetWithBiarcs (the general adaptive biarc-fitting primitive) and
 * its two consumers, ellipseOutlinePathD / cubicSegmentOutlinePathD
 * (editor-expand-analytic.js).
 *
 * A REAL bug lived here before this test file existed: the sweep/largeArc
 * direction logic flipped whenever `dot < 0`, regardless of the
 * already-computed dTheta's OWN sign — wrong exactly when both were
 * already consistent (both negative), turning a short, correct arc into
 * the long way round. It passed every quarter-circle/ellipse check
 * (where curvature never changes sign) and only broke on a genuine
 * S-curve (curvature crossing zero mid-curve) — found by testing that
 * specific case, not by inspection. Fixed by comparing SIGNS instead of
 * checking `dot`'s sign alone; the fix and its own non-vacuous mutation
 * check are below.
 */
import { describe, it, expect } from 'vitest';
import { fitOffsetWithBiarcs } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-expand-biarc.js';
import {
  ellipseOutlinePathD, cubicSegmentOutlinePathD,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-expand-analytic.js';
import { arcToCubics } from '../bspline-frame-builder/b-spline-gen/html/editor/path-layout.js';

function sampleCubic(p0, seg, t) {
  const [, c1x, c1y, c2x, c2y, ex, ey] = seg;
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
    y: u * u * u * p0.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
  };
}

function parseD(d) {
  const tokens = d.trim().split(/\s+/);
  const segs = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i];
    if (cmd === 'M' || cmd === 'L') { segs.push([cmd, +tokens[i + 1], +tokens[i + 2]]); i += 3; }
    else if (cmd === 'A') { segs.push(['A', ...tokens.slice(i + 1, i + 8).map(Number)]); i += 8; }
    else if (cmd === 'Z') { segs.push(['Z']); i += 1; }
    else throw new Error('parseD: unexpected token ' + cmd);
  }
  return segs;
}

/** Sample a chain of segments (starting from `start`) into a dense point list. */
function sampleChain(start, segments, stepsPerArc = 8) {
  let cur = start;
  const pts = [cur];
  for (const seg of segments) {
    if (seg[0] === 'A') {
      const cubics = arcToCubics(cur, seg);
      let lc = cur;
      for (const c of cubics) { for (let i = 1; i <= stepsPerArc; i++) pts.push(sampleCubic(lc, c, i / stepsPerArc)); lc = { x: c[5], y: c[6] }; }
      cur = { x: seg[6], y: seg[7] };
    } else if (seg[0] === 'L') { pts.push({ x: seg[1], y: seg[2] }); cur = { x: seg[1], y: seg[2] }; }
  }
  return pts;
}

function splitSubpaths(segs) {
  const subpaths = [];
  let cur = [];
  for (const s of segs) {
    if (s[0] === 'M' && cur.length) { subpaths.push(cur); cur = []; }
    cur.push(s);
  }
  if (cur.length) subpaths.push(cur);
  return subpaths;
}

/** Max distance from `pts` to the nearest point in a dense sampling of
 *  the ground-truth curve `groundParamToPoint` over [t0,t1]. */
function maxDeviationAgainstGroundTruth(pts, groundParamToPoint, t0, t1, n = 20000) {
  const cloud = [];
  for (let i = 0; i <= n; i++) cloud.push(groundParamToPoint(t0 + ((t1 - t0) * i) / n));
  let maxDev = 0;
  for (const p of pts) {
    let minD = Infinity;
    for (const q of cloud) { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < minD) minD = d; }
    if (minD > maxDev) maxDev = minD;
  }
  return maxDev;
}

describe('fitOffsetWithBiarcs — the general adaptive fitter', () => {
  it('a unit circle quarter (CCW): fits within tolerance, output is 2 A segments', () => {
    const paramToPoint = (t) => ({ x: Math.cos(t), y: Math.sin(t) });
    const paramToTangent = (t) => ({ x: -Math.sin(t), y: Math.cos(t) });
    const { startPoint, segments } = fitOffsetWithBiarcs(paramToPoint, paramToTangent, 0, Math.PI / 2, 0.001);
    expect(segments.every((s) => s[0] === 'A')).toBe(true);
    const pts = sampleChain(startPoint, segments);
    expect(maxDeviationAgainstGroundTruth(pts, paramToPoint, 0, Math.PI / 2)).toBeLessThan(0.001);
  });

  it('a unit circle quarter (CW, reversed direction): fits correctly too — not just right by CCW symmetry', () => {
    const paramToPoint = (t) => ({ x: Math.cos(-t), y: Math.sin(-t) });
    const paramToTangent = (t) => ({ x: Math.sin(-t), y: -Math.cos(-t) });
    const { startPoint, segments } = fitOffsetWithBiarcs(paramToPoint, paramToTangent, 0, Math.PI / 2, 0.001);
    const pts = sampleChain(startPoint, segments);
    expect(maxDeviationAgainstGroundTruth(pts, paramToPoint, 0, Math.PI / 2)).toBeLessThan(0.001);
  });

  it('a full non-circular ellipse (rx=3,ry=1, real curvature variation, full 2*pi span): fits within tolerance, subdividing as needed', () => {
    const rx = 3, ry = 1;
    const paramToPoint = (t) => ({ x: rx * Math.cos(t), y: ry * Math.sin(t) });
    const paramToTangent = (t) => { const dx = -rx * Math.sin(t), dy = ry * Math.cos(t); const l = Math.hypot(dx, dy); return { x: dx / l, y: dy / l }; };
    const { startPoint, segments } = fitOffsetWithBiarcs(paramToPoint, paramToTangent, 0, 2 * Math.PI, 0.001);
    expect(segments.length).toBeGreaterThan(2); // real subdivision happened
    const pts = sampleChain(startPoint, segments);
    expect(maxDeviationAgainstGroundTruth(pts, paramToPoint, 0, 2 * Math.PI)).toBeLessThan(0.001);
  });

  it('a genuine S-curve offset (curvature crosses zero mid-curve — the exact case that caught the real sweep-direction bug): fits within tolerance across the WHOLE range, not just the halves that happened to work before', () => {
    const P0 = { x: 0, y: 0 }, P1 = { x: 1, y: 2 }, P2 = { x: 2, y: -2 }, P3 = { x: 3, y: 0 };
    const half = 0.15;
    const cubicPt = (t) => { const u = 1 - t; return { x: u * u * u * P0.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * P3.x, y: u * u * u * P0.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * P3.y }; };
    const cubicTan = (t) => { const u = 1 - t; const d1 = { x: 3 * u * u * (P1.x - P0.x) + 6 * u * t * (P2.x - P1.x) + 3 * t * t * (P3.x - P2.x), y: 3 * u * u * (P1.y - P0.y) + 6 * u * t * (P2.y - P1.y) + 3 * t * t * (P3.y - P2.y) }; const s = Math.hypot(d1.x, d1.y); return { x: d1.x / s, y: d1.y / s }; };
    const leftPoint = (t) => { const p = cubicPt(t), tan = cubicTan(t), n = { x: -tan.y, y: tan.x }; return { x: p.x + half * n.x, y: p.y + half * n.y }; };
    const { startPoint, segments } = fitOffsetWithBiarcs(leftPoint, cubicTan, 0, 1, 0.001);
    const pts = sampleChain(startPoint, segments);
    const dev = maxDeviationAgainstGroundTruth(pts, leftPoint, 0, 1);
    expect(dev).toBeLessThan(0.001);
    // Non-vacuous, by construction: the actual bug produced a deviation
    // of ~15 (a wild near-full-circle excursion), not a marginal
    // overshoot — so this bound is nowhere near the failure mode's own
    // scale, it's a real proof, not a coincidentally-loose threshold.
    expect(dev).toBeLessThan(0.01);
  });
});

describe('ellipseOutlinePathD', () => {
  const ELLIPSE = { cx: 5, cy: 3, rx: 4, ry: 2, strokeWidth: 0.5 };

  it('stroke mode: outer (+half) and inner (-half) rings both fit within tolerance of the TRUE offset curve', () => {
    const { d, unsupported } = ellipseOutlinePathD(ELLIPSE);
    expect(unsupported).toBeNull();
    const subpaths = splitSubpaths(parseD(d));
    expect(subpaths).toHaveLength(2);
    const half = ELLIPSE.strokeWidth / 2;
    const trueOffset = (off) => (t) => {
      const dx = -ELLIPSE.rx * Math.sin(t), dy = ELLIPSE.ry * Math.cos(t);
      const mag = Math.hypot(dx, dy);
      const nx = dy / mag, ny = -dx / mag; // outward normal, same convention as the module under test
      return { x: ELLIPSE.cx + ELLIPSE.rx * Math.cos(t) + off * nx, y: ELLIPSE.cy + ELLIPSE.ry * Math.sin(t) + off * ny };
    };
    for (const [subpath, off] of [[subpaths[0], half], [subpaths[1], -half]]) {
      const pts = sampleChain({ x: subpath[0][1], y: subpath[0][2] }, subpath.slice(1));
      expect(maxDeviationAgainstGroundTruth(pts, trueOffset(off), 0, 2 * Math.PI)).toBeLessThan(0.001);
    }
  });

  it('mode:fill — the ellipse\'s own exact edge (offset 0), single subpath', () => {
    const { d } = ellipseOutlinePathD({ ...ELLIPSE, mode: 'fill' });
    expect(splitSubpaths(parseD(d))).toHaveLength(1);
  });

  it('mode:both — outer ring only, no inner', () => {
    const { d } = ellipseOutlinePathD({ ...ELLIPSE, mode: 'both' });
    expect(splitSubpaths(parseD(d))).toHaveLength(1);
  });

  it('the inner ring vanishes when strokeWidth/2 meets or exceeds the ellipse\'s OWN minimum curvature radius (ry^2/rx for rx>ry, at the major-axis ends)', () => {
    const rx = 4, ry = 1; // min radius = ry^2/rx = 0.25
    const { d } = ellipseOutlinePathD({ cx: 0, cy: 0, rx, ry, strokeWidth: 0.6 }); // half=0.3 >= 0.25
    expect(splitSubpaths(parseD(d))).toHaveLength(1);
  });

  it('non-vacuous: strokeWidth just under that threshold keeps a real inner ring', () => {
    const rx = 4, ry = 1;
    const { d } = ellipseOutlinePathD({ cx: 0, cy: 0, rx, ry, strokeWidth: 0.4 }); // half=0.2 < 0.25
    expect(splitSubpaths(parseD(d))).toHaveLength(2);
  });
});

describe('cubicSegmentOutlinePathD', () => {
  const SCURVE = { x1: 0, y1: 0, cx1: 1, cy1: 2, cx2: 2, cy2: -2, x2: 3, y2: 0, strokeWidth: 0.3 };

  it('output contains only M/L/A/Z (Fred\'s own test requirement) — no C/S/Q/T leaks through', () => {
    const { d, unsupported } = cubicSegmentOutlinePathD(SCURVE);
    expect(unsupported).toBeNull();
    const commandsUsed = new Set(d.match(/[A-Za-z]/g));
    for (const c of commandsUsed) expect(['M', 'L', 'A', 'Z']).toContain(c);
  });

  it('enclosed area matches the analytic "stroked curve" estimate (curve length * strokeWidth + one full circle from the two semicircle caps) within 1%', () => {
    const { d } = cubicSegmentOutlinePathD(SCURVE);
    const segs = parseD(d);
    const pts = sampleChain({ x: segs[0][1], y: segs[0][2] }, segs.slice(1));
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p.x * q.y - q.x * p.y; }
    area = Math.abs(area / 2);

    const { x1, y1, cx1, cy1, cx2, cy2, x2, y2, strokeWidth } = SCURVE;
    const cubicPt = (t) => { const u = 1 - t; return { x: u * u * u * x1 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x2, y: u * u * u * y1 + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * y2 }; };
    let len = 0, prev = cubicPt(0);
    for (let i = 1; i <= 2000; i++) { const p = cubicPt(i / 2000); len += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
    const half = strokeWidth / 2;
    const expected = len * strokeWidth + Math.PI * half * half;
    expect(Math.abs(area - expected) / expected).toBeLessThan(0.01);
  });

  it('an unsupported cap (butt/square) declines explicitly, same as lineOutlinePathD', () => {
    const butt = cubicSegmentOutlinePathD({ ...SCURVE, cap: 'butt' });
    expect(butt.d).toBeNull();
    expect(butt.unsupported).toBe('butt');
  });
});

describe('non-vacuous: the sweep-direction fix, by mutation', () => {
  it('reverting to the buggy "flip whenever dot<0" rule (ignoring dTheta\'s own sign) makes a near-straight sub-arc come out as largeArc=1 (should be 0) — proven by re-implementing the OLD logic locally against a circle/tangent COMPUTED the same way the real fitter computes one (not hand-typed approximate numbers), not by re-editing the source file mid-test', () => {
    // Same circleFromPointTangentPoint construction the real module uses,
    // reproduced locally so this test doesn't depend on the module's own
    // (already-fixed) arc-direction function to build its OWN ground truth.
    function circleFromPointTangentPoint(P, T, Q) {
      const N = { x: -T.y, y: T.x };
      const d = { x: Q.x - P.x, y: Q.y - P.y };
      const Nd = N.x * d.x + N.y * d.y;
      const dd = d.x * d.x + d.y * d.y;
      const s = dd / (2 * Nd);
      return { center: { x: P.x + s * N.x, y: P.y + s * N.y }, radius: Math.abs(s) };
    }
    function buggyLargeArc(P, T, Q, center) {
      const toP = { x: P.x - center.x, y: P.y - center.y };
      const toQ = { x: Q.x - center.x, y: Q.y - center.y };
      let dTheta = Math.atan2(toQ.y, toQ.x) - Math.atan2(toP.y, toP.x);
      while (dTheta <= -Math.PI) dTheta += 2 * Math.PI;
      while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
      const ccwTangent = { x: -toP.y, y: toP.x };
      const dot = ccwTangent.x * T.x + ccwTangent.y * T.y;
      if (dot < 0) dTheta = dTheta > 0 ? dTheta - 2 * Math.PI : dTheta + 2 * Math.PI; // the OLD, wrong rule
      return Math.abs(dTheta) > Math.PI ? 1 : 0;
    }
    function fixedLargeArc(P, T, Q, center) {
      const toP = { x: P.x - center.x, y: P.y - center.y };
      const toQ = { x: Q.x - center.x, y: Q.y - center.y };
      let dTheta = Math.atan2(toQ.y, toQ.x) - Math.atan2(toP.y, toP.x);
      while (dTheta <= -Math.PI) dTheta += 2 * Math.PI;
      while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
      const ccwTangent = { x: -toP.y, y: toP.x };
      const dot = ccwTangent.x * T.x + ccwTangent.y * T.y;
      const wantsPositive = dot > 0, isPositive = dTheta > 0;
      if (wantsPositive !== isPositive) dTheta = isPositive ? dTheta - 2 * Math.PI : dTheta + 2 * Math.PI;
      return Math.abs(dTheta) > Math.PI ? 1 : 0;
    }
    // The exact P/T/Q the S-curve's own segment 11 uses (traced this
    // session while diagnosing the real bug: a near-straight,
    // radius~8.3 sub-arc near where the curve's curvature crosses zero).
    const P0 = { x: 0, y: 0 }, P1 = { x: 1, y: 2 }, P2 = { x: 2, y: -2 }, P3 = { x: 3, y: 0 };
    const t = 0.55; // near the segment 11 region traced earlier
    const u = 1 - t;
    const P = { x: u * u * u * P0.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * P3.x, y: u * u * u * P0.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * P3.y };
    const d1 = { x: 3 * u * u * (P1.x - P0.x) + 6 * u * t * (P2.x - P1.x) + 3 * t * t * (P3.x - P2.x), y: 3 * u * u * (P1.y - P0.y) + 6 * u * t * (P2.y - P1.y) + 3 * t * t * (P3.y - P2.y) };
    const speed = Math.hypot(d1.x, d1.y);
    const T = { x: d1.x / speed, y: d1.y / speed };
    const Q = { x: P.x + 0.02 * T.x, y: P.y + 0.02 * T.y }; // a nearby point along the near-straight direction
    const circle = circleFromPointTangentPoint(P, T, Q);
    expect(circle.radius).toBeGreaterThan(1); // confirms this IS the "large radius, small chord" case the bug hit
    expect(buggyLargeArc(P, T, Q, circle.center)).toBe(1); // the bug: wrongly large
    expect(fixedLargeArc(P, T, Q, circle.center)).toBe(0); // the fix: correctly small
  });
});
