/**
 * height/fill.js -- HEIGHT-PAINTER slice 2 (HEIGHT-PAINTER-DESIGN.md section 4 "Fill"): set a layer's heights to an exact
 * height inside the selection (or everywhere), with opacity: h (1 - a) + target a, a = opacity x the mask (a pixel the mask
 * leaves at 0 is never written). Pure.
 */

/** The fill tool at the start of a session (UI state; main/height-panel.js HEIGHT_TOOL_CONTROLS edit it). */
export const FILL_DEFAULTS = Object.freeze({ heightIn: 0.1, opacity: 1 });

/** Fill `data` (written in place) toward `heightIn` by `opacity` inside `mask` (Float32 0..1 per pixel, or null). */
export function applyFill(data, heightIn, opacity = 1, mask = null) {
  let n = 0;
  for (let k = 0; k < data.length; k++) {
    const a = mask ? opacity * mask[k] : opacity;
    if (!(a > 0)) continue;
    data[k] = a === 1 ? heightIn : data[k] * (1 - a) + heightIn * a;
    n++;
  }
  return n;
}
