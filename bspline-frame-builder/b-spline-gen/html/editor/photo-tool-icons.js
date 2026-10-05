/**
 * editor/photo-tool-icons.js -- F35 item 24 step 2 (Fred: the Photo toolbar gets the same treatment as the Brick
 * tools): one monochrome line icon per Photo tool, in the editor's icon box (24 units, round 2-unit strokes,
 * currentColor -- the button's idle / active colour drives it). Each glyph shows what the tool DOES to the photo;
 * none of them lays anything, so there is no engine miniature here (the Brick tools' own icons have one).
 * Declared per tool id (main/photo-panel.js PHOTO_TOOLS `iconSvg`).
 */
export const PHOTO_TOOL_ICONS = Object.freeze({
  // two crop corners framing a smaller picture
  crop: '<path d="M6 2v16h16"/><path d="M2 6h16v16"/>',
  // a tilted horizon brought level: the tilted line + the level line + a small turn arrow
  straighten: '<path d="M3 15 21 9" stroke-dasharray="2 2"/><path d="M3 12h18"/><path d="M17 4.5a6 6 0 0 1 3 3.5M20 4.5v3.5h-3.5"/>',
  // a quarter-turn arrow + a mirror line with two facing triangles
  rotateFlip: '<path d="M4 10a8 8 0 0 1 13.7-4.6M18 2v4h-4"/><path d="M12 13v9" stroke-dasharray="1.6 1.6"/><path d="M9.5 15v5L5 20z" fill="currentColor"/><path d="M14.5 15v5l4.5 0z"/>',
  // three level sliders (black / mid / white point)
  levels: '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="7" cy="6" r="1.8" fill="currentColor"/><circle cx="13" cy="12" r="1.8" fill="currentColor"/><circle cx="17" cy="18" r="1.8" fill="currentColor"/>',
  // a soft dot + its blur rings
  blur: '<circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="6.5" stroke-dasharray="2 2"/><circle cx="12" cy="12" r="10" stroke-width="1" stroke-dasharray="1.4 2.2" opacity="0.6"/>',
});

/** The Photo tool's icon as SVG markup at `sizePx`; null for a tool without one. */
export function photoToolIconSvg(toolId, sizePx = 20) {
  const glyph = PHOTO_TOOL_ICONS[toolId];
  if (!glyph) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" aria-hidden="true"`
    + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + `${glyph}</svg>`;
}
