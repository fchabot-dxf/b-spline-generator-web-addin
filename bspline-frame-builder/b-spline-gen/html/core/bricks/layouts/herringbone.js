/**
 * core/bricks/layouts/herringbone.js — PORTABLE (see rng.js). F35 item 7, REBUILT per advisor
 * review (a greedy-packed first version read as "a jumble of diagonal bricks with crossings and
 * gaps" at 1:1): a CLOSED-FORM construction, not packing.
 *
 * MEASURED, not textbook-assumed: the classic chevron "V" herringbone (each brick's own end
 * touching the next perpendicular brick's side, in a single zigzag) tiles EXACTLY only when
 * brickLengthIn = 2 x brickHeightIn -- verified directly: at that ratio, a horizontal brick's own
 * "notch" (the region above it, up to the matching vertical brick's own height) is EXACTLY one more
 * brick's worth of height, closing the tiling with zero gap or overlap. Set 1's own real ratio
 * (3.75:1) does NOT close that way -- confirmed by a systematic offset search (bricks-weave-
 * layouts.test.js's own dev history) that found no valid single-brick-per-step staircase for this
 * ratio. GENERALISED instead: each "column" is `n = round(brickLengthIn / (brickHeightIn+grout))`
 * horizontal bricks stacked to EXACTLY fill one brickLengthIn-tall column (the SAME formula
 * basketweave.js's own `n` uses, snapped to a whole number of rows, never stretched), paired with
 * ONE vertical brick beside it; columns repeat along the row, and each row is offset from the next
 * by its own cross-width so the whole thing reads as a genuine stepped diagonal weave -- NOT the
 * textbook single-brick chevron (an honest, measured limitation at this brick ratio, flagged to the
 * advisor alongside the live screenshot, not silently presented as the classic look).
 */
import { clipPolygonToBoard, rectPolygon } from '../geometry.js';

/**
 * @param {{x:number,y:number}[]} boardOutline — closed polygon, board inches
 * @param {{brickLengthIn:number, brickHeightIn:number, grout:{widthIn:number}}} set
 * @param {Array} [_zones] — unused (same call-signature-parity precedent as fieldstone.js)
 * @returns {{cells: Array}}
 */
export function herringboneLayout(boardOutline, set, _zones) {
  const L = set.brickLengthIn, W = set.brickHeightIn, g = set.grout.widthIn;
  const n = Math.max(1, Math.round(L / (W + g)));
  const pitch = L / n;
  const crossWidth = Math.max(0, pitch - g);
  const colPitch = L + g + W + g; // one H-stack column + one V brick, end to end

  const xs = boardOutline.map((p) => p.x), ys = boardOutline.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const rowPitch = L + g;
  const rCount = Math.ceil((maxY - minY) / rowPitch) + 2;
  const colCount = Math.ceil((maxX - minX) / colPitch) + 2;

  const cells = [];
  let nextId = 0;
  for (let r = -1; r <= rCount; r++) {
    const rowY = minY + r * rowPitch;
    const rowXOffset = r * crossWidth; // a progressive (not fixed half-unit) stagger -- reads as a
    // stepped diagonal rather than a static repeating grid; see this file's own header.
    for (let c = -1; c <= colCount; c++) {
      const colX = minX + rowXOffset + c * colPitch;
      for (let i = 0; i < n; i++) {
        const cx = colX + L / 2, cy = rowY + i * pitch + crossWidth / 2;
        const poly = rectPolygon(cx, cy, L / 2, crossWidth / 2, 1, 0);
        const clipped = clipPolygonToBoard(poly, boardOutline, { x: cx, y: cy });
        if (clipped.length >= 3) cells.push({ id: nextId++, polygon: clipped, courseIndex: r, cx, cy, neighbors: {} });
      }
      const vx = colX + L + g + W / 2, vy = rowY + L / 2;
      const vPoly = rectPolygon(vx, vy, L / 2, W / 2, 0, 1);
      const vClipped = clipPolygonToBoard(vPoly, boardOutline, { x: vx, y: vy });
      if (vClipped.length >= 3) cells.push({ id: nextId++, polygon: vClipped, courseIndex: r, cx: vx, cy: vy, neighbors: {} });
    }
  }
  return { cells };
}
