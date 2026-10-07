/**
 * T86 item 16e (Fred on the fan mock: "I like them all, add a choice"): a frame corner's fan ends at its centre as a
 * Needle (today), an Eye (each slice cut square where it reaches MIN_TIP_WIDTH, one radius per fan) or a Stone (the eye
 * holds a centre stone a joint off everything). Declared once (core/bricks/fan-centre.js FAN_CENTRES), read through
 * generateBricks' `fanCentre`; absent = needle = no call, so a saved board lays byte-identical.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks, ENGINE_OPTIONS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { FAN_CENTRES, FAN_CENTRE_DEFAULT, FAN_MIN_TIP_OF_HEIGHT, fanGroups } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/fan-centre.js';
import { pointInPolygon, signedArea, isSimplePolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const SET = BRICK_SETS[0], J = SET.grout.widthIn;
const BOARD = [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 9 }, { x: 0, y: 9 }];
const prims = new Map();
function lay(tpl, L, fanCentre, preset = 'single_soldier') {
  if (!prims.has(tpl)) prims.set(tpl, buildRibbonPrimitives(frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: 7, heightIn: 9 } }, 0, 0).primitives));
  return generateBricks({ boardOutline: BOARD, set: SET, seed: 1, scale: L / SET.brickLengthIn, suppression: 0, clumping: 0, ...(fanCentre !== undefined ? { fanCentre } : {}), frame: { primitives: prims.get(tpl), bands: FRAME_PRESETS[preset] } });
}
const area = (P) => (P && P.length >= 3 ? Math.abs(signedArea(P)) : 0);
const segDist = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y); };
const distToPoly = (p, P) => (pointInPolygon(p.x, p.y, P) ? 0 : Math.min(...P.map((a, i) => segDist(p, a, P[(i + 1) % P.length]))));
const gap = (A, B) => Math.min(...A.map((p) => distToPoly(p, B)), ...B.map((p) => distToPoly(p, A)));
/** a slice's square end: its edge nearest the apex (length = the end's width) */
function endWidth(P, apex) {
  let best = null;
  P.forEach((a, i) => { const b = P[(i + 1) % P.length], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d = Math.hypot(m.x - apex.x, m.y - apex.y); if (!best || d < best.d) best = { d, w: Math.hypot(b.x - a.x, b.y - a.y) }; });
  return best.w;
}
// fan boards: [template, size, preset, fans, the narrowest square end as a share of MIN_TIP_WIDTH (measured: the slices
// beside a run are clipped a joint off its end line, so at the median's radius they are narrower -- T18 1.25 in 0.36)]
const FAN_BOARDS = [['template_18', 1.25, 'single_soldier', 4, 0.36], ['template_1', 1, 'single_soldier', 4, 0.9], ['template_1', 0.75, 'soldier_stretcher', 4, 0.84], ['template_2', 1, 'single_soldier', 2, 0.62]];

describe('T86 16e: the fan centre choice is declared once', () => {
  it('needle | eye | stone, needle the default, MIN_TIP_WIDTH a third of the brick height, an engine option', () => {
    expect(FAN_CENTRES.map((s) => s.id)).toEqual(['needle', 'eye', 'stone']);
    expect(FAN_CENTRE_DEFAULT).toBe('needle');
    expect(FAN_MIN_TIP_OF_HEIGHT).toBeCloseTo(1 / 3, 12);
    expect(ENGINE_OPTIONS).toContain('fanCentre');
    for (const s of FAN_CENTRES) expect(s.label && s.title).toBeTruthy();
  });
  it('every fan slice declares the apex its fan converges on (T18 1.25: fans of 4, 11, 12, 4)', () => {
    const g = fanGroups(lay('template_18', 1.25).frameBricks).map((x) => x.slices.length).sort((a, b) => a - b);
    expect(g).toEqual([4, 4, 11, 12]);
  });
});

describe('T86 16e: Needle (absent) lays today', () => {
  it.each([['template_1', 1], ['template_18', 1.25]])('%s at %s in: absent, needle and an unknown value lay the same frame', (tpl, L) => {
    const today = lay(tpl, L).frameBricks;
    expect(lay(tpl, L, 'needle').frameBricks).toEqual(today);
    expect(lay(tpl, L, 'bogus').frameBricks).toEqual(today);
  });
});

describe('T86 16e: Eye and Stone', () => {
  it.each(FAN_BOARDS)('%s at %s in (%s): every fan cut square at one radius, a joint kept, the run untouched', (tpl, L, preset, fans, narrowShare) => {
    const today = lay(tpl, L, undefined, preset), eye = lay(tpl, L, 'eye', preset);
    const groups = fanGroups(today.frameBricks);
    expect(groups.length).toBe(fans);
    const H = (SET.brickHeightIn * L) / SET.brickLengthIn, minW = FAN_MIN_TIP_OF_HEIGHT * H;
    const byId = new Map(eye.frameBricks.map((b) => [b.id, b]));
    // every non-fan piece is laid exactly as today
    for (const b of today.frameBricks.filter((x) => !x.fan)) expect(byId.get(b.id)).toEqual(b);
    for (const g of groups) {
      const cut = g.slices.map((i) => byId.get(today.frameBricks[i].id)).filter(Boolean);
      // one radius per fan: every slice's nearest point to the apex sits at the same distance (its square end's corner)
      const near = cut.map((b) => Math.min(...b.polygon.map((p) => Math.hypot(p.x - g.apex.x, p.y - g.apex.y))));
      expect(Math.max(...near) - Math.min(...near)).toBeLessThan(0.02);
      // no needle: the median slice's square end is at least MIN_TIP_WIDTH; the narrowest no narrower than measured
      const widths = cut.map((b) => endWidth(b.polygon, g.apex)).sort((a, b) => a - b);
      expect(widths[Math.floor(widths.length / 2)]).toBeGreaterThanOrEqual(minW * 0.97);
      if (process.env.MEASURE_FANS) console.log('NARROWEST', tpl, L, preset, (widths[0] / minW).toFixed(3));
      expect(widths[0]).toBeGreaterThanOrEqual(minW * narrowShare * 0.99);
    }
  });

  it.each(FAN_BOARDS)('%s at %s in (%s): one stone per fan, a joint off every piece, inside the eye', (tpl, L, preset, fans) => {
    const today = lay(tpl, L, undefined, preset), r = lay(tpl, L, 'stone', preset);
    const stones = r.frameBricks.filter((b) => b.fanCentre);
    expect(stones.length).toBe(fans);
    const groups = fanGroups(today.frameBricks);
    for (const s of stones) {
      expect(isSimplePolygon(s.polygon)).toBe(true);
      expect(s.fan).toBeUndefined();
      // its fan's apex is the nearest; it lies within the eye's radius
      const g = groups.reduce((a, x) => (distToPoly(x.apex, s.polygon) < distToPoly(a.apex, s.polygon) ? x : a));
      expect(Math.max(...s.polygon.map((p) => Math.hypot(p.x - g.apex.x, p.y - g.apex.y)))).toBeLessThan(1);
      for (const o of [...r.frameBricks, ...r.bricks]) {
        if (o === s || !o.polygon.some((p) => Math.hypot(p.x - g.apex.x, p.y - g.apex.y) < 2)) continue;
        expect(gap(s.polygon, o.polygon)).toBeGreaterThan(0.9 * J);
      }
      expect(area(s.polygon)).toBeGreaterThan(0.01);
    }
    // the stone lays the eye's frame plus the stones, nothing else
    const eye = lay(tpl, L, 'eye', preset).frameBricks;
    expect(r.frameBricks.filter((b) => !b.fanCentre)).toEqual(eye);
  });

  it('a frame with no fan corner lays the same for every choice (T9 1 in, square corners)', () => {
    const today = lay('template_9', 1).frameBricks;
    expect(fanGroups(today)).toEqual([]);
    for (const s of ['eye', 'stone']) expect(lay('template_9', 1, s).frameBricks).toEqual(today);
  });
});
