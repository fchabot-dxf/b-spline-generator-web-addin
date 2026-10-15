/**
 * The short-brick bands (Fred 2026-10-14: "3 more brick frames that use smaller bricks but not tiles, over 3 bands" -- "small
 * as in not as long": HALF and THIRD of a brick's length at the same height; then six, more varied): half_running_bond,
 * half_stack_bond, third_stepped_bond, half_slim_third, short_alternating, half_soldier_course (core/bricks/library.js
 * FRAME_PRESETS; the short courses BAND_MOTIFS half_* / third_* / slim_third_course / half_soldier_raised; a band's `bond`
 * read by band-motif.js motifRowPlan). Each is three mitred bands at the usual size; each lays its declared brick lengths,
 * bond and relief on the rectangle; each lays clean at its best size on the rectangle and one template of every wood-frame
 * family (T1 hourglass, T10 / T18 arched, T7 gable, T6 stepped, T15 shouldered), 7x9 and 9x12: no overlaps, nothing off the
 * board, no sliver, no bare patch past PATCH_MAX_FACE (tests/bricks-narrow-runners.test.js style).
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS, BAND_MOTIFS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { WOOD_FRAME_FAMILIES } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/frame-families.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { tess, bareGround, PATCH_MAX_FACE } from './bare-ground.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0];
const SHORT = ['half_running_bond', 'half_stack_bond', 'third_stepped_bond', 'half_slim_third', 'short_alternating', 'half_soldier_course'];
const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const centroid = (p) => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length });
const span = (p, k) => Math.max(...p.map((q) => q[k])) - Math.min(...p.map((q) => q[k]));
function primitivesOf(board, W, H) {
  if (board === 'rect') return buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: W, y2: H }));
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: board }), board: { widthIn: W, heightIn: H } }, 0, 0);
  return sil && sil.primitives ? buildRibbonPrimitives(sil.primitives) : null;
}
const lay = (prims, bands, L, W, H) => generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1,
  scale: L / SET.brickLengthIn, suppression: 0, clumping: 0, frame: { primitives: prims, bands } });
/** a band's pieces of length factor f: its seq lengths (unit 'L') */
const lengthsOf = (band) => { const m = BAND_MOTIFS[band.motif]; return m.unit === 'L' ? m.rows[0].seq.map(([len]) => len) : null; };

describe('the short-brick bands are declared', () => {
  it('each: three mitred one-course bands at the usual size, every band a short-brick motif (1/2 or 1/3 of a brick, or a half-brick soldier)', () => {
    for (const id of SHORT) {
      const bands = FRAME_PRESETS[id];
      expect(bands.length, id).toBe(3);
      expect(bands.bestSize, id).toBe(1.25);
      for (const b of bands) {
        expect(b.cornerStyle, `${id}: mitred`).toBeUndefined();
        expect(b.rows, id).toBe(1);
        const m = BAND_MOTIFS[b.motif];
        expect(m && m.rows, `${id} ${b.motif}`).toBeTruthy();
        // the band's declared depth (Set 1) is its motif's row depth: the icons read the same widths
        expect(b.widthIn, `${id} ${b.motif}`).toBeCloseTo((m.rowDepth || 1) * SET.brickHeightIn, 9);
        if (m.unit === 'L') for (const f of lengthsOf(b)) expect([1 / 2, 1 / 3], `${id} ${b.motif}`).toContain(f);
        else expect(m.rowDepth * SET.brickHeightIn, `${id} ${b.motif}: a half brick standing`).toBeCloseTo(SET.brickLengthIn / 2, 9);
      }
    }
  });
  it('the six vary: no two share a band stack; raised outer / middle / inner / alternating, halves, thirds and a mix, a slim band, a soldier course', () => {
    expect(new Set(SHORT.map((id) => JSON.stringify(FRAME_PRESETS[id]))).size).toBe(SHORT.length);
    const raisedAt = (id) => FRAME_PRESETS[id].map((b) => BAND_MOTIFS[b.motif].rows[0].seq.map(([, r]) => r).join('/'));
    expect(raisedAt('half_stack_bond')).toEqual(['raised', 'flush', 'flush']);
    expect(raisedAt('half_running_bond')).toEqual(['flush', 'raised', 'flush']);
    expect(raisedAt('third_stepped_bond')).toEqual(['flush', 'flush', 'raised']);
    expect(raisedAt('short_alternating')).toEqual(['raised/flush', 'raised/flush', 'raised/flush']);
    expect(FRAME_PRESETS.half_slim_third[1].widthIn).toBeLessThan(FRAME_PRESETS.half_slim_third[0].widthIn);
    expect(BAND_MOTIFS[FRAME_PRESETS.half_soldier_course[1].motif].unit).toBe('H');
  });
  it('every wood-frame family suggests all six (families suggest, never hide)', () => {
    for (const f of Object.values(WOOD_FRAME_FAMILIES)) for (const id of SHORT) expect(f.conformingPresetIds, `${f.id} ${id}`).toContain(id);
  });
});

describe('the short bricks lay as declared (9x12 rectangle, 1.25 in)', () => {
  const W = 9, H = 12, L = 1.25, rect = primitivesOf('rect', W, H);
  const s = scaledSet(SET, L / SET.brickLengthIn), J = s.grout.widthIn;
  // the top side's run of band k: pieces above both corner mitres, left to right
  const topSide = (bricks, k) => bricks.filter((b) => { const c = centroid(b.polygon); return b.bandIndex === k && c.y < c.x && c.y < W - c.x; })
    .sort((a, b) => centroid(a.polygon).x - centroid(b.polygon).x);
  const joints = (run) => run.slice(1).map((b) => Math.min(...b.polygon.map((p) => p.x)));
  const inner = (run) => run.slice(2, -2);
  /** how far each interior joint of band b sits past band a's joint lattice (a's interior joints, one piece pitch apart),
   *  as its distance from `want` on that cycle (0 = exactly `want` along) */
  const shift = (ja, jb, pitch, want) => jb.filter((x) => x > ja[1] && x < ja[ja.length - 2]).map((x) => {
    const m = (((x - ja[1] - want) % pitch) + pitch) % pitch;
    return Math.min(m, pitch - m);
  });

  it('each band lays its declared length (1/2 or 1/3 of a brick, less a joint), one course high; the soldiers a half brick deep', () => {
    for (const id of SHORT) {
      const r = lay(rect, FRAME_PRESETS[id], L, W, H);
      FRAME_PRESETS[id].forEach((band, k) => {
        const run = inner(topSide(r.frameBricks, k)), m = BAND_MOTIFS[band.motif];
        expect(run.length, `${id} band ${k}`).toBeGreaterThan(5);
        const along = m.unit === 'L' ? lengthsOf(band).map((f) => f * L - J) : [s.brickHeightIn - J];
        const depth = (m.rowDepth || 1) * s.brickHeightIn - J;
        for (const b of run) {
          expect(along.some((a) => Math.abs(span(b.polygon, 'x') - a) < 1e-6), `${id} band ${k} length ${span(b.polygon, 'x')}`).toBe(true);
          // the joint rule: the outer band's outer edge (the board) has no joint
          expect(span(b.polygon, 'y'), `${id} band ${k} depth`).toBeCloseTo(k === 0 ? depth + J / 2 : depth, 6);
          expect(span(b.polygon, 'x') / span(b.polygon, 'y'), `${id} band ${k}: oblong, not a square tile`).not.toBeCloseTo(1, 1);
        }
      });
    }
  });
  it('the declared bond across bands: stacked joints, a half-brick running bond, a third-of-a-third step', () => {
    const at = (id) => { const r = lay(rect, FRAME_PRESETS[id], L, W, H); return [0, 1, 2].map((k) => joints(topSide(r.frameBricks, k))); };
    const half = L / 2, third = L / 3;
    const all = (ds) => { expect(ds.length).toBeGreaterThan(5); for (const d of ds) expect(d).toBeCloseTo(0, 6); };
    const [s0, s1, s2] = at('half_stack_bond');
    all(shift(s0, s1, half, 0)); all(shift(s0, s2, half, 0));
    const [h0, h1, h2] = at('half_running_bond');
    all(shift(h0, h1, half, L / 4)); all(shift(h0, h2, half, 0));
    const [t0, t1, t2] = at('third_stepped_bond');
    all(shift(t0, t1, third, L / 9)); all(shift(t0, t2, third, (2 * L) / 9));
  });
  it('the declared relief: one raised band (outer / middle / inner) or alternating bricks, opposite across the outer and inner thirds', () => {
    const reliefs = (id, k) => { const r = lay(rect, FRAME_PRESETS[id], L, W, H); return inner(topSide(r.frameBricks, k)).map((b) => b.relief); };
    for (const [id, k] of [['half_stack_bond', 0], ['half_running_bond', 1], ['third_stepped_bond', 2], ['half_soldier_course', 1]]) {
      for (let j = 0; j < 3; j++) expect(new Set(reliefs(id, j)), `${id} band ${j}`).toEqual(new Set([j === k ? 'raised' : 'flush']));
    }
    expect(reliefs('half_slim_third', 0).every((x) => x === 'raised') && reliefs('half_slim_third', 2).every((x) => x === 'raised')).toBe(true);
    expect(reliefs('half_slim_third', 1).every((x) => x === 'flush')).toBe(true);
    const r = lay(rect, FRAME_PRESETS.short_alternating, L, W, H);
    for (let k = 0; k < 3; k++) { const run = inner(topSide(r.frameBricks, k)); run.slice(1).forEach((b, j) => expect(b.relief, `band ${k} ${j}`).not.toBe(run[j].relief)); }
    // the inner thirds sit a brick on from the outer ones: the same joints, the opposite relief
    const o = topSide(r.frameBricks, 0), n = topSide(r.frameBricks, 2);
    let matched = 0;
    for (const b of n.slice(2, -2)) {
      const x = Math.min(...b.polygon.map((p) => p.x)), twin = o.find((a) => Math.abs(Math.min(...a.polygon.map((p) => p.x)) - x) < 1e-6);
      if (twin) { matched++; expect(b.relief).not.toBe(twin.relief); }
    }
    expect(matched).toBeGreaterThan(5);
  });
});

// one template of every wood-frame family (frame-families.js), plus T18 (arched, the narrow runners' sweep)
const TEMPLATES = ['rect', 'template_1', 'template_10', 'template_18', 'template_7', 'template_6', 'template_15'];
const CASES = TEMPLATES.flatMap((tpl) => [[7, 9], [9, 12]].flatMap(([W, H]) => SHORT.map((p) => [tpl, W, H, FRAME_PRESETS[p].bestSize, p])));

describe('the short-brick bands lay cleanly at their best size', () => {
  it('the sweep covers a template of every wood-frame family', () => {
    for (const f of Object.values(WOOD_FRAME_FAMILIES)) expect(f.templates.some((t) => TEMPLATES.includes(t)), f.id).toBe(true);
  });
  it.each(CASES)('%s %sx%s at %s in, %s', (tpl, W, H, L, preset) => {
    const prims = primitivesOf(tpl, W, H);
    expect(prims, tpl).toBeTruthy();
    const bands = FRAME_PRESETS[preset];
    const r = lay(prims, bands, L, W, H), s = scaledSet(SET, L / SET.brickLengthIn), J = s.grout.widthIn, contour = tess(prims);
    expect(r.frameBricks.length).toBeGreaterThan(0);
    // the stack: the fit rule (contour-bands.js fitBandStack) drops bands from the INSIDE where a neck is too narrow -- as it
    // does for every deep preset (MEASURED at 1.25 in, 7x9: three_band and soldier_string keep 1 of 3 bands on all six of
    // these templates); these keep all three on the rectangle and on the roomier 9x12 boards
    const laid = bands.map((_, k) => r.frameBricks.some((b) => b.bandIndex === k));
    expect(laid[0], 'the outer band').toBe(true);
    expect(laid.join(), 'dropped from the inside only').toBe(laid.map((_, k) => k < laid.filter(Boolean).length).join());
    if (tpl === 'rect' || (H === 12 && ['template_1', 'template_6', 'template_10'].includes(tpl))) expect(laid.every(Boolean), 'all three bands').toBe(true);
    for (const b of r.frameBricks) expect(b.relief, b.id).toBeDefined();
    // no sliver: every piece at least 3/4 of its band's floor -- a quarter of its shortest brick x the course face
    const floorOf = (band) => { const m = BAND_MOTIFS[band.motif], along = m.unit === 'L' ? Math.min(...lengthsOf(band)) * s.brickLengthIn : s.brickHeightIn;
      return 0.25 * (along - J) * ((m.rowDepth || 1) * s.brickHeightIn - J); };
    const slivers = r.frameBricks.filter((b) => area(b.polygon) < 0.75 * floorOf(bands[b.bandIndex])).map((b) => `${b.id} ${(area(b.polygon) / floorOf(bands[b.bandIndex])).toFixed(2)}`);
    expect(slivers, 'frame slivers').toEqual([]);
    // no two frame pieces overlap
    const fb = r.frameBricks, bx = fb.map((b) => { const xs = b.polygon.map((p) => p.x), ys = b.polygon.map((p) => p.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; });
    const bad = [];
    for (let i = 0; i < fb.length; i++) for (let j = i + 1; j < fb.length; j++) {
      const a = bx[i], b = bx[j];
      if (a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]) continue;
      const o = area(polygonIntersection(fb[i].polygon, fb[j].polygon));
      if (o > 1e-4) bad.push(`${fb[i].id}/${fb[j].id} ${o.toFixed(5)}`);
    }
    expect(bad, 'frame pieces overlapping').toEqual([]);
    const segDist = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y); };
    const outside = (b) => b.polygon.some((p) => !pointInPolygon(p.x, p.y, contour) && Math.min(...contour.map((a, i) => segDist(p, a, contour[(i + 1) % contour.length]))) > J);
    expect(r.frameBricks.filter(outside).length, 'frame pieces outside the outline').toBe(0);
    const bare = bareGround(contour, [...r.frameBricks, ...r.bricks], J, { W, H });
    expect(bare.largestSqIn / (s.brickLengthIn * s.brickHeightIn), 'largest bare patch, share of one brick face').toBeLessThanOrEqual(PATCH_MAX_FACE);
  });
});
