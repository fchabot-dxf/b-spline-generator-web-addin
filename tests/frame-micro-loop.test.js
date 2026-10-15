/**
 * Seat E 2026-10-14 (advisor: main's new corbelled_cornice laid a frame piece that crosses itself, T8 9x12 1.25 in): a
 * corbel-table row's start cut meeting the corner fan left a 0.02 in bow tie on the end of a band-1 piece. A frame piece
 * whose outline crosses itself in a grout-wide fleck of a loop has the loop cut off (geometry.js untangleMicroLoops,
 * applied to the laid pieces in contour-bands.js); every simple piece is laid exactly as before.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { isSimplePolygon, signedArea, untangleMicroLoops } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { MOTIF_FLECK_SQIN } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/band-motif.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const P = (pts) => pts.map(([x, y]) => ({ x, y }));

describe('untangleMicroLoops', () => {
  it('cuts a fleck of a bow tie off at its crossing; the rest of the outline unchanged', () => {
    // the measured piece (T8 9x12 1.25 in corbelled_cornice, band 1 row 0, to 3 decimals): its end folds back in a 0.02 in loop
    const tied = P([[6.656,1.112], [6.476,0.912], [6.537,0.860], [6.622,0.801], [6.711,0.748], [6.803,0.703], [6.900,0.666], [6.999,0.637], [7.100,0.616], [7.202,0.604], [7.283,0.601], [7.283,0.900], [6.932,0.900], [6.932,0.974], [6.923,0.978], [6.852,1.012], [6.784,1.052], [6.720,1.097], [6.677,1.134], [6.657,1.113], [6.666,1.097], [6.672,1.104]]);
    expect(isSimplePolygon(tied)).toBe(false);
    const out = untangleMicroLoops(tied, MOTIF_FLECK_SQIN);
    expect(isSimplePolygon(out)).toBe(true);
    expect(Math.abs(Math.abs(signedArea(out)) - Math.abs(signedArea(tied)))).toBeLessThan(MOTIF_FLECK_SQIN);
    expect(out.length).toBeLessThan(tied.length);
  });
  it('a simple polygon, or a fold whose both sides are larger than a fleck, comes back as given', () => {
    const square = P([[0, 0], [1, 0], [1, 1], [0, 1]]);
    expect(untangleMicroLoops(square, MOTIF_FLECK_SQIN)).toBe(square);
    const bowtie = P([[0, 0], [1, 1], [1, 0], [0, 1]]); // two 0.25 sq in halves
    expect(untangleMicroLoops(bowtie, MOTIF_FLECK_SQIN)).toBe(bowtie);
  });
});

describe('the laid frame: no piece crosses itself', () => {
  it.each([['template_8', 9, 12, 1.25, 'corbelled_cornice'], ['template_8', 9, 12, 1.25, 'corbelled_cornice_quoin']])('%s %ix%i %s in %s', (tpl, W, H, L, preset) => {
    const SET = BRICK_SETS[0];
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
    const bands = FRAME_PRESETS[preset].map((b) => ({ ...b, cornerStyle: 'block' }));
    const r = generateBricks({ boardOutline: P([[0, 0], [W, 0], [W, H], [0, H]]), set: SET, scale: L / SET.brickLengthIn, seed: 1, suppression: 0, clumping: 0,
      frame: { primitives: buildRibbonPrimitives(sil.primitives), bands } });
    expect(r.frameBricks.filter((b) => !isSimplePolygon(b.polygon)).length).toBe(0);
  });
});
