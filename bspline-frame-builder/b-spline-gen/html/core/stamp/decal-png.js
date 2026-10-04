/**
 * H23 item 71: the artwork-colour transparent PNG (item 68's own spike, `tools/repro/
 * decal_png_spike.mjs`) promoted to a real module -- renders ONLY the colour-carrying artwork
 * (rails/ties/nodes/stripes/contour), alpha=0 everywhere else, board-aligned, for Fusion's decal
 * API (component.decals.createInput). Reuses the app's own real pipeline end-to-end: editor.save()
 * -> buildDrapeSvg (already filters to colour-carrying layers only) -> sanitizeSvgForRaster ->
 * prepareSvgForRaster -> renderSvgNative -- no reimplementation.
 */
import { buildDrapeSvg } from '../preview/drape-svg.js';
import { sanitizeSvgForRaster, prepareSvgForRaster, renderSvgNative } from './render-svg.js';

/**
 * @param {object} editor - window.svgEditor
 * @param {object} [opts]
 * @param {number} [opts.dpi=150] - px/in (40 / 100 / 150 are the declared UI choices)
 * @param {number} [opts.opacity=100] - 0..100, applied as a flat multiplier over the whole PNG
 * @param {object|null} [opts.layerIds=null] - { [layerId]: boolean }; a layer is INCLUDED unless
 *   explicitly `false` (missing/true both mean included -- same "visible !== false" convention
 *   editor/layers.js already uses everywhere else). null/undefined = every layer included.
 * @returns {Promise<string|null>} a 'data:image/png;base64,...' data URL, or null if there is
 *   nothing to render (no colour-carrying layers qualify).
 */
export async function buildArtworkDecalPng(editor, opts = {}) {
  const dpi = Number(opts.dpi) || 150;
  const opacityIn = Number.isFinite(Number(opts.opacity)) ? Number(opts.opacity) : 100;
  const opacity = Math.max(0, Math.min(100, opacityIn));
  const layerIds = opts.layerIds || null;

  if (!editor) return null;
  const allLayers = Array.isArray(editor._layers) ? editor._layers : [];
  const layers = layerIds
    ? allLayers.filter((l) => layerIds[l.id] !== false)
    : allLayers;

  const sketchSvg = editor.save(editor, 96);
  const drapeSvg = buildDrapeSvg(layers, sketchSvg);
  if (!drapeSvg) return null;

  const mW = editor._mW, mH = editor._mH;
  const pxW = Math.round(mW * dpi), pxH = Math.round(mH * dpi);
  if (!(pxW > 0) || !(pxH > 0)) return null;

  const safe = prepareSvgForRaster(sanitizeSvgForRaster(drapeSvg), pxW, pxH);
  const canvas = document.createElement('canvas');
  canvas.width = pxW; canvas.height = pxH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.globalAlpha = opacity / 100;
  await renderSvgNative(ctx, safe, pxW, pxH);
  return canvas.toDataURL('image/png');
}
