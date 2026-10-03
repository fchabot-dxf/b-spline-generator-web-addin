/**
 * F31 item 2c (Fred: "on the Flask the side can sometimes be one piece, I'd want a manual
 * toggle"): `frameJoinMarkers` (editor-frame-profile.js) -- each joinable template's own declared
 * joints (template_data.py `regions.joinable`), resolved to the SAME outer corner point
 * `frameMiters` itself computes. Pure function, no DOM (the tap-to-toggle wiring in
 * main/frame-panel.js and the on-canvas rendering are not unit tested here, same split every
 * other handle-drawing piece in this app already uses).
 */
import { describe, it, expect } from 'vitest';
import { frameCutProfile, frameInnerProfile, frameMiters, frameJoinMarkers, blankWidthIn, formatBlankWidthIn } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';

const JOINABLE_TEMPLATES = ['template_14', 'template_15', 'template_16', 'template_17'];
const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const board = { widthIn: 7, heightIn: 9 };

function profileFor(templateId, seeds = {}) {
  const rec = normalizeFrameRecord({ templateId, seeds });
  const outer = frameCutProfile(FRAME_DEFS, rec, board);
  const inner = frameInnerProfile(FRAME_DEFS, rec, board);
  return { rec, outer, inner };
}

describe('frameJoinMarkers', () => {
  it.each(JOINABLE_TEMPLATES)('%s: one marker per declared joinable joint, at a REAL frameMiters corner', (templateId) => {
    const tpl = tplOf(templateId);
    const { outer, inner } = profileFor(templateId);
    const markers = frameJoinMarkers(tpl, outer.primitives, inner.primitives, []);
    expect(markers).toHaveLength(tpl.regions.joinable.length);
    const miters = frameMiters(outer.primitives, inner.primitives);
    for (const m of markers) {
      const declared = tpl.regions.joinable.find((j) => j.id === m.id);
      expect(m.mirror).toBe(declared.mirror);
      // the marker's own anchor is EXACTLY one of frameMiters' own outer points (not independently
      // re-derived), confirmed by reference-equal coordinates, not just "close enough".
      expect(miters.some((q) => q.outer.x === m.anchor.x && q.outer.y === m.anchor.y)).toBe(true);
    }
  });

  it.each(JOINABLE_TEMPLATES)('%s: joined reflects the passed joinedIds exactly', (templateId) => {
    const tpl = tplOf(templateId);
    const { outer, inner } = profileFor(templateId);
    const [first] = tpl.regions.joinable;
    const markers = frameJoinMarkers(tpl, outer.primitives, inner.primitives, [first.id]);
    for (const m of markers) expect(m.joined).toBe(m.id === first.id);
  });

  it.each(JOINABLE_TEMPLATES)('%s: left/right markers are the exact mirror of each other (symmetric default shape)', (templateId) => {
    const tpl = tplOf(templateId);
    const { outer, inner } = profileFor(templateId);
    const markers = frameJoinMarkers(tpl, outer.primitives, inner.primitives, []);
    const cx = outer.region.x + outer.region.w / 2;
    const [a, b] = markers;
    expect(a.anchor.x - cx).toBeCloseTo(-(b.anchor.x - cx), 9);
    expect(a.anchor.y).toBeCloseTo(b.anchor.y, 9);
  });

  it('a template with no declared joinable joints (Template 1) returns an empty list', () => {
    const tpl = tplOf('template_1');
    const { outer, inner } = profileFor('template_1');
    expect(frameJoinMarkers(tpl, outer.primitives, inner.primitives, [])).toEqual([]);
  });

  it('absent/malformed inner primitives return an empty list rather than throwing', () => {
    const tpl = tplOf('template_15');
    const { outer } = profileFor('template_15');
    expect(frameJoinMarkers(tpl, outer.primitives, null, [])).toEqual([]);
    expect(frameJoinMarkers(tpl, outer.primitives, [], [])).toEqual([]);
    expect(frameJoinMarkers(null, outer.primitives, outer.primitives, [])).toEqual([]);
  });

  it('an unknown joinedIds entry is simply not reflected (never throws)', () => {
    const tpl = tplOf('template_15');
    const { outer, inner } = profileFor('template_15');
    const markers = frameJoinMarkers(tpl, outer.primitives, inner.primitives, ['not-a-real-id']);
    expect(markers.every((m) => m.joined === false)).toBe(true);
  });
});

describe('blankWidthIn / formatBlankWidthIn', () => {
  it.each(JOINABLE_TEMPLATES)('%s: every declared joint has a positive width, at least frame_thickness', (templateId) => {
    const tpl = tplOf(templateId);
    const { outer, inner } = profileFor(templateId);
    const t = tpl.params.find((p) => p.name === 'frame_thickness').default;
    for (const j of tpl.regions.joinable) {
      const w = blankWidthIn(tpl, outer.primitives, inner.primitives, j.id);
      expect(w, j.id).not.toBeNull();
      // the inner/outer edges are already `t` apart everywhere; a bend or curve along the piece can
      // only ADD to the perpendicular span, never shrink it below that floor.
      expect(w, j.id).toBeGreaterThanOrEqual(t - 1e-9);
    }
  });

  it.each(JOINABLE_TEMPLATES)('%s: the mirrored left/right joints measure the same width (symmetric default)', (templateId) => {
    const tpl = tplOf(templateId);
    const { outer, inner } = profileFor(templateId);
    const [a, b] = tpl.regions.joinable;
    const wa = blankWidthIn(tpl, outer.primitives, inner.primitives, a.id);
    const wb = blankWidthIn(tpl, outer.primitives, inner.primitives, b.id);
    expect(wa).toBeCloseTo(wb, 9);
  });

  it('an unknown joinId, or a mismatched inner profile, returns null rather than throwing', () => {
    const tpl = tplOf('template_15');
    const { outer, inner } = profileFor('template_15');
    expect(blankWidthIn(tpl, outer.primitives, inner.primitives, 'not-a-real-id')).toBeNull();
    expect(blankWidthIn(tpl, outer.primitives, null, 'neckBottomR')).toBeNull();
    expect(blankWidthIn(null, outer.primitives, inner.primitives, 'neckBottomR')).toBeNull();
  });

  it('formatBlankWidthIn: the advisor\'s own worked example, plus whole inches and unreduced fractions', () => {
    expect(formatBlankWidthIn(1.0625)).toBe('1 1/16 in'); // the advisor's own example
    expect(formatBlankWidthIn(2)).toBe('2 in');
    expect(formatBlankWidthIn(0.75)).toBe('3/4 in'); // reduced from 12/16, no leading "0 "
    expect(formatBlankWidthIn(1.0)).toBe('1 in');
    expect(formatBlankWidthIn(1.7319180598261785)).toBe('1 3/4 in'); // rounds to the nearest 16th
  });

  it('formatBlankWidthIn: non-finite input is null, never a crash or "NaN in"', () => {
    expect(formatBlankWidthIn(NaN)).toBeNull();
    expect(formatBlankWidthIn(null)).toBeNull();
    expect(formatBlankWidthIn(undefined)).toBeNull();
  });
});
