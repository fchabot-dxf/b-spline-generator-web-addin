/**
 * height/move.js -- HEIGHT-PAINTER slice 3: the pixel work of the MOVE tool (main/height-panel.js runs it as the HEIGHT_TOOLS
 * 'move' gesture). Photoshop semantics: a LIFT takes the selected pixels off a layer into a floating piece (the mask's soft
 * edge included), the piece is placed back at a whole-pixel offset with a NORMAL blend over what is there, and the hole it
 * left is the layer x (1 - mask) (a fully selected pixel leaves 0 = transparent). A 0 pixel of the piece is transparent
 * (the layer model's 0, core/height/compose.js): it never covers what is under it. Pure.
 *
 * Raster frame (core/height/layer.js): pixel (c, r) at k = r * cols + c, row 0 = the patch's bottom edge. Offsets are whole
 * pixels (dc right, dr up the patch): a move never resamples, so every moved value is the exact value lifted.
 */

/**
 * Lift the pixels `mask` selects (Float32 0..1 per pixel; null = the whole layer) off `data` (cols x rows, not written).
 * Returns { cols, rows, piece: the lifted values, alpha: the mask (null = 1 everywhere), hole: the layer without them,
 * box: { c0, r0, c1, r1 } the pixels the piece covers (inclusive) or null when the mask selects nothing }.
 */
export function liftPiece(data, cols, rows, mask = null) {
  const piece = Float32Array.from(data);
  const hole = new Float32Array(cols * rows);
  let box = null;
  if (!mask) return { cols, rows, piece, alpha: null, hole, box: cols && rows ? { c0: 0, r0: 0, c1: cols - 1, r1: rows - 1 } : null };
  let c0 = cols, r0 = rows, c1 = -1, r1 = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c, m = mask[k];
      hole[k] = m > 0 ? data[k] * (1 - m) : data[k];
      if (m > 0) { if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r; }
    }
  }
  if (c1 >= 0) box = { c0, r0, c1, r1 };
  return { cols, rows, piece, alpha: Float32Array.from(mask), hole, box };
}

/**
 * The layer with lifted piece `f` placed at offset (dc, dr), written into `out` (cols x rows): the hole, then each piece
 * pixel over it by its alpha (normal blend: under (1 - a) + value a). Piece pixels that land off the grid are lost.
 */
export function placePiece(f, dc, dr, out) {
  const { cols, rows, piece, alpha, hole, box } = f;
  out.set(hole);
  if (!box) return out;
  const ca = Math.max(box.c0, -dc), cb = Math.min(box.c1, cols - 1 - dc);
  const ra = Math.max(box.r0, -dr), rb = Math.min(box.r1, rows - 1 - dr);
  for (let r = ra; r <= rb; r++) {
    for (let c = ca; c <= cb; c++) {
      const k = r * cols + c, v = piece[k];
      if (v === 0 || !Number.isFinite(v)) continue; // 0 = transparent
      const a = alpha ? alpha[k] : 1;
      if (!(a > 0)) continue;
      const t = (r + dr) * cols + c + dc;
      out[t] = a >= 1 ? v : out[t] * (1 - a) + v * a;
    }
  }
  return out;
}

/** `mask` moved by whole pixels (dc, dr): a new mask; what leaves the grid is lost, what comes in is 0. */
export function shiftMask(mask, cols, rows, dc, dr) {
  const out = new Float32Array(cols * rows);
  for (let r = Math.max(0, -dr); r < Math.min(rows, rows - dr); r++) {
    const src = r * cols, dst = (r + dr) * cols + dc;
    for (let c = Math.max(0, -dc); c < Math.min(cols, cols - dc); c++) out[dst + c] = mask[src + c];
  }
  return out;
}
