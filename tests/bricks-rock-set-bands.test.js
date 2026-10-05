/**
 * Fred (live, 2026-10-04): "White rock frame bands are ugly ... it just uses the same logic as red brick, but
 * it's wrong for it" -- with Set White Rocks a frame band was laid as a brick COURSE (soldier/stretcher pieces
 * cut from rock textures). Declared rule (contour-bands.js setBandPattern): a set whose own layout is a
 * band-capable area pattern (White Rocks: 'fieldstone') lays EVERY band of a closed contour as that pattern's
 * ring, whatever pattern the band names. A brick set keeps each band's own pattern; an open brush stroke (no
 * ring) keeps its own too.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands, setBandPattern } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const ROCKS = BRICK_SETS.find((s) => s.layout === 'fieldstone');
const RED = BRICK_SETS.find((s) => s.layout === 'bond');

function t1Primitives() {
  const record = normalizeFrameRecord({ templateId: 'template_1' });
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record, board: { widthIn: 7, heightIn: 9 } }, 0, 0);
  return buildRibbonPrimitives(sil.primitives);
}
const COURSE_BANDS = [{ widthIn: 0.75, pattern: 'soldier' }, { widthIn: 0.75, pattern: 'stretcher' }];

describe('a rock set lays every frame band as its own fieldstone ring', () => {
  it('declares the rule from the set, not from the band', () => {
    expect(ROCKS && RED).toBeTruthy();
    expect(setBandPattern(ROCKS)).toBe('fieldstone');
    expect(setBandPattern(RED)).toBe(null);
    expect(setBandPattern(ROCKS, false)).toBe(null); // an open stroke has no ring
  });

  it('White Rocks + soldier/stretcher bands on T1: every piece is a fieldstone stone, both bands filled', () => {
    const { bricks } = bricksContourBands(t1Primitives(), COURSE_BANDS, { set: ROCKS, seed: 1 });
    expect(bricks.length).toBeGreaterThan(0);
    const notStone = bricks.filter((b) => !String(b.id).startsWith('fieldstone-'));
    expect(notStone.map((b) => b.id).slice(0, 3)).toEqual([]);
    expect(new Set(bricks.map((b) => b.bandIndex))).toEqual(new Set([0, 1]));
  });

  it('Red Brick + the same bands: course pieces as before (the rule does not touch brick sets)', () => {
    const { bricks } = bricksContourBands(t1Primitives(), COURSE_BANDS, { set: RED, seed: 1 });
    expect(bricks.length).toBeGreaterThan(0);
    expect(bricks.some((b) => String(b.id).startsWith('fieldstone-'))).toBe(false);
  });
});
