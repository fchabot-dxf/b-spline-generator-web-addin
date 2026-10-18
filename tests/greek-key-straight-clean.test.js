/**
 * Fred 2026-10-18: STRAIGHT must be PERFECT. Every straight run of a fresh-pick Greek key band (meanderCurves on) must show a
 * clean, complete key: measured against the DECLARED tile (BAND_MOTIFS.greek_key.grid), not the engine's own formula.
 * tagMotifRow is captured at the real call (contour-bands.js), so each row's pieces, lattice columns and tagged reliefs
 * are the real lay. Per run: pieces of one lattice column c across the 12 rows must form ONE tile column vector (no
 * fragment), the key zone (between the corner cells) must be whole periods read 0..P-1 in order (a column may repeat
 * where the key stretches), starting on tile column 0 and ending on P-1. A run with no room for a period must lay the
 * curve pattern (rings/meander rows) everywhere, never a key fragment.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { runCell } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/band-motif.js';
import { BRICK_SETS, BAND_MOTIFS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives, frameBandsOf } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });
const calls = [];
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/band-motif.js', async (orig) => {
  const m = await orig();
  return { ...m, tagMotifRow: (pieces, sources, prims, motif, plan, row, rows, curves) => { const out = m.tagMotifRow(pieces, sources, prims, motif, plan, row, rows, curves); calls.push({ sources, prims, plan, row, rows, out, pieces }); return out; } };
});
const { generateBricks } = await import('../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js');

const SET = BRICK_SETS[0], tile = BAND_MOTIFS.greek_key.grid.tile, P = tile[0].length, R = tile.length;
const colVec = (k) => tile.map((l) => (l[k] === 'R' ? 'raised' : 'flush')).join();
const tileCols = Array.from({ length: P }, (_, k) => colVec(k));

/** mismatches of every straight run of one board; also how many runs were checked */
function measure(tpl, W, H, L = 0.75) {
  calls.length = 0;
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
  const bands = frameBandsOf({ frameBandPreset: 'greek_key_mosaic', frameBandPatterns: [], frameBandTileFactor: [], frameBandMeanderCurves: [] });
  generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1, scale: L / SET.brickLengthIn, suppression: 0, clumping: 0, frame: { primitives: buildRibbonPrimitives(sil.primitives), bands } });
  // runs: (call-group, src) -> row -> [{c, cEnd, relief}] ; a call group = the 12 rows of one band lay (rows restart at 0)
  const runs = new Map(); let group = -1;
  for (const cl of calls) {
    if (cl.row === 0) group++;
    cl.sources.forEach((src, k) => {
      if (!(src >= 0) || cl.prims[src].type !== 'line') return;
      const key = group + ':' + src, cell = runCell(cl.pieces[k], cl.prims, src, cl.plan.pitch, cl.rows);
      const r = runs.get(key) || { rows: new Map(), len: cell.len, z0: cell.z0, z1: cell.z1, mitreStart: cell.mitreStart, mitreEnd: cell.mitreEnd };
      const rowArr = r.rows.get(cl.row) || []; r.rows.set(cl.row, rowArr);
      rowArr.push({ c: Math.floor(cell.u), u: cell.u, relief: cl.out[k].relief });
      runs.set(key, r);
    });
  }
  let bad = 0, checked = 0, short = 0, fanStart = 0; const why = [];
  for (const [key, run] of runs) {
    if (run.rows.size < R) continue;
    checked++;
    // the run's lattice columns that every row has a piece in, each as its 12-row relief vector
    const byC = new Map();
    for (const [row, ps] of run.rows) for (const p of ps) { const a = byC.get(p.c) || []; a[row] = p.relief; byC.set(p.c, a); }
    const { z0, z1 } = run;
    const cols = [...byC.keys()].sort((a, b) => a - b).filter((c) => c + 0.5 >= z0 && c + 0.5 <= z1 && byC.get(c).filter(Boolean).length === R);
    const kinds = cols.map((c) => tileCols.indexOf(byC.get(c).join()));
    const first = 0, last = kinds.length - 1;
    if (process.env.DBG) console.log(key, 'len', run.len.toFixed(1), 'z0', run.z0.toFixed(1), 'z1', run.z1.toFixed(1), 'mS', run.mitreStart, 'mE', run.mitreEnd, 'rowsmax u', [0,5,11].map((r)=>Math.max(...(run.rows.get(r)||[{u:0}]).map((q)=>q.u)).toFixed(1)).join('/'), 'cols', cols.length, 'kinds', kinds.join(''));
    if (z1 - z0 < P) { // no room for a period: the run is short -> whole-row pattern, never a half key
      short++;
      for (const [row, ps] of run.rows) if (new Set(ps.map((p) => p.relief)).size !== 1) { bad++; why.push(`${key} short run row ${row} mixed`); }
      continue;
    }
    if (!run.mitreStart) { // a run starting at a fan lays whole rows (fanStartPattern), checked against the declared ring rows
      fanStart++;
      for (const [row, ps] of run.rows) { const want = row === 1 || row === 10 ? 'raised' : 'flush'; if (ps.some((p) => p.relief !== want)) { bad++; why.push(`${key} fan-start row ${row} is not a uniform ${want} ring row`); } }
      continue;
    }
    if (kinds[first] !== 0) { bad++; why.push(`${key} key starts on tile col ${kinds[first]}`); }
    if (run.mitreEnd && kinds[last] !== P - 1) { bad++; why.push(`${key} key ends on tile col ${kinds[last]}`); }
    for (let i = first; i <= last; i++) {
      if (kinds[i] < 0) { bad++; why.push(`${key} col ${cols[i]} inside the key is not a tile column`); continue; }
      if (i > first && kinds[i] !== kinds[i - 1] && kinds[i] !== (kinds[i - 1] + 1) % P) { bad++; why.push(`${key} col jump ${kinds[i - 1]}->${kinds[i]}`); }
    }
  }
  return { bad, checked, short, fanStart, why };
}

describe('every straight run of a fresh Greek key band is a clean, whole-period key', () => {
  it.each([['template_1', 9, 12], ['template_1', 7, 9], ['template_10', 9, 12], ['template_11', 9, 12], ['template_11', 7, 9]])('%s %ix%i', (tpl, W, H) => {
    const m = measure(tpl, W, H);
    console.log(tpl, W, H, JSON.stringify({ runs: m.checked, short: m.short, fanStartRings: m.fanStart, mismatches: m.bad }), m.why.slice(0, 8).join('; '));
    expect(m.checked).toBeGreaterThan(0);
    expect(m.why).toEqual([]);
  });
});
