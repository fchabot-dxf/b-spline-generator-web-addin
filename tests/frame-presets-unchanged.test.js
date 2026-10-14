/**
 * Frame motifs phase 1 (2026-10-10): the band MOTIF (library.js BAND_MOTIFS) and the 6 motif presets are additive -- every
 * frame preset that existed before them lays EXACTLY as on origin/main 82520dd, frame pieces AND the wall inside them.
 * Pinned against digests taken from that code BEFORE the change (fixtures/frame-presets-main-digests.json): each old preset
 * on a 7x10 rectangle, template_1 (hourglass), template_18 and template_5 (7x10), at 0.75 and 1.25 in. PIN=1 re-pins.
 * Re-pinned 2026-10-11 (seat E) on origin/main edd4f68: quoin-l-blocks clears the wall from a quoin that reaches into it
 * -- the four quoin_corners 0.75 in digests changed in their WALL half only (frame halves identical).
 * Re-pinned again (seat E, curve-quoin): T18 quoin_corners 0.75 / 1.25 only -- its arched top now takes the curved block
 * (and again for Fred's resize: the curved block matches the square quoin's area, CURVE_QUOIN_ARC.areaOfSquare).
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const PINNED = 'tests/fixtures/frame-presets-main-digests.json';
/** the presets on origin/main 82520dd, before the motif presets */
const OLD_PRESETS = ['none', 'single_soldier', 'soldier_stretcher', 'three_band', 'butt_frame', 'quoin_corners', 'double_course', 'header_band', 'mixed_bands'];
const W = 7, H = 10, SIZES = [0.75, 1.25], SET = BRICK_SETS[0];
const BOARDS = ['rect', 'template_1', 'template_18', 'template_5'];

function primitivesOf(board) {
  if (board === 'rect') return buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: W, y2: H }));
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: board }), board: { widthIn: W, heightIn: H } }, 0, 0);
  return buildRibbonPrimitives(sil.primitives);
}

function digest(board, preset, L) {
  const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1, scale: L / SET.brickLengthIn,
    suppression: 0, clumping: 0, frame: { primitives: primitivesOf(board), bands: FRAME_PRESETS[preset] } });
  const hash = (x) => createHash('sha1').update(JSON.stringify(x)).digest('hex');
  return `${r.frameBricks.length}/${r.bricks.length}:${hash(r.frameBricks)}:${hash(r.bricks)}`;
}

describe('every pre-motif frame preset lays exactly as on origin/main', () => {
  it.each(BOARDS)('%s, 7x10, every old preset at 0.75 and 1.25 in', (board) => {
    const got = {};
    for (const preset of OLD_PRESETS) for (const L of SIZES) got[`${board} ${preset} ${L}`] = digest(board, preset, L);
    let pinned = {};
    try { pinned = JSON.parse(readFileSync(PINNED, 'utf8')); } catch (_) { /* first pin */ }
    if (process.env.PIN === '1') { writeFileSync(PINNED, JSON.stringify({ ...pinned, ...got }, null, 1) + '\n'); pinned = { ...pinned, ...got }; }
    for (const k of Object.keys(got)) expect(got[k], k).toBe(pinned[k]);
  });
});
