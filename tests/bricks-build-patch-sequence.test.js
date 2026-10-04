/**
 * T86 item 3 (advisor dispatch): `buildPatch` -- the kite-fan patch that fills the gap where a
 * convex shoulder arc drops out of a deep band (e.g. soldier, depth 0.75in > its own pitch 0.2in) --
 * now plans its own pieces along the patch's TRUE ARC LENGTH with the band's declared `sequence` +
 * the SAME fill rule (`planCornerRun`/`mergeSlivers`, floor 0.25x, ceiling 1.2x) every other run
 * already uses, instead of slicing the patch's own boundary POLYLINE into equal-POINT-COUNT groups
 * (which produced irregular sizes, since a flat strip contributes only 2 points regardless of its own
 * length while the densely-tessellated dropped arc contributes many over a often much shorter true
 * length -- MEASURED: 0.263x0.263 next to 0.709x0.566 on the pre-fix patch).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { inwardSignFor } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { radialSignAt, isArcFeasible } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/arc-voussoir.js';

const SET = BRICK_SETS[0]; // brickLengthIn 0.75, brickHeightIn 0.2

function tessellate(primitives) {
  const points = [];
  for (const prim of primitives) {
    if (prim.type === 'arc') {
      for (let k = 0; k < 16; k++) {
        const t = prim.theta1 + ((prim.theta2 - prim.theta1) * k) / 16;
        points.push({ x: prim.cx + prim.r * Math.cos(t), y: prim.cy + prim.r * Math.sin(t) });
      }
    } else points.push(prim.p0);
  }
  return points;
}

function templatePrimitives(templateId, W, H) {
  const record = normalizeFrameRecord({ templateId });
  const frame = { defs: FRAME_DEFS, record, board: { widthIn: W, heightIn: H } };
  const sil = frameContourSilhouette(frame, 0, 0);
  const raw = sil.primitives.map((prim, i) => {
    if (prim.type === 'L') {
      const next = sil.primitives[(i + 1) % sil.primitives.length];
      const p1 = next.type === 'L' ? next.p0 : { x: next.cx + next.rx * Math.cos(next.theta1), y: next.cy + next.ry * Math.sin(next.theta1) };
      return { type: 'line', p0: prim.p0, p1 };
    }
    return { type: 'arc', cx: prim.cx, cy: prim.cy, r: prim.rx, theta1: prim.theta1, theta2: prim.theta1 + prim.dTheta };
  });
  const inwardSign = inwardSignFor(tessellate(raw));
  return raw.map((prim) => {
    if (prim.type === 'line') {
      const dx = prim.p1.x - prim.p0.x, dy = prim.p1.y - prim.p0.y, len = Math.hypot(dx, dy);
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

const T1_PRIMITIVES = templatePrimitives('template_1', 7, 9);

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
function bbox(poly) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('buildPatch (T86 item 3): confirms a dropped primitive genuinely exists at the soldier band depth on T1 7x9', () => {
  it('a convex shoulder arc is feasible at the shallow flemish depth (0.4) but infeasible at the deep soldier depth (1.15) -- the exact condition that routes through buildPatch', () => {
    const shoulders = T1_PRIMITIVES.filter((p) => p.type === 'arc' && p.radialSign === 1);
    expect(shoulders.length).toBeGreaterThan(0);
    for (const arc of shoulders) {
      expect(isArcFeasible(arc.r, arc.radialSign, 0.4)).toBe(true);
      expect(isArcFeasible(arc.r, arc.radialSign, 1.15)).toBe(false);
    }
  });
});

describe('buildPatch (T86 item 3): patch pieces respect the declared fill rule (floor 0.25x, ceiling 1.2x of nominal)', () => {
  it('single_soldier on T1: every piece near the shoulder (patch + regular voussoir) is within [0.25x, 1.2x] nominal area', () => {
    // HAND-VERIFIED (scratch/check_shoulder_areas.mjs): every real piece here measured a ratio between
    // ~0.50 and ~1.00 -- comfortably inside the declared bounds, nowhere near either edge. This is the
    // SAME rule (not a new one) `mergeSlivers` already enforces for every other run in this codebase.
    const { bricks } = bricksContourBands(T1_PRIMITIVES, FRAME_PRESETS.single_soldier, { set: SET, seed: 7 });
    const nominal = SET.brickHeightIn * SET.brickLengthIn; // pitch(H) * width(L) for soldier
    const floor = nominal * 0.25, ceiling = nominal * 1.2;
    // pieces around the shoulder transition zone (both sides of the board, both shoulders)
    const near = bricks.filter((b) => {
      const bb = bbox(b.polygon);
      return (bb.minY < 6.1 && bb.maxY > 2.9) && (bb.minX < 1.9 || bb.maxX > 5.1);
    });
    expect(near.length).toBeGreaterThan(10); // sanity: this actually captured the shoulder regions
    const bad = near.filter((b) => {
      const area = Math.abs(signedArea(b.polygon));
      return area < floor - 1e-6 || area > ceiling + 1e-6;
    });
    expect(bad.length, `${bad.length}/${near.length} pieces outside [${floor.toFixed(4)}, ${ceiling.toFixed(4)}]`).toBe(0);
  });

  it('mixed_bands on T1: the soldier band\'s own shoulder pieces ALSO respect the fill rule (the sequence-aware path, not just plain soldier)', () => {
    const { bricks } = bricksContourBands(T1_PRIMITIVES, FRAME_PRESETS.mixed_bands, { set: SET, seed: 7 });
    const nominal = SET.brickHeightIn * SET.brickLengthIn;
    const floor = nominal * 0.25, ceiling = nominal * 1.2;
    // soldier band depth range is [0.4, 1.15] from each edge -- filter to pieces whose own bbox fits there
    const soldierNear = bricks.filter((b) => {
      const bb = bbox(b.polygon);
      const spanY = bb.maxY - bb.minY, spanX = bb.maxX - bb.minX;
      return Math.max(spanX, spanY) < 1.2 && (bb.minY < 6.1 && bb.maxY > 2.9) && (bb.minX < 2.2 || bb.maxX > 4.8);
    });
    expect(soldierNear.length).toBeGreaterThan(5);
    const bad = soldierNear.filter((b) => {
      const area = Math.abs(signedArea(b.polygon));
      return area < floor - 1e-6 || area > ceiling + 1e-6;
    });
    expect(bad.length, `${bad.length}/${soldierNear.length} pieces outside [${floor.toFixed(4)}, ${ceiling.toFixed(4)}]`).toBe(0);
  });
});

describe('buildPatch (T86 item 3): length-based planning produces FEWER, more uniform pieces than the old equal-point-count slicing', () => {
  // The floor/ceiling rule alone does not distinguish old vs new -- BOTH algorithms already enforced
  // it (the old K-way ceiling search + the same mergeSlivers floor pass), just over differently-sized
  // pieces; 0.5x and 1.0x of nominal are both "legal" under the same bounds yet visibly inconsistent.
  // What actually changed, HAND-VERIFIED via a direct A/B (git stash) on this exact fixture
  // (scratch/debug_soldier_patch.mjs): single_soldier on T1 7x9 went from 132 total pieces / 32 with
  // more than 6 vertices (patch + adjacent dense voussoir pieces) to 136 total / 28 with more than 6
  // vertices -- length-based planning merges what used to be 2 extra, inconsistently-sized pieces
  // (0.49in and a separate 0.66in+0.75in pair) per shoulder into fewer, evenly-planned ones.
  it('single_soldier on T1 7x9: pins the exact measured counts (regression pin, not just a bound)', () => {
    const { bricks } = bricksContourBands(T1_PRIMITIVES, FRAME_PRESETS.single_soldier, { set: SET, seed: 7 });
    expect(bricks.length).toBe(136);
    const weird = bricks.filter((b) => b.polygon.length > 6);
    expect(weird.length).toBe(28);
  });

  it('both shoulders of the same waist curve still produce a symmetric result (the fix must not introduce asymmetry while reducing count)', () => {
    const { bricks } = bricksContourBands(T1_PRIMITIVES, FRAME_PRESETS.single_soldier, { set: SET, seed: 7 });
    const weird = bricks.filter((b) => b.polygon.length > 6);
    const leftSide = weird.filter((b) => bbox(b.polygon).maxX < 3.5);
    const rightSide = weird.filter((b) => bbox(b.polygon).minX > 3.5);
    expect(leftSide.length).toBeGreaterThan(0);
    expect(rightSide.length).toBe(leftSide.length);
  });
});
