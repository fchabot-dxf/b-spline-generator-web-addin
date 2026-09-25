/**
 * SE12 Slice 1 — the analytic (non-sampling, non-polygon-clipping)
 * live-expand engine. Verifies lineOutlinePathD's `d` output is a single
 * closed loop with EXACT bank offsets and true semicircular caps, not by
 * trusting the formula but by parsing the emitted `d` back into segments
 * and checking geometric properties (perpendicular offset distance,
 * total enclosed area via the shoelace formula) that a wrong sign,
 * wrong sweep, or a self-intersecting ("bowtie") loop would all break.
 */
import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LINE_CAPS,
  lineOutlinePathD,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-expand-analytic.js';
import { arcToCubics } from '../bspline-frame-builder/b-spline-gen/html/editor/path-layout.js';

/** Minimal parser for the exact "M x y L x y A rx ry rot large sweep x y
 *  L x y A rx ry rot large sweep x y Z" shape lineOutlinePathD emits — not
 *  a general SVG path parser; this module's own tests are the only
 *  intended reader of its `d` string. */
function parseD(d) {
  const tokens = d.trim().split(/\s+/);
  const segs = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i];
    if (cmd === 'M' || cmd === 'L') {
      segs.push([cmd, parseFloat(tokens[i + 1]), parseFloat(tokens[i + 2])]);
      i += 3;
    } else if (cmd === 'A') {
      segs.push(['A', ...tokens.slice(i + 1, i + 8).map(Number)]);
      i += 8;
    } else if (cmd === 'Z') {
      segs.push(['Z']);
      i += 1;
    } else {
      throw new Error('parseD: unexpected token ' + cmd);
    }
  }
  return segs;
}

function sampleCubic(p0, seg, t) {
  const [, c1x, c1y, c2x, c2y, ex, ey] = seg;
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
    y: u * u * u * p0.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
  };
}

/** Walk the parsed segments into a dense polygon (arcs sampled via the
 *  SAME arcToCubics the production bake pipeline uses), for a shoelace
 *  area / winding check. */
function outlinePolygon(segs, stepsPerArc = 32) {
  const pts = [];
  let cur = null;
  for (const seg of segs) {
    if (seg[0] === 'M' || seg[0] === 'L') {
      cur = { x: seg[1], y: seg[2] };
      pts.push(cur);
    } else if (seg[0] === 'A') {
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

/** Perpendicular distance from `p` to the infinite line through p1->p2. */
function perpDist(p, p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  return Math.abs((p.x - p1.x) * dy - (p.y - p1.y) * dx) / len;
}

describe('lineOutlinePathD — round cap (SE12 Slice 1)', () => {
  const cases = [
    { name: 'horizontal', x1: 0, y1: 0, x2: 10, y2: 0 },
    { name: 'vertical', x1: 3, y1: -2, x2: 3, y2: 8 },
    { name: 'diagonal', x1: -1, y1: -1, x2: 6, y2: 4 },
  ];

  for (const { name, x1, y1, x2, y2 } of cases) {
    it(`${name} line: banks are exactly width/2 off the centerline, arcs are true radius-w/2 semicircles, total area matches a stadium shape (L*w + pi*(w/2)^2)`, () => {
      const strokeWidth = 1.4;
      const r = strokeWidth / 2;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const { d, unsupported } = lineOutlinePathD({ x1, y1, x2, y2, strokeWidth, cap: 'round' });
      expect(unsupported).toBeNull();
      const segs = parseD(d);

      // Segment shape: M, L, A, L, A, Z — 2 straight banks + 2 arc caps.
      expect(segs.map((s) => s[0])).toEqual(['M', 'L', 'A', 'L', 'A', 'Z']);

      // Every M/L point (the 4 bank endpoints) sits EXACTLY r off the
      // original centerline, measured perpendicular to it — direction-
      // agnostic, so this doesn't just re-assert the module's own normal
      // sign convention.
      const p1 = { x: x1, y: y1 }, p2 = { x: x2, y: y2 };
      for (const s of segs) {
        if (s[0] === 'M' || s[0] === 'L') {
          expect(perpDist({ x: s[1], y: s[2] }, p1, p2)).toBeCloseTo(r, 9);
        }
      }

      // Both arcs: radius exactly r, x-rotation 0 (a circle has none),
      // largeArc=0 (a semicircle either way at exactly 180 deg).
      const arcs = segs.filter((s) => s[0] === 'A');
      expect(arcs).toHaveLength(2);
      for (const a of arcs) {
        expect(a[1]).toBeCloseTo(r, 9); // rx
        expect(a[2]).toBeCloseTo(r, 9); // ry
      }

      // Single closed, non-self-intersecting loop with the right total
      // area — a wrong sweep (arcs bulging INTO the capsule instead of
      // away from it) or a bowtie crossing would both produce an area far
      // from this analytic value, not just a slightly-off one.
      const polygon = outlinePolygon(segs);
      const area = Math.abs(shoelaceArea(polygon));
      const expectedArea = len * strokeWidth + Math.PI * r * r;
      expect(area).toBeCloseTo(expectedArea, 1); // ~0.05 abs tolerance, well under a bowtie-sized error
      expect(Math.abs(area - expectedArea) / expectedArea).toBeLessThan(0.01); // and within 1% relative
    });
  }

  it('sweep is verified against sampled arc midpoints, not asserted algebraically: each cap arc bulges AWAY from the line, not back into the capsule body', () => {
    // A horizontal line: the p2-side cap's midpoint must be at x > x2
    // (past the end, not folded back over the capsule), and the p1-side
    // cap's midpoint must be at x < x1.
    const x1 = 0, y1 = 0, x2 = 10, y2 = 0, strokeWidth = 2;
    const { d } = lineOutlinePathD({ x1, y1, x2, y2, strokeWidth, cap: 'round' });
    const segs = parseD(d);
    const arcs = segs.filter((s) => s[0] === 'A');
    // First arc starts at the L2 corner (index 2 in segs: M,L,A,...) — its
    // OWN start point is segs[1] (the preceding L).
    const arc1Start = { x: segs[1][1], y: segs[1][2] };
    const arc1Mid = sampleCubic(arc1Start, arcToCubics(arc1Start, arcs[0])[0], 0.5);
    expect(arc1Mid.x).toBeGreaterThan(x2);

    const arc2Start = { x: segs[3][1], y: segs[3][2] };
    const arc2Mid = sampleCubic(arc2Start, arcToCubics(arc2Start, arcs[1])[0], 0.5);
    expect(arc2Mid.x).toBeLessThan(x1);
  });

  it('zero-length line degenerates to a full circle of radius strokeWidth/2, as two A semicircles (SVG cannot express a full circle in one A)', () => {
    const strokeWidth = 3;
    const r = strokeWidth / 2;
    const { d, unsupported, circles } = lineOutlinePathD({ x1: 5, y1: 5, x2: 5, y2: 5, strokeWidth, cap: 'round' });
    expect(unsupported).toBeNull();
    const segs = parseD(d);
    expect(segs.map((s) => s[0])).toEqual(['M', 'A', 'A', 'Z']);
    const polygon = outlinePolygon(segs);
    const area = Math.abs(shoelaceArea(polygon));
    expect(area).toBeCloseTo(Math.PI * r * r, 1);
    // Every sampled point sits at distance r from the center.
    for (const p of polygon) {
      expect(Math.hypot(p.x - 5, p.y - 5)).toBeCloseTo(r, 2);
    }
    // T45 ADD-ON: this IS a true full circle (two coincident-center
    // semicircle A's) — declared as `circles` so the Fusion export can
    // emit a native <circle> instead of two SketchArcs.
    expect(circles).toEqual([{ cx: 5, cy: 5, r }]);
  });

  it("T45 ADD-ON: a NORMAL (non-zero-length) round-capped line's two caps are genuinely SEPARATE half-circles (different centers) — no `circles` field, left as A (rail/tie caps stay exactly as before)", () => {
    const { circles } = lineOutlinePathD({ x1: 0, y1: 0, x2: 10, y2: 0, strokeWidth: 2, cap: 'round' });
    expect(circles).toBeUndefined();
  });

  it('T44: butt and square are now supported (no longer decline)', () => {
    expect(SUPPORTED_LINE_CAPS.butt).toBe(true);
    expect(SUPPORTED_LINE_CAPS.square).toBe(true);
    expect(SUPPORTED_LINE_CAPS.round).toBe(true);
  });

  it('an unsupported cap (anything other than round/butt/square) still declines explicitly', () => {
    const { d, unsupported } = lineOutlinePathD({ x1: 0, y1: 0, x2: 5, y2: 0, strokeWidth: 1, cap: 'inherit' });
    expect(d).toBeNull();
    expect(unsupported).toBe('inherit');
  });
});

describe('lineOutlinePathD — butt cap (T44): a plain rectangle, no cap extension', () => {
  for (const { name, x1, y1, x2, y2 } of [
    { name: 'horizontal', x1: 0, y1: 0, x2: 10, y2: 0 },
    { name: 'vertical', x1: 3, y1: -2, x2: 3, y2: 8 },
    { name: 'diagonal', x1: -1, y1: -1, x2: 6, y2: 4 },
  ]) {
    it(`${name} line: 4 straight segments, banks exactly width/2 off centerline, area exactly length*strokeWidth (no arcs, no extension)`, () => {
      const strokeWidth = 1.4;
      const r = strokeWidth / 2;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const { d, unsupported } = lineOutlinePathD({ x1, y1, x2, y2, strokeWidth, cap: 'butt' });
      expect(unsupported).toBeNull();
      const segs = parseD(d);
      expect(segs.map((s) => s[0])).toEqual(['M', 'L', 'L', 'L', 'Z']); // no A commands at all

      const p1 = { x: x1, y: y1 }, p2 = { x: x2, y: y2 };
      for (const s of segs) {
        if (s[0] === 'M' || s[0] === 'L') expect(perpDist({ x: s[1], y: s[2] }, p1, p2)).toBeCloseTo(r, 9);
      }
      const area = Math.abs(shoelaceArea(outlinePolygon(segs)));
      expect(area).toBeCloseTo(len * strokeWidth, 6); // exact rectangle, no semicircle terms
    });
  }

  it('zero-length line declines (no direction to build a rectangle from)', () => {
    const { d, unsupported } = lineOutlinePathD({ x1: 5, y1: 5, x2: 5, y2: 5, strokeWidth: 3, cap: 'butt' });
    expect(d).toBeNull();
    expect(unsupported).toBe('zero-length');
  });
});

describe('lineOutlinePathD — square cap (T44): a rectangle extended by w/2 at both ends', () => {
  for (const { name, x1, y1, x2, y2 } of [
    { name: 'horizontal', x1: 0, y1: 0, x2: 10, y2: 0 },
    { name: 'vertical', x1: 3, y1: -2, x2: 3, y2: 8 },
    { name: 'diagonal', x1: -1, y1: -1, x2: 6, y2: 4 },
  ]) {
    it(`${name} line: 4 straight segments, area exactly (length+strokeWidth)*strokeWidth (extended by half the stroke width at EACH end)`, () => {
      const strokeWidth = 1.4;
      const r = strokeWidth / 2;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const { d, unsupported } = lineOutlinePathD({ x1, y1, x2, y2, strokeWidth, cap: 'square' });
      expect(unsupported).toBeNull();
      const segs = parseD(d);
      expect(segs.map((s) => s[0])).toEqual(['M', 'L', 'L', 'L', 'Z']);

      // Extended rectangle: length grows by r at EACH end (2r total), width
      // stays strokeWidth -- area = (len + 2r) * strokeWidth = (len +
      // strokeWidth) * strokeWidth.
      const area = Math.abs(shoelaceArea(outlinePolygon(segs)));
      expect(area).toBeCloseTo((len + strokeWidth) * strokeWidth, 6);

      // Every corner sits exactly r off the (extended) centerline AND the
      // two "far" corners (past each original endpoint) are exactly r
      // further along the line direction than a butt cap's own corner
      // would be -- distinguishes "extended" from "not extended" directly,
      // not just via total area.
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const buttCorner = lineOutlinePathD({ x1, y1, x2, y2, strokeWidth, cap: 'butt' });
      const buttSegs = parseD(buttCorner.d);
      // buttSegs[1] is the L1->L2 bank's far corner (at x2,y2 offset).
      const squareFarCorner = { x: segs[2][1], y: segs[2][2] }; // the L2-side far corner in square's own output
      const buttFarCorner = { x: buttSegs[2][1], y: buttSegs[2][2] };
      const extension = Math.hypot(squareFarCorner.x - buttFarCorner.x, squareFarCorner.y - buttFarCorner.y);
      expect(extension).toBeCloseTo(r, 9);
      // And that extension is ALONG the line direction (parallel to ux,uy),
      // not some other direction.
      const dot = ((squareFarCorner.x - buttFarCorner.x) * ux + (squareFarCorner.y - buttFarCorner.y) * uy) / extension;
      expect(dot).toBeCloseTo(1, 6);
    });
  }

  it('zero-length line declines (no direction to extend along)', () => {
    const { d, unsupported } = lineOutlinePathD({ x1: 5, y1: 5, x2: 5, y2: 5, strokeWidth: 3, cap: 'square' });
    expect(d).toBeNull();
    expect(unsupported).toBe('zero-length');
  });
});

describe('lineOutlinePathD — non-vacuous area check (round cap)', () => {
  it('a self-intersecting (bowtie) loop would fail the area check — constructed directly to prove the check can actually catch it', () => {
    // Swap the two arc endpoints (as a wrong-sweep bug would effectively
    // do) to build a deliberately bowtied version of the horizontal case,
    // and confirm the SAME area check used above rejects it.
    const x1 = 0, y1 = 0, x2 = 10, y2 = 0, strokeWidth = 1.4, r = 0.7, len = 10;
    const bowtieD = `M 0 ${r} L 10 ${r} A ${r} ${r} 0 0 1 10 ${-r} L 0 ${-r} A ${r} ${r} 0 0 1 0 ${r} Z`;
    const segs = parseD(bowtieD);
    const polygon = outlinePolygon(segs);
    const area = Math.abs(shoelaceArea(polygon));
    const expectedArea = len * strokeWidth + Math.PI * r * r;
    expect(Math.abs(area - expectedArea) / expectedArea).toBeGreaterThan(0.01);
  });
});
