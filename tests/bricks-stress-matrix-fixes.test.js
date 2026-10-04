/**
 * T86 item 4 (brick frames on every template -- stress matrix + fix by failure class): regression
 * coverage for the engine bugs the matrix itself found, each reproduced on the REAL template that
 * surfaced it (not a synthetic case retrofitted after the fact).
 *
 * (1) lineCircleIntersections' own tangent-tolerance fix has its direct unit coverage in
 *     tests/bricks-curve-intersect.test.js already -- not duplicated here.
 * (2) voussoirPieces' own isVeryFirst/isVeryLast float-drift fix (template_2, "Narrow Neck": a line
 *     tangent to its own neighbouring arc).
 * (3) buildButtJoint's own concave-corner fallback (template_9, "I Shape": a genuine reflex corner
 *     at the waist, where the butt-cut construction built for convex corners has no valid cut).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { inwardSignFor } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { radialSignAt } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/arc-voussoir.js';

const SET = BRICK_SETS[0];

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

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

describe('voussoirPieces: a tangent line-arc corner no longer lets a row run unbounded (T86 item 4)', () => {
  it('template_2 ("Narrow Neck") 7x9, single_soldier: every piece stays within the established 1.2x ceiling', () => {
    // HAND-VERIFIED (scratch/render_t2_failure.mjs, before this fix): the row adjacent to the
    // tangent corner built one 36-vertex piece spanning TWO arcs' own territory, 7.7x nominal area.
    const primitives = templatePrimitives('template_2', 7, 9);
    const { bricks } = bricksContourBands(primitives, FRAME_PRESETS.single_soldier, { set: SET, seed: 7 });
    const nominal = SET.brickHeightIn * SET.brickLengthIn;
    let maxRatio = 0;
    for (const b of bricks) maxRatio = Math.max(maxRatio, Math.abs(signedArea(b.polygon)) / nominal);
    expect(maxRatio, 'worst piece/nominal ratio').toBeLessThan(1.2 + 1e-6);
  });
});

describe('buildButtJoint: a concave corner falls back to mitre instead of building an empty piece (T86 item 4)', () => {
  it('template_9 ("I Shape") 7x9, single_soldier forced to cornerStyle="butt": no piece is empty or near-zero area', () => {
    // HAND-VERIFIED (scratch/render_t9_failure.mjs, before this fix): the waist's own reflex corner
    // produced a literal zero-vertex, zero-area piece (the butt-cut construction built for convex
    // corners found no valid cut location, but still returned a joint instead of falling back).
    const primitives = templatePrimitives('template_9', 7, 9);
    const bands = FRAME_PRESETS.single_soldier.map((b) => ({ ...b, cornerStyle: 'butt' }));
    const { bricks } = bricksContourBands(primitives, bands, { set: SET, seed: 7 });
    const nominal = SET.brickHeightIn * SET.brickLengthIn;
    let minRatio = Infinity;
    for (const b of bricks) {
      expect(b.polygon.length, `${b.id} has a real polygon`).toBeGreaterThanOrEqual(3);
      minRatio = Math.min(minRatio, Math.abs(signedArea(b.polygon)) / nominal);
    }
    expect(minRatio, 'worst piece/nominal ratio').toBeGreaterThan(0.25 - 1e-6);
  });
});
