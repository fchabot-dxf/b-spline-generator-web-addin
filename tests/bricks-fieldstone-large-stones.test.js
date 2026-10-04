/**
 * T86 item 17 (Fred, on the White rocks v3 preview: "Wow" / "slider for more or less large ones"):
 * `fieldstoneLayout`'s own new `largeStones` parameter (0..1, default 0.5 = today's declared
 * 50/35/15 split, unchanged) moves the large tier's own target area share along a declared range,
 * via `gateAreaSharesFor` -- the SAME radius^2 point-count rule the default calibration already
 * used, re-derived for any target rather than a separate hand-tuned table per slider value (see
 * fieldstone.js's own header on `GATE_CORRECTION` for why a pure r^-2 formula alone doesn't land on
 * the measured-correct default, and why a constant per-tier correction, not a per-value table, is
 * the declared fix).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { fieldstoneLayout } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/layouts/fieldstone.js';

function realContour(templateId, widthIn, heightIn) {
  const record = normalizeFrameRecord({ templateId });
  const frame = { defs: FRAME_DEFS, record, board: { widthIn, heightIn } };
  const sil = frameContourSilhouette(frame, 0, 0);
  const primitives = buildRibbonPrimitives(sil.primitives);
  return { primitives };
}
function totalOverlapArea(cells) {
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const inter = polygonIntersection(cells[i].polygon, cells[j].polygon);
      if (inter.length >= 3) total += Math.abs(signedArea(inter));
    }
  }
  return total;
}
function unionCoverage(innerPath, cells) {
  const xs = innerPath.map((p) => p.x), ys = innerPath.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const GRID = 60;
  let total = 0, covered = 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = minX + ((maxX - minX) * (i + 0.5)) / GRID, y = minY + ((maxY - minY) * (j + 0.5)) / GRID;
      if (!pointInPolygon(x, y, innerPath)) continue;
      total++;
      if (cells.some((c) => pointInPolygon(x, y, c.polygon))) covered++;
    }
  }
  return total > 0 ? covered / total : 1;
}
function largeAreaShare(innerPath, SET, seeds, largeStones) {
  let largeArea = 0, totalArea = 0;
  for (const seed of seeds) {
    const { cells } = fieldstoneLayout(innerPath, SET, null, seed, largeStones);
    for (const c of cells) {
      const a = Math.abs(signedArea(c.polygon));
      totalArea += a;
      if (c.tier === 'large') largeArea += a;
    }
  }
  return totalArea > 0 ? largeArea / totalArea : 0;
}

const SET = BRICK_SETS[0]; // Red brick
const SEEDS = [1, 2, 3];

describe('fieldstoneLayout (T86 item 17): largeStones moves the large-tier area share', () => {
  const { primitives } = realContour('template_1', 7, 9);
  const { innerPath } = bricksContourBands(primitives, FRAME_PRESETS.single_soldier, { set: SET, seed: 1 });

  it('the measured large-tier area share increases monotonically across 0, 0.25, 0.5, 0.75, 1', () => {
    const values = [0, 0.25, 0.5, 0.75, 1];
    const shares = values.map((v) => largeAreaShare(innerPath, SET, SEEDS, v));
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i], `shares: ${shares.map((s) => s.toFixed(3)).join(', ')}`).toBeGreaterThan(shares[i - 1]);
    }
  });

  it('largeStones=0.5 (the default) reproduces the pre-item-17 declared calibration (within the existing +/-10 point tolerance)', () => {
    const share = largeAreaShare(innerPath, SET, SEEDS, 0.5) * 100;
    const shareOmitted = largeAreaShare(innerPath, SET, SEEDS, undefined) * 100;
    expect(shareOmitted).toBeCloseTo(share, 6); // omitted === explicit 0.5, same default
    expect(share).toBeGreaterThanOrEqual(40);
    expect(share).toBeLessThanOrEqual(60);
  });

  it.each([0, 0.5, 1])('largeStones=%s: zero pairwise overlap, reasonable union coverage, no crash', (largeStones) => {
    let worstOverlapPct = 0, coverages = [];
    for (const seed of SEEDS) {
      const { cells } = fieldstoneLayout(innerPath, SET, null, seed, largeStones);
      expect(cells.length).toBeGreaterThan(0);
      const totalArea = cells.reduce((s, c) => s + Math.abs(signedArea(c.polygon)), 0);
      const overlap = totalOverlapArea(cells);
      worstOverlapPct = Math.max(worstOverlapPct, totalArea > 0 ? (overlap / totalArea) * 100 : 0);
      coverages.push(unionCoverage(innerPath, cells));
    }
    expect(worstOverlapPct).toBeLessThan(0.05);
    const avgCoverage = coverages.reduce((a, b) => a + b, 0) / coverages.length;
    expect(avgCoverage, `coverages: ${coverages.map((c) => c.toFixed(3)).join(', ')}`).toBeGreaterThanOrEqual(0.85);
  });
});
