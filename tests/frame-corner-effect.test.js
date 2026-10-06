/**
 * Item 74b (Fred: grey + explain; measured live: on T18 7x9 at 1.25 in the Corners row's Butt / Block / Lapped re-laid the
 * identical frame -- its only square corners sit on 1.11 in stubs, shorter than the 1.25 in band): a corner choice is
 * greyed, 'No square corner here is long enough at this brick size', while it would re-lay the identical frame.
 * The fact is the engine's (contour-bands.js frameCornerEffect: the planned rows' joints alone, no pieces laid), not a
 * clamp; the mitre is never greyed.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands, frameCornerEffect, CORNER_CUT_STYLES } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { BRICK_CONTROL_REQUIRES, requirementMet, CORNER_NOT_LONG_ENOUGH, cornerFact } from '../bspline-frame-builder/b-spline-gen/html/main/brick-control-requires.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0];
function contour(templateId, W = 7, H = 9) {
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId }), board: { widthIn: W, heightIn: H } }, 0, 0);
  return buildRibbonPrimitives(sil.primitives);
}
const opts = (L) => ({ set: SET, seed: 1, scale: L / SET.brickLengthIn });
const withCorner = (preset, style) => FRAME_PRESETS[preset].map((b) => ({ ...b, cornerStyle: style }));
const layKey = (prims, preset, style, L) => JSON.stringify(bricksContourBands(prims, withCorner(preset, style), opts(L)).bricks.map((b) => b.polygon));

describe('frameCornerEffect: the cases Fred was shown', () => {
  it('T18 at 1.25 in: Butt / Block / Lapped would re-lay the identical frame (greyed); the mitre stays', () => {
    expect(frameCornerEffect(contour('template_18'), FRAME_PRESETS.single_soldier, opts(1.25))).toEqual({ mitre: true, butt: false, block: false, lapped: false });
  });
  it('T18 at 0.75 in: the band fits the 1.11 in stubs -- Butt is live', () => {
    expect(frameCornerEffect(contour('template_18'), FRAME_PRESETS.single_soldier, opts(0.75)).butt).toBe(true);
  });
  it('T1 at 1.25 in: every corner choice is live', () => {
    expect(frameCornerEffect(contour('template_1'), FRAME_PRESETS.single_soldier, opts(1.25))).toEqual({ mitre: true, butt: true, block: true, lapped: true });
  });
});

describe('frameCornerEffect is the lay: effective exactly when that corner lays a different frame than the mitre', () => {
  const CASES = [];
  for (const t of ['template_1', 'template_5', 'template_8', 'template_11', 'template_12', 'template_18']) {
    for (const L of [0.75, 1.25]) CASES.push([t, 'single_soldier', L]);
  }
  CASES.push(['template_11', 'double_course', 1.25], ['template_18', 'double_course', 0.75]);
  it.each(CASES)('%s %s at %s in', (templateId, preset, L) => {
    const prims = contour(templateId);
    const effect = frameCornerEffect(prims, FRAME_PRESETS[preset], opts(L));
    const mitre = layKey(prims, preset, 'mitre', L);
    for (const style of CORNER_CUT_STYLES) expect(effect[style], style).toBe(layKey(prims, preset, style, L) !== mitre);
  });
});

describe('the Corners row: declared rules', () => {
  const rules = BRICK_CONTROL_REQUIRES.filter((r) => r.why === CORNER_NOT_LONG_ENOUGH);
  it('one rule per cutting style, on its own button; the mitre has none', () => {
    expect(rules.map((r) => r.controls)).toEqual(CORNER_CUT_STYLES.map((s) => [`brickFrameCorner_${s}`]));
    expect(BRICK_CONTROL_REQUIRES.some((r) => r.controls.includes('brickFrameCorner_mitre'))).toBe(false);
  });
  it('greyed while its fact is false, live when true or unknown (no frame contour = no facts)', () => {
    const rule = rules[0];
    expect(requirementMet(rule.requires, null, { facts: { [cornerFact('butt')]: false } })).toBe(false);
    expect(requirementMet(rule.requires, null, { facts: { [cornerFact('butt')]: true } })).toBe(true);
    expect(requirementMet(rule.requires, null, { facts: {} })).toBe(true);
  });
});
