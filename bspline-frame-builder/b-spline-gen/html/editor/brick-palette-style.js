/**
 * The 2D view's brick palette (core/bricks/palette.js paletteCss): ONE page-level <style> (like the accent outline,
 * editor-brick-tool.js ensureAccentOutlineStyle), so no serialized drawing -- the editor's save(), Send's Bricks sketch,
 * the height mask's DOM read -- ever carries it. Empty in the Height look.
 */
import { paletteCss, PALETTE_STYLE_ID } from '../core/bricks/palette.js';

/** Writes the rules for `settings`; returns the CSS (''= nothing painted). */
export function applyBrickPalette(settings, doc = typeof document !== 'undefined' ? document : null) {
  const css = paletteCss(settings);
  if (!doc || !doc.head) return css;
  let style = doc.getElementById(PALETTE_STYLE_ID);
  if (!style) {
    if (!css) return css;
    style = doc.createElement('style');
    style.id = PALETTE_STYLE_ID;
    doc.head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
  return css;
}
