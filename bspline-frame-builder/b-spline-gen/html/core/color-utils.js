/**
 * color-utils.js — small, shared colour-manipulation helpers.
 *
 * First consumer: H8 (Fred: "make frame colour a bit different than board,
 * tiny bit"). The frame's own preview colour is derived from the chosen
 * wood's board colour through the ONE declared FRAME_TINT offset below,
 * applied by the ONE frameTintColor() function — core/preview/frame-mesh.js
 * (the 3D bars) and editor/editor-frame-profile.js (the 2D frame band) both
 * call it rather than each hand-rolling its own shift, so the two surfaces
 * can never drift apart into two different numbers.
 */

/** Lightness shift (HSL) applied to a wood's own preview colour to get the
 *  frame's colour. Negative = darker. -0.08 (8% darker) reads as "a
 *  distinctly deeper tone of the same wood" without looking like a
 *  different material — Fred's own "tiny bit different, not a different
 *  wood" framing. A hue shift was the other option the dispatch offered;
 *  lightness was picked because it stays correct across every declared
 *  wood's own hue (a fixed hue shift can look right on one wood and off on
 *  another with a very different base hue). */
export const FRAME_TINT = -0.08;

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** The frame's own colour, derived from `boardHex` (a wood's preview
 *  colour, e.g. Ash `#d9c9a3`) by the declared FRAME_TINT. Returns
 *  `boardHex` unchanged if it isn't a plain `#rrggbb` string (callers
 *  already have their own fallback for a missing/unknown colour; this
 *  never throws on one). */
export function frameTintColor(boardHex) {
  const hsl = hexToHsl(boardHex);
  if (!hsl) return boardHex;
  const l = Math.max(0, Math.min(1, hsl.l + FRAME_TINT));
  return hslToHex(hsl.h, hsl.s, l);
}
