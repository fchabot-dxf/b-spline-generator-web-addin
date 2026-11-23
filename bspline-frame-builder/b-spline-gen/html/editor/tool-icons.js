/**
 * editor/tool-icons.js -- the editor's SHARED tool glyphs (owner 2026-11-23: "reuse tool icons where it makes sense"): one
 * definition per action, referenced by every tab whose tool does it -- never a copy. The editor's line style: a 24-unit box,
 * round 2-unit strokes, currentColor (the button's idle / active colour drives it).
 *
 *   svg  -- the glyph's markup in the 24 box
 *   box  -- the viewBox a tool showing the glyph ALONE uses (the glyph's own extent, centred); a tab that composes it
 *           with more (the Brick brushes: + a miniature of the bricks) keeps the full 24 box
 *
 * Draw / Lattice tool icons stay on their buttons (bspline_gen_palette.html); a tool of another tab that does the same
 * action wears that button's svg (main/height-panel.js HEIGHT_TOOLS `iconFrom`).
 */
export const TOOL_GLYPHS = Object.freeze({
  // moved from editor/brick-tool-icons.js (the Brick and Raised brushes): the Height Brush paints too
  paintbrush: Object.freeze({
    svg: '<path d="M21.5 2.5 15 9"/><path d="M15 9 12.8 11.2" stroke-width="3.6"/>'
      + '<path d="M12.8 11.2c-2.2 0-3.5 1.3-3.8 3.8 2.5-.3 3.8-1.6 3.8-3.8z" fill="currentColor" stroke-width="1"/>',
    box: '6 -0.5 18 18',
  }),
});

/** A shared glyph on its own as SVG markup at `sizePx` (its own `box`); null for an unknown key. */
export function toolGlyphSvg(key, sizePx = 18) {
  const g = TOOL_GLYPHS[key];
  if (!g) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${g.box || '0 0 24 24'}" width="${sizePx}" height="${sizePx}" aria-hidden="true"`
    + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + `${g.svg}</svg>`;
}
