/**
 * Fred 2026-10-14 (pick A, the pattern gaps; core/bricks/cell-parts.js): a wall cell that a frame corner or tip cuts in two
 * lays every part. Saved boards may only GAIN pieces: every piece laid before keeps its polygon, sample, flip, height and
 * piece id (all seeded by its cell id), and each added piece has an id of its own range (seeded by its parent cell's id +
 * its part index). Pinned against digests of today's pieces taken on origin/main ac93a1c (PIN=1 writes them there):
 * every wall pattern on the templates the region cuts most (T6 / T9 / T14 / T16 / T18) at 7x9, 0.75 and 1.25 in.
 * The frame: as on main, except the 3 lays the tip rule fixes (english / monk declare a header their whole piece, library.js
 * smallestFace): T14 english / monk and T16 monk at 1.25 in -- the band now fills the tip they left bare (re-pinned).
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_PATTERNS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives, resolvedSetFor, scaleFor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

// the parts' own id range (cell-parts.js); absent on the tree the digests were taken on (no parts there)
const PARTS_MODULE = '../bspline-frame-builder/b-spline-gen/html/core/bricks/cell-parts.js';
const parts = await import(/* @vite-ignore */ PARTS_MODULE).catch(() => null);
if (!process.env.PIN) expect(parts, 'cell-parts.js loads (the change under test)').toBeTruthy();
const isAdded = (id) => !!parts && id >= parts.CELL_PART.orphanBase;

const PINNED = 'tests/fixtures/cell-parts-today.json';
const TEMPLATES = ['template_6', 'template_9', 'template_14', 'template_16', 'template_18'];
const PATTERNS = Object.entries(BRICK_PATTERNS).filter(([k, v]) => v.kind !== 'none' && k !== 'fieldstone' && k !== 'coursed_rubble' && k !== 'coursed_ashlar').map(([k]) => k);
const W = 7, H = 9, SIZES = [0.75, 1.25];
const sha = (x) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const r6 = (p) => p.map((q) => [+q.x.toFixed(6), +q.y.toFixed(6)]);

function lay(tpl, pattern, L) {
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
  const prims = buildRibbonPrimitives(sil.primitives);
  const settings = { setId: 1, pattern, brickLengthIn: L }, set = resolvedSetFor(settings), scale = scaleFor(settings);
  const input = { boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set, scale, seed: 1, suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS.single_soldier } };
  if (BRICK_PATTERNS[pattern].kind === 'tile2d') input.set = { ...set, layout: pattern }; else input.zones = [{ pattern }];
  return generateBricks(input);
}
/** today's wall pieces (every field a seed sets) and the frame, as digests */
const digestOf = (r) => {
  const today = r.bricks.filter((b) => !isAdded(b.id)).sort((a, b) => a.id - b.id)
    .map((b) => [b.id, b.pieceId, b.sampleId, b.flip, +(b.heightOffset || 0).toFixed(9), r6(b.polygon)]);
  return { wall: `${today.length}:${sha(today)}`, frame: `${r.frameBricks.length}:${sha(r.frameBricks.map((b) => r6(b.polygon)))}` };
};

describe('a saved wall only gains pieces: today\'s pieces exactly as laid, the added ones with ids of their own', () => {
  it.each(TEMPLATES)('%s 7x9, every wall pattern at 0.75 and 1.25 in', (tpl) => {
    let pinned = {};
    try { pinned = JSON.parse(readFileSync(PINNED, 'utf8')); } catch (_) { /* first pin */ }
    const got = {}, added = [];
    for (const pattern of PATTERNS) for (const L of SIZES) {
      const r = lay(tpl, pattern, L), key = `${tpl} ${pattern} ${L}`;
      got[key] = digestOf(r);
      for (const b of r.bricks.filter((x) => isAdded(x.id))) added.push({ key, id: b.id });
    }
    if (process.env.PIN === '1') { writeFileSync(PINNED, JSON.stringify({ ...pinned, ...got }, null, 1) + '\n'); return; }
    for (const k of Object.keys(got)) expect(got[k].wall, `${k}: today's wall pieces`).toBe(pinned[k].wall);
    for (const k of Object.keys(got)) expect(got[k].frame, `${k}: the frame`).toBe(pinned[k].frame);
    // an added piece's id: its parent's (a real cell, or a lost one's course/column) x perCell + its part index (1..)
    if (parts) for (const { key, id } of added) {
      const k = (id - parts.CELL_PART.idOffset) % parts.CELL_PART.perCell;
      expect(id >= parts.CELL_PART.idOffset && k >= 1, `${key}: added piece id ${id}`).toBe(true);
    }
  });
});
