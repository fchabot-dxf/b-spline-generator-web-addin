/**
 * Pull from Fusion part 2 (seat B 2026-10-18): the wood-frame sketch shape syncs back. Pulled seed geometry (the
 * SAME shape frameSeedGeometry sends) is inverse-fitted onto the template's own seeded handles. Real app shapes:
 * FRAME_DEFS templates, frameCutProfile, frameSeedGeometry -- the pulled input is what Send would have seeded for
 * a record whose handle was moved, so the fit must give that handle value back.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameSeedGeometry, frameParamRanges } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { fitPulledFrameShape, FRAME_SHAPE_FIT_TOL_IN } from '../bspline-frame-builder/b-spline-gen/html/core/pull-frame-shape.js';

const W = 7, H = 9, board = { widthIn: W, heightIn: H };
const withSeeds = (rec, seeds) => ({ ...rec, seeds: { ...rec.seeds, ...seeds } });
const pulledFor = (tpl, rec) => frameSeedGeometry(tpl, frameCutProfile(FRAME_DEFS, rec, board), W, H);

describe.each(FRAME_DEFS.templates.map((t) => t.id))('%s pull frame shape', (id) => {
  const tpl = FRAME_DEFS.templates.find((t) => t.id === id);
  const rec = normalizeFrameRecord({ templateId: id });
  const prof = frameCutProfile(FRAME_DEFS, rec, board);
  const seeded = (tpl.handles || []).filter((h) => h.binding === 'seeded');

  it('an untouched sketch gives no rows', () => {
    const r = fitPulledFrameShape(FRAME_DEFS, rec, board, pulledFor(tpl, rec));
    expect(r.status).toBe('unchanged');
    expect(r.rows).toEqual([]);
  });

  it('each moved handle comes back as the same handle value', () => {
    const ranges = frameParamRanges(tpl, prof.region, prof.params);
    for (const h of seeded) {
      const r = ranges[h.key];
      if (!r || !(r.max - r.min > 0.02)) continue;
      const cur = prof.params[h.key];
      const target = cur + 0.4 * ((cur - r.min > r.max - cur ? r.min : r.max) - cur);
      const moved = withSeeds(rec, { [h.key]: target });
      const movedProf = frameCutProfile(FRAME_DEFS, moved, board);
      if (Math.abs(movedProf.params[h.key] - cur) < 1e-3) continue; // the template itself pins this one here
      const fit = fitPulledFrameShape(FRAME_DEFS, rec, board, pulledFor(tpl, moved));
      expect(fit.status, `${id}.${h.key}`).toBe('changed');
      expect(fit.worstIn, `${id}.${h.key} residual`).toBeLessThanOrEqual(FRAME_SHAPE_FIT_TOL_IN);
      // the fitted shape must reproduce the moved one (handles can be partly redundant, so compare the SHAPE)
      const fitSeeds = Object.fromEntries(fit.rows.map((x) => [x.key, x.toFrac]));
      const back = pulledFor(tpl, withSeeds(rec, fitSeeds));
      for (const [sid, g] of Object.entries(pulledFor(tpl, moved))) {
        if (!g.points) continue;
        g.points.forEach((p, i) => {
          const q = back[sid].points[i], q2 = back[sid].points[g.points.length - 1 - i];
          expect(Math.min(Math.hypot(p[0] - q[0], p[1] - q[1]), Math.hypot(p[0] - q2[0], p[1] - q2[1])), `${id}.${h.key}.${sid}`).toBeLessThan(0.01);
        });
      }
      const row = fit.rows.find((x) => x.key === h.key);
      expect(row, `${id}.${h.key} row`).toBeTruthy();
      // The VALUE itself is not pinned: a handle the sketch barely feels over part of its range (T7 gableNeckWidth)
      // has several values that draw the same curves, and any of them is a right answer; the SHAPE check above is
      // what must hold.
    }
  });

  it('an edit the handles cannot express is reported beyond, with no rows', () => {
    const pulled = pulledFor(tpl, rec);
    const ids = Object.keys(pulled).filter((k) => pulled[k].points && pulled[k].points.length === 2);
    if (!ids.length) return;
    // drag ONE point of ONE line well off its place: no handle moves a single vertex
    const bad = JSON.parse(JSON.stringify(pulled));
    bad[ids[0]].points[0][0] += 0.6; bad[ids[0]].points[0][1] += 0.4;
    const fit = fitPulledFrameShape(FRAME_DEFS, rec, board, bad);
    expect(fit.status).toBe('beyond');
    expect(fit.rows).toEqual([]);
    expect(fit.beyondIds.length).toBeGreaterThan(0);
  });
});
