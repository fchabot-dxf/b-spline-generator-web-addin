/**
 * Re-export façade. The implementation has moved to `core/stamp/`:
 *   - core/stamp/index.js      — rasterizeSvg main loop
 *   - core/stamp/sdf.js        — distance-transform + bilinear sampling
 *   - core/stamp/render-svg.js — SVG → canvas rendering (native + canvg fallback)
 *   - core/stamp/profiles/*    — one module per tool profile
 *
 * Existing imports of `'../core/stamp.js'` keep working unchanged.
 */
export { rasterizeSvg } from './stamp/index.js';
