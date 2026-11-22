/**
 * height/selection.js -- HEIGHT-PAINTER slice 2 (HEIGHT-PAINTER-DESIGN.md section 4 "Selection"): a SELECTION MASK over a
 * patch's pixel grid -- a Float32Array 0..1 (1 = fully selected), cols x rows in the raster frame (row 0 = the patch's
 * BOTTOM edge, core/height/layer.js). Session UI state: never stored with the project. Every tool multiplies its effect
 * by it (core/height/brush.js `mask`, gradient.js, fill).
 *
 * Shapes are tested at the PIXEL CENTRES (c, r): a rectangle or ellipse between two corner points, a lasso (a closed
 * pointer path, even-odd), or an SVG shape of the Draw tab rendered into the patch's pixel frame by the app's own SVG
 * renderer (core/stamp/render-svg.js: sanitise + the browser's native render), its anti-aliased alpha as the mask.
 * (core/stamp/sdf.js computeSDF thresholds the alpha at 127, so the coverage reads the alpha itself.)
 */
import { sanitizeSvgForRaster, renderSvgNative } from '../stamp/render-svg.js';
import { normaliseHeightLayer } from './layer.js';
import { patchGrid } from './compose.js';

/** Pixels whose centre lies in the box between corner points (c0, r0) and (c1, r1), either order, edges included. */
export function rectMask(cols, rows, c0, r0, c1, r1) {
  const m = new Float32Array(cols * rows);
  const ca = Math.max(0, Math.ceil(Math.min(c0, c1))), cb = Math.min(cols - 1, Math.floor(Math.max(c0, c1)));
  const ra = Math.max(0, Math.ceil(Math.min(r0, r1))), rb = Math.min(rows - 1, Math.floor(Math.max(r0, r1)));
  for (let r = ra; r <= rb; r++) m.fill(1, r * cols + ca, r * cols + cb + 1);
  return m;
}

/** The ellipse inscribed in that box (pixel centres with ((c - cx) / rx)^2 + ((r - cy) / ry)^2 <= 1). */
export function ellipseMask(cols, rows, c0, r0, c1, r1) {
  const m = new Float32Array(cols * rows);
  const cx = (c0 + c1) / 2, cy = (r0 + r1) / 2, rx = Math.abs(c1 - c0) / 2, ry = Math.abs(r1 - r0) / 2;
  if (!(rx > 0) || !(ry > 0)) return m;
  for (let r = Math.max(0, Math.ceil(cy - ry)); r <= Math.min(rows - 1, Math.floor(cy + ry)); r++) {
    const t = (r - cy) / ry, half = rx * Math.sqrt(Math.max(0, 1 - t * t));
    const ca = Math.max(0, Math.ceil(cx - half)), cb = Math.min(cols - 1, Math.floor(cx + half));
    if (ca <= cb) m.fill(1, r * cols + ca, r * cols + cb + 1);
  }
  return m;
}

/** The closed polygon `pts` ([[c, r], ...], raster pixel coordinates), even-odd, at the pixel centres. */
export function lassoMask(cols, rows, pts) {
  const m = new Float32Array(cols * rows);
  const n = Array.isArray(pts) ? pts.length : 0;
  if (n < 3) return m;
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
  const xs = [];
  for (let r = Math.max(0, Math.ceil(lo)); r <= Math.min(rows - 1, Math.floor(hi)); r++) {
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
      if ((y1 > r) !== (y2 > r)) xs.push(x1 + ((r - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const ca = Math.max(0, Math.ceil(xs[i])), cb = Math.min(cols, Math.ceil(xs[i + 1])); // c in [x0, x1)
      if (ca < cb) m.fill(1, r * cols + ca, r * cols + cb);
    }
  }
  return m;
}

/** 1 - m (a fresh mask). */
export function invertMask(m) {
  const out = new Float32Array(m.length);
  for (let k = 0; k < m.length; k++) out[k] = 1 - m[k];
  return out;
}

/**
 * The mask blurred (a separable Gaussian, sigma = radius / 2, cut at 1.5 radius; the edge pixels repeat): the feather.
 * `rx`, `ry` = the feather radius in pixels across and up (a stretched patch has two). A fresh mask.
 */
export function featherMask(m, cols, rows, rx, ry = rx) {
  const pass = (src, len, count, stride, step, radius) => {
    if (!(radius > 0)) return src;
    const sigma = radius / 2, K = Math.max(1, Math.ceil(1.5 * radius));
    const w = new Float64Array(2 * K + 1);
    let sum = 0;
    for (let i = -K; i <= K; i++) { w[i + K] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += w[i + K]; }
    for (let i = 0; i < w.length; i++) w[i] /= sum;
    const out = new Float32Array(src.length);
    for (let line = 0; line < count; line++) {
      const base = line * stride;
      for (let i = 0; i < len; i++) {
        let acc = 0;
        for (let j = -K; j <= K; j++) acc += w[j + K] * src[base + Math.min(len - 1, Math.max(0, i + j)) * step];
        out[base + i * step] = acc;
      }
    }
    return out;
  };
  const across = pass(m, cols, rows, cols, 1, rx);           // each row
  return pass(across, rows, cols, 1, cols, ry);              // each column
}

/**
 * The 0.5 contour of `m` (marching squares over the pixel centres; outside the grid reads 0, so every outline closes), as
 * segments [x1, y1, x2, y2] in IMAGE pixel coordinates: x across 0..cols, y DOWN from the patch's top edge 0..rows (a pixel's
 * centre is at (c + 0.5, rows - r - 0.5)).
 */
export function maskOutline(m, cols, rows, t = 0.5) {
  const val = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? 0 : m[(rows - 1 - y) * cols + x]); // image row y
  const segs = [];
  const f = (a, b) => (a === b ? 0.5 : (t - a) / (b - a));
  for (let y = -1; y < rows; y++) {
    for (let x = -1; x < cols; x++) {
      const tl = val(x, y), tr = val(x + 1, y), br = val(x + 1, y + 1), bl = val(x, y + 1);
      const idx = (tl >= t ? 8 : 0) | (tr >= t ? 4 : 0) | (br >= t ? 2 : 0) | (bl >= t ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const X = x + 0.5, Y = y + 0.5;
      const top = () => [X + f(tl, tr), Y], right = () => [X + 1, Y + f(tr, br)], bottom = () => [X + f(bl, br), Y + 1], left = () => [X, Y + f(tl, bl)];
      const add = (a, b) => { const p = a(), q = b(); segs.push([p[0], p[1], q[0], q[1]]); };
      switch (idx) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break;
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(left, top); break;
        case 5: add(left, top); add(bottom, right); break;
        case 10: add(top, right); add(left, bottom); break;
        default: break;
      }
    }
  }
  return segs;
}

/**
 * The SVG matrix [a, b, c, d, e, f] (x' = a x + c y + e, y' = b x + d y + f) taking an EDITOR point (board inches from the
 * top-left, y down) onto patch `rec`'s IMAGE pixel coordinates (x across 0..cols, y down 0..rows) -- the inverse of the
 * patch's placement (position, rotation counter-clockwise with +Y up, size). `board` = { widthIn, heightIn }.
 */
export function patchPixelMatrix(rawRec, board) {
  const rec = normaliseHeightLayer(rawRec);
  const { cols, rows } = patchGrid(rec);
  const { w, h } = rec.sizeIn || { w: board.widthIn, h: board.heightIn };
  const W = board.widthIn, H = board.heightIn, px = rec.position.x, py = rec.position.y;
  const t = (rec.rotation * Math.PI) / 180, cs = Math.cos(t), sn = Math.sin(t);
  const kx = cols / w, ky = rows / h;
  return [kx * cs, ky * sn, -kx * sn, ky * cs,
    kx * (cs * (-W / 2 - px) + sn * (H / 2 - py) + w / 2),
    ky * (h / 2 + sn * (-W / 2 - px) - cs * (H / 2 - py))];
}

/**
 * An editor SVG (a Draw-tab layer, editor coordinates) as an SVG of the patch's pixel size whose content sits in the
 * patch's image frame. Every shape is FILLED (the region inside its outline is selected; its stroke counts too).
 */
export function selectionSvg(svgText, rec, board) {
  const { cols, rows } = patchGrid(normaliseHeightLayer(rec));
  const M = patchPixelMatrix(rec, board).map((v) => +v.toFixed(9));
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const src = doc.querySelector('svg');
  const NS = 'http://www.w3.org/2000/svg';
  const out = doc.createElementNS(NS, 'svg');
  out.setAttribute('xmlns', NS);
  for (const [k, v] of [['width', cols], ['height', rows], ['viewBox', `0 0 ${cols} ${rows}`], ['preserveAspectRatio', 'none']]) out.setAttribute(k, String(v));
  const style = doc.createElementNS(NS, 'style');
  style.textContent = '*{fill:#000 !important;fill-opacity:1 !important;opacity:1 !important}';
  out.appendChild(style);
  const g = doc.createElementNS(NS, 'g');
  g.setAttribute('transform', `matrix(${M.join(' ')})`);
  if (src) while (src.firstChild) g.appendChild(src.firstChild);
  out.appendChild(g);
  return new XMLSerializer().serializeToString(out);
}

/** The browser's own render of `svg` (w x h) as RGBA (core/stamp/render-svg.js renderSvgNative). */
export async function renderSvgAlpha(svg, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  await renderSvgNative(ctx, svg, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/** An RGBA image (row 0 = the top) -> a mask in the raster frame (row 0 = the bottom): alpha / 255. */
export function maskFromAlpha(rgba, cols, rows) {
  const m = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const y = rows - 1 - r;
    for (let c = 0; c < cols; c++) m[r * cols + c] = rgba[(y * cols + c) * 4 + 3] / 255;
  }
  return m;
}

/** An editor SVG's shapes as a mask over patch `rec` (async: the browser renders it). `render` = the renderer (tests). */
export async function maskFromSvg(svgText, rec, board, { render = renderSvgAlpha } = {}) {
  const { cols, rows } = patchGrid(normaliseHeightLayer(rec));
  const svg = selectionSvg(sanitizeSvgForRaster(svgText), rec, board);
  return maskFromAlpha(await render(svg, cols, rows), cols, rows);
}

/** True when any pixel is selected. */
export const maskAny = (m) => !!m && m.some((v) => v > 0);
