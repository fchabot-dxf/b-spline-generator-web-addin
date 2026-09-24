/**
 * SE8d / SA-ROUNDTRIP-2 — a rotated or non-uniformly-scaled `<text>` used
 * to carve upright at the wrong size: `_carveTextAnchor` (editor-io.js)
 * unconditionally cleared the `transform` and scaled `font-size` by
 * `Math.abs(m.a)` alone — correct only with no rotation/skew and uniform
 * scale. A 0.5"-font text rotated 45° carved perfectly upright at
 * font-size 33.94 instead of 48 (ratio exactly cos(45°) = 0.7071),
 * silently — no error, wrong glyph orientation AND size.
 *
 * Ground truth checked before fixing: the stamp PREVIEW (saveForRasterization,
 * editor-io.js) serializes the raw editor content and renders it via the
 * browser's own SVG engine (or canvg) — real SVG rendering respects
 * `transform` correctly, so a rotated text already previews right. Only the
 * FUSION BAKE (bakeSvgForCarving) is broken: its own docstring already
 * states Fusion's SVG importer "ignores viewBox/scale/element transforms"
 * — so leaving the rotation as a `transform` on the baked `<text>` (the
 * OTHER option NEXT-SESSION.md offered) would import upright regardless.
 * Only baked PATH geometry survives the importer, so path conversion (via
 * the existing opentype.js Expand pipeline, extracted into the reusable
 * textGlyphPathD so the Fusion bake doesn't duplicate font-loading logic)
 * is the only option that "keeps glyph orientation correct" for Fusion.
 *
 * `_needsGlyphBake` is the gate: the common case (untransformed, or
 * uniformly-scaled/translated text) skips the path conversion (and its
 * network font-fetch) entirely and keeps the cheap anchor+font-size bake,
 * which IS correct for that case. Exported (despite the underscore) for
 * direct testing — same convention as `_reconcileLayersFromSvg` (SE8a).
 *
 * What ISN'T covered here, and why: the full glyph-bake success path
 * (`_carveText` building a real `<path>` from `textGlyphPathD`'s output
 * and swapping it into the DOM tree) needs BOTH real svg.js (`_carveText`/
 * `bakeSvgForCarving` bail out early — `typeof SVG === 'undefined'` — in
 * every existing test in this repo; none load the real library) and a real
 * network font fetch (opentype.js via esm.sh) — the same two limitations
 * already documented for canvas rasterization (SE3a) and embedded-font CSS
 * (SE8a/b). `textGlyphPathD`'s no-font-mapping fast path (below) needs
 * neither and IS covered directly; the coordinate bake itself reuses
 * `transformPoint`, already thoroughly tested elsewhere (editor-coords.test.js,
 * expand-transform.test.js) — no new coordinate math is introduced here,
 * only the detection gate that decides which bake path applies.
 */
import { describe, it, expect } from 'vitest';
import { _needsGlyphBake } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';
import { textGlyphPathD } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-expand-text.js';

function m(a, b, c, d, e = 0, f = 0) {
  return { a, b, c, d, e, f };
}

describe('_needsGlyphBake', () => {
  it('identity: no bake needed', () => {
    expect(_needsGlyphBake(m(1, 0, 0, 1))).toBe(false);
  });

  it('pure translation: no bake needed', () => {
    expect(_needsGlyphBake(m(1, 0, 0, 1, 50, -20))).toBe(false);
  });

  it('uniform scale (the common carve case, a=d=dpi): no bake needed', () => {
    expect(_needsGlyphBake(m(96, 0, 0, 96))).toBe(false);
  });

  it('rotation (b/c nonzero): needs a bake — reproduces the 45°-rotated-text defect', () => {
    // A real 45° rotation composed with carveMatrix's dpi=96 scale.
    const rad = Math.PI / 4;
    const s = Math.sin(rad), c = Math.cos(rad);
    const rotated = m(96 * c, 96 * s, -96 * s, 96 * c);
    expect(_needsGlyphBake(rotated)).toBe(true);
    // Non-vacuous: the OLD formula's own scale factor for this exact
    // matrix is cos(45°) = 0.7071 — the documented "48 -> 33.94" bug
    // (0.5in font, 96 dpi: 0.5*96=48 world-px; 48*cos(45°)=33.94), which
    // _needsGlyphBake now correctly flags as wrong rather than silently
    // accepting the old |m.a|-only shortcut.
    const oldFactor = Math.abs(rotated.a) / 96; // what _carveTextAnchor used to multiply font-size by
    expect(oldFactor).toBeCloseTo(Math.cos(rad), 6);
    expect(oldFactor).not.toBeCloseTo(1, 2); // i.e. NOT the correct (unrotated) scale
  });

  it('skew (c nonzero, b zero): needs a bake', () => {
    expect(_needsGlyphBake(m(96, 0, 20, 96))).toBe(true);
  });

  it('non-uniform scale, no rotation: needs a bake', () => {
    expect(_needsGlyphBake(m(96, 0, 0, 144))).toBe(true); // sx != sy
  });

  it('non-uniform scale is caught with a RELATIVE epsilon, not an absolute one tuned for inch-scale numbers', () => {
    // At dpi=96 scale, a genuinely-uniform matrix can differ by ordinary
    // floating error (e.g. from repeated matrix composition) without being
    // a real defect — must not false-positive on that.
    expect(_needsGlyphBake(m(96.0000001, 0, 0, 95.9999999))).toBe(false);
    // But a REAL, small-in-absolute-terms but large-in-relative-terms
    // difference at a SMALL scale must still be caught.
    expect(_needsGlyphBake(m(1, 0, 0, 1.5))).toBe(true);
  });

  it('null/undefined matrix: no bake needed (identity fallback)', () => {
    expect(_needsGlyphBake(null)).toBe(false);
    expect(_needsGlyphBake(undefined)).toBe(false);
  });
});

function mockTextEl(attrs = {}, textContent = 'Hi') {
  return {
    attr: (name) => attrs[name],
    node: { childNodes: [] },
    text: () => textContent,
  };
}

describe('textGlyphPathD: no-font-mapping fast path (no network reachable in this environment)', () => {
  it('returns null for a font-family with no bundled mapping, without attempting a font fetch', async () => {
    const el = mockTextEl({ 'font-family': 'Definitely Not A Bundled Font', 'font-size': '10' });
    const result = await textGlyphPathD(el, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(result).toBeNull();
  });
});
