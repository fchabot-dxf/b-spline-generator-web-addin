/**
 * svg-fill.js — SVG tiling generator for Fusion 360 import.
 *
 * Fusion 360's SVG importer treats 1 SVG user-unit as 1/96 inch ≈ 0.264 mm.
 * So to get millimetre-accurate output we multiply every mm value by 96/25.4.
 *
 * Usage:
 *   const svgString = generateTiledSvg(motifSvg, fillW, fillH, opts);
 *
 *   motifSvg  — SVG string of the single motif (as returned by MotifEditor.save())
 *   fillW     — total fill width  in mm
 *   fillH     — total fill height in mm
 *   opts      — { spacingX, spacingY, scale, rotation, offsetX, offsetY }
 *               all in mm / degrees
 *
 * Returns a self-contained SVG string ready to be written to disk and imported
 * into a Fusion 360 sketch via importManager.importToTarget().
 */

'use strict';

const MM_TO_PX = 96 / 25.4;   // 1 mm → 3.7795… SVG user-units

/**
 * Parse the viewBox or width/height of a motif SVG to get its intrinsic size
 * in user-units, then return { w, h } in those same units.
 */
function motifSize(svgEl) {
  const vb = svgEl.getAttribute('viewBox');
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
      return { w: parts[2], h: parts[3] };
    }
  }
  const w = parseFloat(svgEl.getAttribute('width')  || '0');
  const h = parseFloat(svgEl.getAttribute('height') || '0');
  if (w > 0 && h > 0) return { w, h };
  return { w: 100, h: 100 }; // fallback
}

/**
 * Extract the inner markup of the motif SVG (everything inside <svg>…</svg>).
 */
function motifInnerMarkup(svgEl) {
  return svgEl.innerHTML || new XMLSerializer().serializeToString(svgEl)
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
}

/**
 * Generate a tiled SVG.
 *
 * @param {string} motifSvg   — SVG markup of the motif
 * @param {number} fillW      — target fill width  (mm)
 * @param {number} fillH      — target fill height (mm)
 * @param {object} opts
 *   @param {number} opts.spacingX  — horizontal tile spacing (mm, default = motif width)
 *   @param {number} opts.spacingY  — vertical   tile spacing (mm, default = motif height)
 *   @param {number} opts.scale     — uniform scale factor (default 1)
 *   @param {number} opts.rotation  — rotation in degrees (default 0)
 *   @param {number} opts.offsetX   — phase shift X (mm, default 0)
 *   @param {number} opts.offsetY   — phase shift Y (mm, default 0)
 *   @param {boolean} opts.brickOffset — if true, odd rows are offset by spacingX/2
 * @returns {string} tiled SVG string
 */
function generateTiledSvg(motifSvg, fillW, fillH, opts = {}) {
  opts = Object.assign({
    spacingX: null,
    spacingY: null,
    scale: 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    brickOffset: false,
  }, opts);

  // Parse motif
  const parser = new DOMParser();
  const motifDoc = parser.parseFromString(motifSvg, 'image/svg+xml');
  const motifEl  = motifDoc.documentElement;

  // Intrinsic motif size in user-units (MotifEditor saves in px, 1:1)
  const intrinsic = motifSize(motifEl);
  const innerMark = motifInnerMarkup(motifEl);

  // Scale and spacing in px (SVG user-units)
  const s        = Math.max(0.01, opts.scale);
  const motifW   = intrinsic.w * s;                       // scaled motif width  (px)
  const motifH   = intrinsic.h * s;                       // scaled motif height (px)

  // Tiling parameters converted to px
  const spacingXpx = (opts.spacingX != null ? opts.spacingX * MM_TO_PX : motifW);
  const spacingYpx = (opts.spacingY != null ? opts.spacingY * MM_TO_PX : motifH);
  const fillWpx    = fillW * MM_TO_PX;
  const fillHpx    = fillH * MM_TO_PX;
  const offXpx     = opts.offsetX * MM_TO_PX;
  const offYpx     = opts.offsetY * MM_TO_PX;
  const rot        = opts.rotation;

  // How many tiles needed (overshoot by 1 on each side to cover rotation/offset)
  const cols = Math.ceil(fillWpx / spacingXpx) + 2;
  const rows = Math.ceil(fillHpx / spacingYpx) + 2;

  const ns = 'http://www.w3.org/2000/svg';
  const outW = fillWpx.toFixed(3);
  const outH = fillHpx.toFixed(3);

  let tilesMarkup = '';

  for (let row = -1; row < rows; row++) {
    for (let col = -1; col < cols; col++) {
      const brickShift = (opts.brickOffset && row % 2 !== 0) ? spacingXpx / 2 : 0;
      const tx = offXpx + col * spacingXpx + brickShift;
      const ty = offYpx + row * spacingYpx;

      // Build transform: translate to tile origin, then scale, then optionally rotate about motif centre
      let transform = `translate(${tx.toFixed(3)},${ty.toFixed(3)})`;
      if (Math.abs(rot) > 0.001) {
        const cx = (motifW / 2).toFixed(3);
        const cy = (motifH / 2).toFixed(3);
        transform += ` rotate(${rot.toFixed(3)},${cx},${cy})`;
      }
      if (Math.abs(s - 1) > 0.0001) {
        transform += ` scale(${s.toFixed(6)})`;
      }

      tilesMarkup += `<g transform="${transform}">${innerMark}</g>\n`;
    }
  }

  return (
    `<svg xmlns="${ns}" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">\n` +
    `<clipPath id="_fill_clip"><rect width="${outW}" height="${outH}"/></clipPath>\n` +
    `<g clip-path="url(#_fill_clip)">\n${tilesMarkup}</g>\n` +
    `</svg>`
  );
}

// ── Export ────────────────────────────────────────────────────────────────────
window.generateTiledSvg = generateTiledSvg;
window.MM_TO_PX = MM_TO_PX;
