/**
 * Rails custom-position + lock slice (seat D 2026-10-16; advisor 45, Fred's pre-decided design): computePattern
 * places each `pattern.rails.custom` entry (core/pull-rails.js's own matchPulledRails output, {id, at}) on the
 * row its own `at` fraction names -- the SAME offset-fraction placement protectedRails[].at already gets
 * (lattice-protected-rails.test.js), reusing the SAME row-insertion math (_insertAtFractions). Unlike a protected
 * rail, a custom rail with no nearby generated row becomes a genuinely NEW, uneven row (Fred: rails may be
 * spaced unevenly on purpose) -- it is never snapped back onto the regular grid.
 */
import { describe, it, expect } from 'vitest';
import { computePattern, PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

const extent = { iMin: 0, jMin: 0, iMax: 10, jMax: 10 };
const base = { ...PATTERN_DEFAULTS, seed: 3, rails: { ...PATTERN_DEFAULTS.rails, mode: 'every', every: 2, offset: 0 } };
const rails = (r) => r.segments.filter((s) => s.kind === 'rail');

describe('rails.custom: a Pull-applied rail keeps its own row', () => {
  it('no custom rails (the empty default every existing saved pattern has): output identical to before', () => {
    const a = computePattern(base, { extent });
    const b = computePattern({ ...base, rails: { ...base.rails, custom: [] } }, { extent });
    expect(b).toEqual(a);
  });

  it('a custom row close to a generated one REPLACES it -- same row count, that row just moved slightly', () => {
    const before = computePattern(base, { extent });
    const withCustom = computePattern({ ...base, rails: { ...base.rails, custom: [{ id: 'rail1', at: 0.41 } ] } }, { extent }); // near row j=4 (every 2 from 0: 0,2,4,6,8,10)
    expect(rails(withCustom)).toHaveLength(rails(before).length);
    expect(rails(withCustom).some((s) => s.a.j === 4.1)).toBe(true);
    expect(rails(withCustom).some((s) => s.a.j === 4)).toBe(false); // the row it replaced is gone, not doubled
  });

  // every row in a UNIFORM "every" grid sits within half a gap of ITS own nearest neighbour by construction, so
  // a lone custom rail always finds something close enough to replace -- a genuinely far target only exists once
  // an EARLIER custom rail has already claimed the nearest row (two rails pulled close together in Fusion).
  it('two custom rows pulled close together: the second, displaced past half the gap, becomes a genuine NEW, uneven row', () => {
    const before = computePattern(base, { extent });
    const custom = [{ id: 'rail1', at: 0.41 }, { id: 'rail2', at: 0.45 }]; // j=4.1 (claims row 4), then j=4.5
    const withCustom = computePattern({ ...base, rails: { ...base.rails, custom } }, { extent });
    expect(rails(withCustom)).toHaveLength(rails(before).length + 1); // one MORE row, not a replacement
    expect(rails(withCustom).some((s) => s.a.j === 4.1)).toBe(true);
    expect(rails(withCustom).some((s) => s.a.j === 4.5)).toBe(true); // too far from row 6 (1.5 > half the gap, 1) to replace it
    expect(rails(withCustom).some((s) => s.a.j === 6)).toBe(true); // row 6 itself is untouched -- never snapped onto
  });

  it('outside the extent: dropped, same as a protected rail', () => {
    const r = computePattern({ ...base, rails: { ...base.rails, custom: [{ id: 'rail1', at: 4 } ] } }, { extent });
    expect(rails(r).some((s) => s.a.j === 40)).toBe(false);
  });

  it('works in vertical orientation (the row is a column in real space), same as a protected rail', () => {
    const r = computePattern({ ...base, orientation: 'vertical', rails: { ...base.rails, custom: [{ id: 'rail1', at: 0.73 } ] } }, { extent });
    expect(rails(r).some((s) => s.a.i === 7.3 && s.b.i === 7.3)).toBe(true);
  });

  // Fred's pre-decided design: "custom position and protected style/cut coexist on the same rail" -- a rail the
  // user BOTH moved (rails.custom) AND styled/cut (protectedRails, captured fresh from the drawn DOM every
  // generate) keeps BOTH: its custom row AND its style tag. Custom rails are placed FIRST (_placeCustomRails,
  // before _placeProtectedRails runs), so the protected capture's OWN `.at` -- read back from the SAME drawn
  // row the custom placement just put there -- finds it as its own nearest match and re-styles it in place.
  it('custom position AND protected style coexist on the SAME rail when both target the same row', () => {
    const pr = { j: 4.1, at: 0.41, span: 0, spans: 1, pieces: [{ len: 10, color: '#f00', stripe: null }] };
    const r = computePattern({ ...base, rails: { ...base.rails, custom: [{ id: 'rail1', at: 0.41 }] }, protectedRails: [pr] }, { extent });
    const seg = rails(r).find((s) => s.a.j === 4.1);
    expect(seg).toBeTruthy();
    expect(seg.protect).toBe(0); // the style tag landed on the SAME (custom-placed) row, not a duplicate second one
    expect(rails(r)).toHaveLength(rails(computePattern(base, { extent })).length); // a replace, same row count as plain custom alone
  });
});
