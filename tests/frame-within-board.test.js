/**
 * H23 item 8 (downgraded to a cheap safeguard, per the advisor): every template's
 * drawn OUTER profile must stay within the board -- the frame's outer edge is the
 * board outline, it must never run past it. Motivated by a phone screenshot of a
 * frame drawn above the board's dashed edge (traced to an unfinished seat-B
 * template, not one of these six, but nothing already caught this class of bug
 * for templates 1-6 either).
 *
 * `fit.ok` (frameFit) is a DIFFERENT question -- whether the frame's thickness
 * physically fits the board's safe zone -- not whether the drawn outer silhouette
 * stays inside the board edge. Only Template 6 is clamped to the thickness rule
 * (FRAME_CLAMPED_PRESETS, editor-frame-profile.js); every other template is
 * "drawn exactly as before" per that file's own comment, so this check applies
 * regardless of fit.ok -- an overflowing outline is a real on-screen bug even
 * when the frame is reported as not fitting.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { samplePairedOutlines } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';

const SIZES = [{ widthIn: 7, heightIn: 9 }, { widthIn: 12, heightIn: 6 }, { widthIn: 5.51, heightIn: 1.97 }];
const EPS_IN = 1e-6;

/** Points outside [0,W]x[0,H] (editor coords: x,y-down from the top-left,
 *  same convention frame-mesh.js's own world-mapping comment documents) --
 *  the board itself, never the inset `region` a non-zero boundingboxoffset
 *  draws within. Returns the worst offender, or null if everything is inside. */
function worstOutOfBoard(points, W, H, eps) {
  let worst = null;
  for (const p of points) {
    const over = Math.max(-p.x, p.x - W, -p.y, p.y - H);
    if (over > eps && (!worst || over > worst.over)) worst = { ...p, over };
  }
  return worst;
}

describe('worstOutOfBoard (the check itself, not the app)', () => {
  it('flags a point past the board edge -- proves the check can fail before trusting it on the app', () => {
    const bad = worstOutOfBoard([{ x: 3, y: -0.5 }, { x: 3, y: 4 }], 7, 9, EPS_IN);
    expect(bad).not.toBeNull();
    expect(bad.y).toBe(-0.5);
  });

  it('passes every point strictly inside the board', () => {
    expect(worstOutOfBoard([{ x: 0, y: 0 }, { x: 7, y: 9 }, { x: 3.5, y: 4.5 }], 7, 9, EPS_IN)).toBeNull();
  });
});

describe('H23 item 8: every template\'s outer profile stays within the board', () => {
  for (const tpl of FRAME_DEFS.templates) {
    for (const { widthIn: W, heightIn: H } of SIZES) {
      it(`${tpl.id} at ${W}x${H}`, () => {
        const prof = frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: tpl.id }), { widthIn: W, heightIn: H });
        expect(prof).not.toBeNull();
        if (prof.defects.length) return; // a broken construction is a different, already-tracked class of bug
        const outer = samplePairedOutlines(prof.primitives, prof.primitives, 0.02).outer;
        const bad = worstOutOfBoard(outer, W, H, EPS_IN);
        expect(bad, bad ? `point (${bad.x},${bad.y}) is ${bad.over.toFixed(4)}in past the board` : '').toBeNull();
      });
    }
  }
});
