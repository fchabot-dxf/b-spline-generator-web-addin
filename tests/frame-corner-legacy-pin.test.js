/**
 * Fred 2026-10-11: a frame PRESET bundles its corner (the Corners picker is retired). A board saved with an explicit
 * `brickSettings.frameCorner` keeps laying byte-identical -- the read stays (frameCornerOf / frameBandsOf), the UI goes.
 * Pinned against digests taken BEFORE the change (fixtures/frame-corner-legacy-digests.json): every corner the picker
 * offered x three presets x two templates x two sizes, through the app's own bands (frameBandsOf). PIN=1 re-pins.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives, frameBandsOf } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const PINNED = 'tests/fixtures/frame-corner-legacy-digests.json';
const CORNERS = ['mitre', 'butt', 'block', 'lapped']; // the retired picker's choices (FRAME_CORNERS ids)
const PRESETS = ['single_soldier', 'mixed_bands', 'three_band'];
const TEMPLATES = ['template_1', 'template_3'];
const W = 7, H = 10, SIZES = [0.75, 1.25], SET = BRICK_SETS[0];

function digest(tpl, preset, corner, L) {
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
  const bands = frameBandsOf({ frameBandPreset: preset, frameCorner: corner, frameBandPatterns: [] });
  const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1, scale: L / SET.brickLengthIn,
    suppression: 0, clumping: 0, frame: { primitives: buildRibbonPrimitives(sil.primitives), bands } });
  const hash = (x) => createHash('sha1').update(JSON.stringify(x)).digest('hex');
  return `${r.frameBricks.length}/${r.bricks.length}:${hash(r.frameBricks)}:${hash(r.bricks)}`;
}

describe('a board saved with an explicit frame corner lays exactly as before the Corners picker went', () => {
  it.each(TEMPLATES)('%s, 7x10, every corner x preset x size', (tpl) => {
    const got = {};
    for (const preset of PRESETS) for (const corner of CORNERS) for (const L of SIZES) got[`${tpl} ${preset} ${corner} ${L}`] = digest(tpl, preset, corner, L);
    let pinned = {};
    try { pinned = JSON.parse(readFileSync(PINNED, 'utf8')); } catch (_) { /* first pin */ }
    if (process.env.PIN === '1') { writeFileSync(PINNED, JSON.stringify({ ...pinned, ...got }, null, 1) + '\n'); pinned = { ...pinned, ...got }; }
    for (const k of Object.keys(got)) expect(got[k], k).toBe(pinned[k]);
  });
});
