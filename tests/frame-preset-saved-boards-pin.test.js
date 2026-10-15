/**
 * Fred 2026-10-14 (advisor): a SAVED board re-lays exactly as before. The wood-frame family commits (d4b2ec1) laid
 * quoin_corners on the arched templates (T10 / T16 / T18 / T19) as a new soldier_quoin arch with no bands -- every saved
 * quoin board there re-laid differently, with no migration and no pin. Pinned here through the app's own path
 * (main/brick-panel.js resolveFrameGeom: frameBandsOf(settings, templateId) -> editor-brick-tool.js brickLayInput ->
 * generateBricks), against digests taken on origin/main 92bccb4 (before those commits): every preset that existed
 * then, on the arched templates + the plain board, at 0.75 and 1.25 in. PIN=1 re-pins (fixtures/frame-preset-saved-boards.json).
 * Re-pinned (seat E, curve-quoin, Fred picked the curved quoin): the 5 quoin presets (quoin_corners + the _quoin variants)
 * on T10 / T16 / T18 only -- 30 of 200 rows; T19, the plain board and every other preset unchanged.
 * Re-pinned (seat E, cell-parts.js, Fred's pick A): the WALL half of T18 / T19 at 1.25 in, every preset -- one piece ADDED (a
 * stretcher the board clip lost whole across a bridge), every piece laid before identical (id, sample, flip, height, polygon).
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives, frameBandsOf, brickLayInput } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const PINNED = 'tests/fixtures/frame-preset-saved-boards.json';
const W = 7, H = 10, SIZES = [0.75, 1.25];
const BOARDS = ['template_10', 'template_16', 'template_18', 'template_19', null]; // the arched family + no template
const editor = { _mW: W, _mH: H, _sketchLayer: { node: { querySelectorAll: () => [], querySelector: () => null } }, _layers: [] };
const sha = (x) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);

function digest(templateId, preset, L) {
  const primitives = templateId
    ? buildRibbonPrimitives(frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId }), board: { widthIn: W, heightIn: H } }, 0, 0).primitives)
    : buildRibbonPrimitives([{ type: 'line', p0: { x: 0, y: 0 }, p1: { x: W, y: 0 } }, { type: 'line', p0: { x: W, y: 0 }, p1: { x: W, y: H } },
      { type: 'line', p0: { x: W, y: H }, p1: { x: 0, y: H } }, { type: 'line', p0: { x: 0, y: H }, p1: { x: 0, y: 0 } }]);
  const settings = { frameBandPreset: preset, brickLengthIn: L, seed: 1, suppression: 0, clumping: 0, pattern: 'running_bond' };
  // resolveFrameGeom's shape (main/brick-panel.js): the bands for these settings on this template
  const geom = { primitives, bands: frameBandsOf(settings, templateId), templateId };
  const r = generateBricks(brickLayInput(editor, settings, geom));
  const frame = [...r.frameBricks, ...(r.archBricks || [])].map((b) => b.polygon.map((p) => [+p.x.toFixed(5), +p.y.toFixed(5)]));
  return `${frame.length}/${r.bricks.length}:${sha(frame)}:${sha(r.bricks.map((b) => b.polygon.map((p) => [+p.x.toFixed(5), +p.y.toFixed(5)])))}`;
}

describe('a saved frame board re-lays exactly as before the wood-frame family commits', () => {
  it.each(BOARDS.map((t) => [t || 'no template']))('%s, every preset that existed then, at 0.75 and 1.25 in', (label) => {
    const templateId = label === 'no template' ? null : label;
    let pinned = {};
    try { pinned = JSON.parse(readFileSync(PINNED, 'utf8')); } catch (_) { /* first pin */ }
    const got = {};
    const presets = process.env.PIN === '1' ? Object.keys(FRAME_PRESETS) : [...new Set(Object.keys(pinned).filter((k) => k.startsWith(`${label} `)).map((k) => k.slice(label.length + 1).split(' ')[0]))];
    for (const preset of presets) for (const L of SIZES) got[`${label} ${preset} ${L}`] = digest(templateId, preset, L);
    if (process.env.PIN === '1') { writeFileSync(PINNED, JSON.stringify({ ...pinned, ...got }, null, 1) + '\n'); pinned = { ...pinned, ...got }; }
    expect(Object.keys(got).length).toBeGreaterThan(20);
    for (const k of Object.keys(got)) expect(got[k], k).toBe(pinned[k]);
  });
});
