/**
 * Pull frame shape: an arc compares by SHAPE, not mid-to-mid (seat B 2026-10-18, MEASURED live in Fusion).
 * Send seeds an Arc3Point whose mid is only some point on the arc; Fusion returns the arc's parametric middle.
 * template_5 arc_top_dip: seed mid (0.01, 3.655153), pulled (0.0, 3.65498) -- the same arc to 3e-4 in, but 0.010001 apart
 * point to point, which read an untouched sketch as edited and then as 'beyond'.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameSeedGeometry } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { fitPulledFrameShape } from '../bspline-frame-builder/b-spline-gen/html/core/pull-frame-shape.js';

const W = 7, H = 9, board = { widthIn: W, heightIn: H };
const tpl = FRAME_DEFS.templates.find((t) => t.id === 'template_5');
const rec = normalizeFrameRecord({ templateId: 'template_5' });
const seeded = () => JSON.parse(JSON.stringify(frameSeedGeometry(tpl, frameCutProfile(FRAME_DEFS, rec, board), W, H)));
/** What the live Fusion sketch returned for arc_top_dip after Send (fusion_execute, merged add-in 086ffc8e). */
const FUSION_TOP_DIP = [[-1.17, 3.95249], [0.0, 3.65498], [1.17, 3.95249]];

describe('template_5 arc_top_dip, the real Fusion numbers', () => {
  it('the model seed really has the off-centre mid (the premise)', () => {
    const m = seeded().arc_top_dip.points[1];
    expect(m[0]).toBeCloseTo(0.01, 6);
    expect(m[1]).toBeCloseTo(3.655153, 5);
  });

  it('an untouched sketch reads unchanged', () => {
    const pulled = seeded();
    pulled.arc_top_dip = { points: FUSION_TOP_DIP };
    const r = fitPulledFrameShape(FRAME_DEFS, rec, board, pulled);
    expect(r.status).toBe('unchanged');
    expect(r.rows).toEqual([]);
    expect(r.worstIn).toBeLessThan(0.001);
  });

  it('an arc whose mid moved off the circle (ends unchanged) is still detected', () => {
    const pulled = seeded();
    pulled.arc_top_dip = { points: [FUSION_TOP_DIP[0], [0.0, 3.65498 + 0.05], FUSION_TOP_DIP[2]] };
    expect(fitPulledFrameShape(FRAME_DEFS, rec, board, pulled).status).not.toBe('unchanged');
  });

  it('an arc whose end moved is still detected', () => {
    const pulled = seeded();
    pulled.arc_top_dip = { points: [FUSION_TOP_DIP[0], FUSION_TOP_DIP[1], [1.17, 3.95249 - 0.05]] };
    expect(fitPulledFrameShape(FRAME_DEFS, rec, board, pulled).status).not.toBe('unchanged');
  });

  it('a mid flipped to the other side of the chord is a different arc, not unchanged', () => {
    const pulled = seeded();
    pulled.arc_top_dip = { points: [FUSION_TOP_DIP[0], [0.0, 3.95249 + 0.29751], FUSION_TOP_DIP[2]] };
    expect(fitPulledFrameShape(FRAME_DEFS, rec, board, pulled).status).not.toBe('unchanged');
  });
});
