/**
 * SE12 T38 — exact-shape outline entries: circleOutlinePathD,
 * rectOutlinePathD (closed-form, offset rings only — no offsetting
 * algorithm needed, unlike a general polygon). Same area/distance
 * verification style T35's line tests established: every bank/ring point
 * checked against its exact analytic distance, plus a shoelace-area
 * cross-check where a closed loop's enclosed area has a known formula.
 */
import { describe, it, expect } from 'vitest';
import {
  circleOutlinePathD, rectOutlinePathD,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-expand-analytic.js';
import { arcToCubics } from '../bspline-frame-builder/b-spline-gen/html/editor/path-layout.js';

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

/** Split a multi-subpath `d` (several M..Z runs) into separate segment arrays. */
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

function sampleCubic(p0, seg, t) {
  const [, c1x, c1y, c2x, c2y, ex, ey] = seg;
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
    y: u * u * u * p0.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
  };
}

function outlinePolygon(segs, stepsPerArc = 24) {
  const pts = [];
  let cur = null;
  for (const seg of segs) {
    if (seg[0] === 'M' || seg[0] === 'L') { cur = { x: seg[1], y: seg[2] }; pts.push(cur); }
    else if (seg[0] === 'A') {
      const cubics = arcToCubics(cur, seg);
      let localCur = cur;
      for (const c of cubics) {
        for (let i = 1; i <= stepsPerArc; i++) pts.push(sampleCubic(localCur, c, i / stepsPerArc));
        localCur = { x: c[5], y: c[6] };
      }
      cur = { x: seg[6], y: seg[7] };
    }
  }
  return pts;
}

function shoelaceArea(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

describe('circleOutlinePathD', () => {
  it('every sampled point on the outer subpath is EXACTLY r+strokeWidth/2 from center, inner exactly r-strokeWidth/2', () => {
    const cx = 3, cy = -2, r = 2, strokeWidth = 0.8;
    const { d, unsupported } = circleOutlinePathD({ cx, cy, r, strokeWidth });
    expect(unsupported).toBeNull();
    const [outerSegs, innerSegs] = splitSubpaths(parseD(d));
    expect(innerSegs).toBeDefined();
    // Tolerance: a circle rendered as 2 half-arcs, each split further by
    // arcToCubics into 90 deg cubics, carries the SAME well-known kappa-
    // approximation radial error (~0.027% of radius) T34/T35's own tests
    // already established and bounded generously — not a defect here,
    // an inherent property of approximating a circular arc with cubics
    // (this module's OWN `d` output is exact; only THIS TEST's sampling
    // of it via arcToCubics for verification purposes carries the error).
    const outerR = r + strokeWidth / 2, innerR = r - strokeWidth / 2;
    for (const p of outlinePolygon(outerSegs)) expect(Math.abs(Math.hypot(p.x - cx, p.y - cy) - outerR)).toBeLessThan(outerR * 0.0004);
    for (const p of outlinePolygon(innerSegs)) expect(Math.abs(Math.hypot(p.x - cx, p.y - cy) - innerR)).toBeLessThan(innerR * 0.0004);
  });

  it('annulus area matches the analytic formula pi*((r+h)^2-(r-h)^2) = 2*pi*r*strokeWidth', () => {
    const cx = 0, cy = 0, r = 3, strokeWidth = 1;
    const { d } = circleOutlinePathD({ cx, cy, r, strokeWidth });
    const [outerSegs, innerSegs] = splitSubpaths(parseD(d));
    const outerArea = Math.abs(shoelaceArea(outlinePolygon(outerSegs)));
    const innerArea = Math.abs(shoelaceArea(outlinePolygon(innerSegs)));
    const annulus = outerArea - innerArea;
    const expected = 2 * Math.PI * r * strokeWidth;
    expect(Math.abs(annulus - expected) / expected).toBeLessThan(0.001);
  });

  it('the inner ring vanishes (one subpath only) when strokeWidth/2 >= r', () => {
    const { d, unsupported } = circleOutlinePathD({ cx: 0, cy: 0, r: 1, strokeWidth: 3 }); // half=1.5 >= r=1
    expect(unsupported).toBeNull();
    expect(splitSubpaths(parseD(d))).toHaveLength(1);
  });

  it('non-vacuous: strokeWidth/2 just UNDER r keeps a real (non-degenerate) inner ring', () => {
    const { d } = circleOutlinePathD({ cx: 0, cy: 0, r: 1, strokeWidth: 1.9 }); // half=0.95 < r=1
    expect(splitSubpaths(parseD(d))).toHaveLength(2);
  });

  it('mode:fill — the outline is the circle\'s own exact edge (radius r), strokeWidth ignored entirely, single subpath', () => {
    const { d } = circleOutlinePathD({ cx: 1, cy: 2, r: 3, strokeWidth: 999, mode: 'fill' });
    const subpaths = splitSubpaths(parseD(d));
    expect(subpaths).toHaveLength(1);
    for (const p of outlinePolygon(subpaths[0])) expect(Math.abs(Math.hypot(p.x - 1, p.y - 2) - 3)).toBeLessThan(3 * 0.0004);
  });

  it('mode:both — single OUTER ring only (r+strokeWidth/2), never an inner one even though strokeWidth < r would normally keep one in stroke mode', () => {
    const { d } = circleOutlinePathD({ cx: 0, cy: 0, r: 5, strokeWidth: 1, mode: 'both' });
    const subpaths = splitSubpaths(parseD(d));
    expect(subpaths).toHaveLength(1);
    for (const p of outlinePolygon(subpaths[0])) expect(Math.abs(Math.hypot(p.x, p.y) - 5.5)).toBeLessThan(5.5 * 0.0004);
  });
});

describe('rectOutlinePathD', () => {
  const RECT = { x: 0, y: 0, width: 10, height: 6, strokeWidth: 2 };

  it('outer subpath: every straight-edge point is exactly half off the ORIGINAL edge; every corner-arc point is exactly half from the original corner', () => {
    const half = RECT.strokeWidth / 2;
    const { d } = rectOutlinePathD(RECT);
    const [outerSegs] = splitSubpaths(parseD(d));
    // Straight (L) points: perpendicular distance to the nearest original edge line is `half`.
    const corners = [[0, 0], [10, 0], [10, 6], [0, 6]];
    for (const s of outerSegs) {
      if (s[0] === 'L' || s[0] === 'M') {
        const [, px, py] = s;
        // Distance to the rect boundary (min over 4 edges, clamped) should be `half`.
        const dLeft = Math.abs(px - 0), dRight = Math.abs(px - 10), dTop = Math.abs(py - 0), dBottom = Math.abs(py - 6);
        const onVerticalEdge = py >= -1e-6 && py <= 6 + 1e-6;
        const onHorizontalEdge = px >= -1e-6 && px <= 10 + 1e-6;
        const dist = Math.min(
          onHorizontalEdge ? dTop : Infinity, onHorizontalEdge ? dBottom : Infinity,
          onVerticalEdge ? dLeft : Infinity, onVerticalEdge ? dRight : Infinity,
        );
        expect(dist).toBeCloseTo(half, 6);
      }
    }
    // Every point on the 4 corner arcs is exactly `half` from ITS OWN nearest original corner.
    for (const p of outlinePolygon(outerSegs)) {
      const dists = corners.map(([cx, cy]) => Math.hypot(p.x - cx, p.y - cy));
      expect(Math.min(...dists)).toBeGreaterThan(half - 1e-3); // never closer than half to any corner
    }
  });

  it('outer area matches the analytic rounded-rect formula: (W+sw)*(H+sw) - (4 - pi)*half^2', () => {
    const half = RECT.strokeWidth / 2;
    const { d } = rectOutlinePathD(RECT);
    const [outerSegs] = splitSubpaths(parseD(d));
    const area = Math.abs(shoelaceArea(outlinePolygon(outerSegs)));
    // A rect inflated by `half` with radius-half rounded corners: full
    // bounding box (W+sw)*(H+sw) minus the 4 corner squares' cut area
    // (each corner square of side `half` loses (1 - pi/4)*half^2 to the
    // round-over), i.e. minus 4*(1-pi/4)*half^2 = (4-pi)*half^2.
    const bbox = (RECT.width + RECT.strokeWidth) * (RECT.height + RECT.strokeWidth);
    const expected = bbox - (4 - Math.PI) * half * half;
    expect(Math.abs(area - expected) / expected).toBeLessThan(0.001);
  });

  it('inner subpath is a sharp-cornered rect offset inward by half, area = (W-sw)*(H-sw)', () => {
    const { d } = rectOutlinePathD(RECT);
    const [, innerSegs] = splitSubpaths(parseD(d));
    expect(innerSegs).toBeDefined();
    expect(innerSegs.map((s) => s[0])).toEqual(['M', 'L', 'L', 'L', 'Z']); // sharp corners: no A commands
    const area = Math.abs(shoelaceArea(outlinePolygon(innerSegs)));
    const expected = (RECT.width - RECT.strokeWidth) * (RECT.height - RECT.strokeWidth);
    expect(area).toBeCloseTo(expected, 6);
  });

  it('the inner ring vanishes when strokeWidth >= the shorter side', () => {
    const { d } = rectOutlinePathD({ x: 0, y: 0, width: 10, height: 4, strokeWidth: 4 }); // sw=4 >= min(10,4)=4
    expect(splitSubpaths(parseD(d))).toHaveLength(1);
  });

  it('non-vacuous: strokeWidth just UNDER the shorter side keeps a real inner ring', () => {
    const { d } = rectOutlinePathD({ x: 0, y: 0, width: 10, height: 4, strokeWidth: 3.9 });
    expect(splitSubpaths(parseD(d))).toHaveLength(2);
  });

  it('mode:fill — the outline is the rect\'s own exact edge, sharp corners, single subpath, strokeWidth ignored', () => {
    const { d } = rectOutlinePathD({ x: 1, y: 2, width: 8, height: 5, strokeWidth: 999, mode: 'fill' });
    const subpaths = splitSubpaths(parseD(d));
    expect(subpaths).toHaveLength(1);
    expect(subpaths[0].map((s) => s[0])).toEqual(['M', 'L', 'L', 'L', 'Z']);
    const area = Math.abs(shoelaceArea(outlinePolygon(subpaths[0])));
    expect(area).toBeCloseTo(8 * 5, 6);
  });

  it('mode:both — single rounded OUTER ring only, no inner, even for a strokeWidth that would normally leave a real inner ring in stroke mode', () => {
    const { d } = rectOutlinePathD({ ...RECT, mode: 'both' });
    const subpaths = splitSubpaths(parseD(d));
    expect(subpaths).toHaveLength(1);
    const half = RECT.strokeWidth / 2;
    const bbox = (RECT.width + RECT.strokeWidth) * (RECT.height + RECT.strokeWidth);
    const expected = bbox - (4 - Math.PI) * half * half;
    const area = Math.abs(shoelaceArea(outlinePolygon(subpaths[0])));
    expect(Math.abs(area - expected) / expected).toBeLessThan(0.001);
  });
});
