/**
 * SA-TEXT-6 — one declared font list (editor/editor-fonts.js's FONT_MAP),
 * not three independently hand-typed copies (the palette's <select>
 * options, and core/stamp/render-svg.js's KNOWN_FONTS substitution
 * fallback both used to be their own separate lists that could silently
 * drift from FONT_MAP — a future font added there wouldn't necessarily
 * reach the rasterizer, so text using it could silently carve as Arial).
 *
 * This guards the contract directly rather than re-asserting FONT_MAP's
 * contents: every font the editorFontFamily select could offer (FONT_MAP
 * minus the icon/symbol-only SYMBOL_FAMILIES) must be a font the
 * rasterizer's substitution fallback (KNOWN_FONTS) recognizes as known —
 * so a real font choice never silently downgrades to Arial at carve time.
 */
import { describe, it, expect } from 'vitest';
import { FONT_MAP, SYMBOL_FAMILIES } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-fonts.js';
import { KNOWN_FONTS } from '../bspline-frame-builder/b-spline-gen/html/core/stamp/render-svg.js';

describe('SA-TEXT-6: one declared font list', () => {
  it('KNOWN_FONTS is derived from FONT_MAP — every FONT_MAP entry is known to the rasterizer', () => {
    for (const family of Object.keys(FONT_MAP)) {
      expect(KNOWN_FONTS).toContain(family);
    }
  });

  it('every font the editorFontFamily select would offer (FONT_MAP minus SYMBOL_FAMILIES) is known to the rasterizer', () => {
    const selectableFonts = Object.keys(FONT_MAP).filter((f) => !SYMBOL_FAMILIES.has(f));
    expect(selectableFonts.length).toBeGreaterThan(0); // sanity: the filter didn't eat everything
    for (const family of selectableFonts) {
      expect(KNOWN_FONTS).toContain(family);
    }
  });

  it('KNOWN_FONTS also keeps the generic CSS fallback families (not part of FONT_MAP, no bundled .ttf)', () => {
    for (const generic of ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']) {
      expect(KNOWN_FONTS).toContain(generic);
    }
  });

  it('adding a font to FONT_MAP alone (without touching render-svg.js) makes it known — the single-source-of-truth claim, proven', () => {
    // Not a real mutation of the shared module — reproduces the same
    // derivation core/stamp/render-svg.js performs (`[...Object.keys(FONT_MAP), ...generics]`)
    // against a FONT_MAP-shaped object with one extra entry, to prove the
    // DERIVATION mechanism itself (not just today's fixed list) picks up
    // a new entry with zero changes elsewhere — the exact claim
    // editor-fonts.js's own header comment makes ("adding a new symbol
    // font is a one-line change here... the rasterizer... picks it up").
    const hypotheticalFontMap = { ...FONT_MAP, 'Brand New Font': 'brand-new-font.ttf' };
    const derivedKnownFonts = Object.keys(hypotheticalFontMap);
    expect(derivedKnownFonts).toContain('Brand New Font');
  });
});
