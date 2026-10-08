/**
 * T86 item 16b-REOPENED (advisor's size sheet v2: "the wall drops bricks at 1.25 in and up"): re-measured on main
 * 7f862c5 (seat E, 2026-10-07) over every template x 0.75 / 1 / 1.25 / 1.5 in, 7x9, a single soldier band:
 *  - the wall covers its own region (generateBricks interiorOutline) at >= 99.0 % of the bond's ideal share
 *    L*H / ((L+J)(H+J)) in all 76 lays -- no dropped courses; what shrinks with the size is the REGION (the soldier
 *    band's depth is the brick length: T1 30.5 -> 13.6 sq in from 0.75 to 1.5 in);
 *  - bare board ground (inside the contour, in no brick, more than a joint from every brick) is <= 0.18 sq in per lay;
 *  - T9 at 1.5 in has NO wall interior: the band covers the board (0.15 sq in bare) -- a single band is laid as
 *    requested by the declared fit rule (contour-bands.js fitBandStack: the outermost band is never reduced).
 * This matrix pins all three.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { tess, bareGroundScan, bareGround as bareGroundOf, PATCH_MAX_FACE, PATCH_KNOWN } from './bare-ground.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0];
const W = 7, H = 9;
const SIZES = [0.75, 1, 1.25, 1.5];
const TEMPLATES = FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k));
/** the declared bars (measured worst + margin): wall share of its region vs the bond's ideal, bare ground per lay */
const COVER_MIN_RATIO = 0.98, REGION_MIN_SQIN = 1, BARE_MAX_SQIN = 0.3;
const BOARD = { W, H };
/** where the single soldier band covers the board and no wall interior remains (measured) */
const NO_WALL_ROOM = new Set(['template_9 1.5']);
/** T86 item 16(d): the largest single bare patch is <= PATCH_MAX_FACE of one brick face (tests/bare-ground.js). T15 / T9 at
 *  1.5 in (a 2.6-joint seam where a narrowed band met its facing row) are fixed (contour-bands narrowSingleBand: the run
 *  at the row edge is one joint). The known larger patches: bare-ground.js PATCH_KNOWN (T16 1.5 in). */

const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const bareSqInScan = (contour, bricks, J) => bareGroundScan(contour, bricks, J, BOARD);
const bareGround = (contour, bricks, J) => bareGroundOf(contour, bricks, J, BOARD);
const bareSqIn = (contour, bricks, J) => bareGround(contour, bricks, J).sqIn;

const LAY_BOARD = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const contourCache = new Map();
/** a template's Wall contour (single soldier band), once per template */
function contourOf(tpl) {
  if (!contourCache.has(tpl)) {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
    const prims = buildRibbonPrimitives(sil.primitives);
    contourCache.set(tpl, { prims, contour: tess(prims) });
  }
  return contourCache.get(tpl);
}
const layAt = (prims, L) => generateBricks({ boardOutline: LAY_BOARD, set: SET, seed: 1, scale: L / SET.brickLengthIn, suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS.single_soldier } });

describe('T86 item 16b-REOPENED: the wall covers its region at every size; no bare ground (single soldier, 7x9)', () => {
  // one case per template x size (was one per template, 4 sizes: the same lays and checks, each case a quarter)
  it.each(TEMPLATES.flatMap((tpl) => SIZES.map((L) => [tpl, L])))('%s at %s in', (tpl, L) => {
    const { prims, contour } = contourOf(tpl);
    const s = scaledSet(SET, L / SET.brickLengthIn), J = s.grout.widthIn;
    const ideal = (s.brickLengthIn * s.brickHeightIn) / ((s.brickLengthIn + J) * (s.brickHeightIn + J));
    const r = layAt(prims, L);
    const region = area(r.interiorOutline), wall = r.bricks.reduce((t, b) => t + area(b.polygon), 0);
    const tag = `${tpl} ${L}`;
    if (NO_WALL_ROOM.has(tag)) expect(r.bricks.length, tag).toBe(0);
    else if (region >= REGION_MIN_SQIN) expect(wall / region / ideal, `${tag}: wall share of its region vs the ideal`).toBeGreaterThanOrEqual(COVER_MIN_RATIO);
    const bare = bareGround(contour, [...r.frameBricks, ...r.bricks], J);
    expect(bare.sqIn, `${tag}: bare ground sq in`).toBeLessThanOrEqual(BARE_MAX_SQIN);
    const face = s.brickLengthIn * s.brickHeightIn;
    expect(bare.largestSqIn / face, `${tag}: largest bare patch, share of one brick face`).toBeLessThanOrEqual(PATCH_KNOWN[`${tpl} ${W}x${H} ${L}`] ?? PATCH_MAX_FACE);
  });
  // the bucketed count IS the reference scan's (a curved waist, a template with no wall room, and a lay with a hole
  // punched in it so the bare count is not 0)
  it.each([['template_1', 1], ['template_9', 1.5], ['template_5', 0.75]])('bareSqIn equals the reference scan: %s at %s in', (tpl, L) => {
    const { prims, contour } = contourOf(tpl);
    const J = scaledSet(SET, L / SET.brickLengthIn).grout.widthIn;
    const r = layAt(prims, L);
    const all = [...r.frameBricks, ...r.bricks];
    const holed = all.filter((_, i) => i % 7 !== 3);
    expect(bareSqIn(contour, all, J)).toBe(bareSqInScan(contour, all, J));
    const bare = bareSqIn(contour, holed, J);
    expect(bare).toBeGreaterThan(0);
    expect(bare).toBe(bareSqInScan(contour, holed, J));
  });
});
