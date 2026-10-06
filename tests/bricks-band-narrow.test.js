/**
 * T86 item 30 (Fred's item 28 ruling, "make the app do the best result"; advisor (b')): a SINGLE band too deep for a
 * feature of the board is laid narrowed to fit it, instead of stranding fans and leaving the feature bare. Fixture: the
 * T9 outline seat A's item 89 harness happened to draw with 1.82 in flanges (tests/fixtures/t9-thick-flange-silhouette.json,
 * the app's own silhouette primitives). MEASURED before: a 1 in band laid the flange ends as nothing but fans stranded
 * at the four board corners, 6.15 sq in of flange bare; the cliff is half the flange (0.91 in). Narrowing is LOCAL --
 * only a line lying between two lines that drops at the row's depth triggers it. MEASURED over 2,052 lays (19 templates x
 * 9 presets x 0.75-1.5 in x 6x9 / 7x9 / 9x12): 36 narrow, all T6 / T9 / T15 at 1.25-1.5 in on 6x9 / 7x9, none at 0.75 / 1 in
 * or on 9x12; their bare band ground went from up to 8.8 sq in to 0. The consumed feature leaves the wall a sliver
 * (a skeleton, a tapering neck spike) that bondLayout laid over the band -- the wall boundary sits half a joint past it.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0];
const T9_THICK = buildRibbonPrimitives(JSON.parse(fs.readFileSync('tests/fixtures/t9-thick-flange-silhouette.json', 'utf-8')));
const lay = (prims, preset, L) => bricksContourBands(prims, FRAME_PRESETS[preset], { set: SET, seed: 1, scale: L / SET.brickLengthIn });
function distTo(x, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
  }
  return best;
}
/** bare flange ground, sq in: grid points in the flanges (y < 2.07 or > 6.93), inside the board, outside the wall's
 *  outline, farther than a joint and a half from every band piece */
function bareFlange({ bricks, innerPath }) {
  const board = T9_THICK.map((p) => p.p0), STEP = 0.04, reach = 1.5 * SET.grout.widthIn;
  let n = 0;
  for (let x = 0.27; x < 6.75; x += STEP) for (const [y0, y1] of [[0.27, 2.06], [6.94, 8.74]]) for (let y = y0; y < y1; y += STEP) {
    if (!pointInPolygon(x, y, board) || (innerPath.length >= 3 && pointInPolygon(x, y, innerPath))) continue;
    if (!bricks.some((b) => pointInPolygon(x, y, b.polygon) || distTo(x, y, b.polygon) <= reach)) n++;
  }
  return n * STEP * STEP;
}

describe('a single band too deep for a feature narrows to fit it (T86 item 30)', () => {
  for (const preset of ['single_soldier', 'double_course']) {
    it(`T9 with 1.82 in flanges, ${preset} at 1 in: narrowed (noted), no bare flange`, () => {
      const r = lay(T9_THICK, preset, 1);
      const narrow = r.bandsReduced && r.bandsReduced.steps.find((s) => s.step === 'narrow');
      expect(narrow, 'a narrow step in the note').toBeTruthy();
      expect(narrow.toIn).toBeGreaterThan(0.8); // the deepest that lays, less a joint: just under half the 1.82 in flange
      expect(narrow.toIn).toBeLessThan(0.91);
      expect(bareFlange(r)).toBeLessThan(0.01);
    });
  }

  it('the regular templates never narrow (the narrowing is local): T1 / T5 / T8 / T18 at 1.25 in, single_soldier', () => {
    for (const id of ['template_1', 'template_5', 'template_8', 'template_18']) {
      const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: id }), board: { widthIn: 7, heightIn: 9 } }, 0, 0);
      const r = lay(buildRibbonPrimitives(sil.primitives), 'single_soldier', 1.25);
      expect((r.bandsReduced ? r.bandsReduced.steps : []).some((s) => s.step === 'narrow'), id).toBe(false);
    }
  });

  // a consumed feature leaves the wall a sliver: T15 / T6's tapering neck a spike under 0.01 in wide, T9's web a 0.018 in
  // skeleton. MEASURED before the wall boundary moved half a joint past the cliff: wall cells over the band 0.03-0.54 sq in.
  for (const [id, W, H] of [['template_15', 7, 9], ['template_15', 6, 9], ['template_6', 6, 9], ['template_9', 7, 9]]) {
    it(`${id} ${W}x${H} single_soldier at 1.5 in: narrowed, and no wall cell over the band`, () => {
      const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: id }), board: { widthIn: W, heightIn: H } }, 0, 0);
      const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1, scale: 1.5 / SET.brickLengthIn,
        suppression: 0, clumping: 0, frame: { primitives: buildRibbonPrimitives(sil.primitives), bands: FRAME_PRESETS.single_soldier } });
      expect(r.bandsReduced.steps.some((s) => s.step === 'narrow')).toBe(true);
      let over = 0;
      for (const w of r.bricks) for (const f of r.frameBricks) { const x = polygonIntersection(w.polygon, f.polygon); if (x.length >= 3) over += Math.abs(signedArea(x)); }
      expect(over).toBeLessThan(0.01);
    });
  }
});
