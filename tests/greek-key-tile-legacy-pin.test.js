/**
 * Fred 2026-10-17 (via the advisor): the Greek key mosaic's own tiles shrank to 0.75 of their size (narrow wood
 * frames). A board saved on greek_key_mosaic before this has no frameBandTileFactor key, so the 'greek-key-tile-
 * legacy-1x' migration (app-init.js) pins it to 1 -- its own old size -- and it keeps laying byte-identical.
 * tileFactor 1 is a complete no-op in the engine (contour-bands.js planBands: bL/bH === L/H exactly when tf is
 * null/1), so the digest below IS the pre-change geometry, just reached through the new override path instead of
 * the old unconditional one. PIN=1 re-pins (first pin: taken on this exact state).
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
import { runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const PINNED = 'tests/fixtures/greek-key-tile-legacy-digests.json';
const TEMPLATES = ['template_1', 'template_18'];
const SIZES = [0.75, 1];
const SET = BRICK_SETS[0];

/** A board saved on greek_key_mosaic before frameBandTileFactor existed -- no key at all (a load replaces
 *  brickSettings whole, never backfilled from DEFAULT), run through the real migration. */
function legacyBoardBands() {
  const p = { brickSettings: { frameBandPreset: 'greek_key_mosaic', frameBandPatterns: [] } };
  runMigrations(p);
  return frameBandsOf(p.brickSettings);
}
/** A board saved AFTER (frameBandTileFactor already an array, even empty) -- untouched, gets the new 0.75 default. */
function freshBoardBands() {
  const p = { brickSettings: { frameBandPreset: 'greek_key_mosaic', frameBandPatterns: [], frameBandTileFactor: [] } };
  runMigrations(p);
  return frameBandsOf(p.brickSettings);
}
function digest(tpl, W, H, L, bandsFn) {
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
  const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1, scale: L / SET.brickLengthIn,
    suppression: 0, clumping: 0, frame: { primitives: buildRibbonPrimitives(sil.primitives), bands: bandsFn() } });
  const hash = (x) => createHash('sha1').update(JSON.stringify(x)).digest('hex');
  return `${r.frameBricks.length}/${r.bricks.length}:${hash(r.frameBricks)}:${hash(r.bricks)}`;
}

describe('a board saved on greek_key_mosaic before tileFactor lays exactly as before (its own old tile size)', () => {
  it.each(TEMPLATES)('%s, 9x12, legacy vs fresh, every size', (tpl) => {
    const got = {};
    for (const L of SIZES) {
      got[`${tpl} 9x12 ${L} legacy`] = digest(tpl, 9, 12, L, legacyBoardBands);
      got[`${tpl} 9x12 ${L} fresh`] = digest(tpl, 9, 12, L, freshBoardBands);
    }
    let pinned = {};
    try { pinned = JSON.parse(readFileSync(PINNED, 'utf8')); } catch (_) { /* first pin */ }
    if (process.env.PIN === '1') { writeFileSync(PINNED, JSON.stringify({ ...pinned, ...got }, null, 1) + '\n'); pinned = { ...pinned, ...got }; }
    for (const k of Object.keys(got)) expect(got[k], k).toBe(pinned[k]);
    // a legacy board must NOT equal a fresh one -- proof the pin is actually exercising the override, not a no-op
    for (const L of SIZES) expect(got[`${tpl} 9x12 ${L} legacy`]).not.toBe(got[`${tpl} 9x12 ${L} fresh`]);
  });
});
