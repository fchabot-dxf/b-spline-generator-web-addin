/**
 * No region, no wall -- and never an endless loop (seat E, 2026-10-08). MEASURED: on T9 7x9 at 1.5 in the soldier band
 * covers the board and generateBricks hands the fill an EMPTY interiorOutline; the octagon-dot tiles (square_diamond,
 * octagon_square) read its bounding box as +-Infinity and their grid loop never ended -- the app froze (fill-shape.js
 * bricksFillShape now returns no pieces for a region of fewer than 3 points). Each lay runs in a child process
 * (tests/empty-region-child.mjs): a synchronous loop in this worker could never time out, a child's timeout is a FAIL.
 */
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { BRICK_PATTERNS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

vi.setConfig({ testTimeout: 120000 });
const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'empty-region-child.mjs');
const CHILD_TIMEOUT_MS = 20000; // a lay here takes well under a second; the freeze never returned
const run = (job) => {
  const r = spawnSync(process.execPath, [CHILD, JSON.stringify(job)], { timeout: CHILD_TIMEOUT_MS, encoding: 'utf8' });
  return { timedOut: r.error && r.error.code === 'ETIMEDOUT' || r.signal != null, status: r.status, out: r.stdout ? JSON.parse(r.stdout || 'null') : null, err: (r.stderr || '').split('\n').filter((l) => /Error/.test(l)).join(' ') };
};
// every layout a wall can name: the tile2d patterns (each its own layout) and the course patterns' bond
const LAYOUTS = ['bond', ...Object.entries(BRICK_PATTERNS).filter(([, d]) => d.kind === 'tile2d').map(([k]) => k)];

describe('an empty region lays no wall, and returns', () => {
  it.each(LAYOUTS)('%s on an empty region', (layout) => {
    const r = run({ kind: 'fill', layout });
    expect(r.timedOut, `${layout}: no return within ${CHILD_TIMEOUT_MS} ms`).toBeFalsy();
    expect(r.status, `${layout}: ${r.err}`).toBe(0);
    expect(r.out).toEqual({ wall: 0 });
  });
  it.each(['square_diamond', 'octagon_square'])('T9 7x9 at 1.5 in, %s: the band covers the board, no wall', (pattern) => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_9' }), board: { widthIn: 7, heightIn: 9 } }, 0, 0);
    const r = run({ kind: 'lay', prims: buildRibbonPrimitives(sil.primitives), board: [7, 9], L: 1.5, pattern });
    expect(r.timedOut, `T9 1.5 in ${pattern}: no return within ${CHILD_TIMEOUT_MS} ms`).toBeFalsy();
    expect(r.status, r.err).toBe(0);
    expect(r.out).toEqual({ wall: 0 });
  });
});
