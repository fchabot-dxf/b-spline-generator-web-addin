/**
 * photo/mirror-dim.js -- the Photo preview's dim overlay: which part of the photo never reaches the board.
 *
 * F34 item 1 (Fred: "show which half/quadrant of the photo is used") first drew a FIXED half / quadrant here. Seat D
 * 2026-10-10 (Fred: "not sure if this is accurate, why is it dimmed in the middle") MEASURED it against the sampler
 * (an image that records every pixel read): it was wrong in every case. terrain.js's fold (su = |zu - mx| * 2) maps the
 * WHOLE photo into EACH half of the board -- it never drops one half -- and the cover-fit plus the Scale / Offset /
 * Rotation / Repeat tweaks decide which part of the photo lands at all (no symmetry, a 4:3 photo on a 7:9 board: only
 * its middle 60 % is used; the old overlay dimmed nothing there and half of what IS used under symmetry).
 *
 * Now ONE source of truth: the board grid goes through terrain.js's own foldUV and photo.js's own photoPixelAt (the
 * exact arithmetic the sampler reads with), and a cell of the photo is "used" when any board point lands in it.
 */
import { photoPixelAt } from '../noise/photo.js';
import { foldUV } from '../terrain.js';

/** Pure: a cellsW x cellsH grid over the (processed) photo `img`, 1 where the terrain samples it, 0 where no board
 *  point lands. `params` = the sampler's own ({ ...P, tweaks: P.filterTweaks.photo }: the fold's Symmetry / Map Zoom /
 *  Map Offset and the photo's placement); `aspect` = the board's width / height. The board is walked densely enough that
 *  every cell a board area maps onto is hit (4 points per cell along the photo's longer side -- a rotation needed it --,
 *  more when Scale < 1), with the board's edges included as terrain.js samples them (MEASURED: an offset photo reads a
 *  whole clamped edge column there). */
export function photoUsedCells(img, params, aspect, cellsW, cellsH) {
  const cells = new Uint8Array(cellsW * cellsH);
  if (!img || !img.w || !img.h) return cells;
  const scale = (params?.tweaks?.scale) || 1;
  const n = Math.ceil((4 * Math.max(cellsW, cellsH)) / Math.min(1, scale));
  const nu = Math.max(2, Math.round(n * Math.max(1, aspect))), nv = Math.max(2, Math.round(n / Math.min(1, aspect)));
  const f = {};
  for (let j = 0; j < nv; j++) {
    const v = j / (nv - 1); // the board grid as terrain.js walks it: its EDGES included (an offset photo clamps them)
    for (let i = 0; i < nu; i++) {
      foldUV(i / (nu - 1), v, params, f);
      const k = photoPixelAt(f.su, f.sv, aspect, params, img);
      if (k < 0) continue;
      const x = k % img.w, y = (k - x) / img.w;
      cells[Math.floor((y * cellsH) / img.h) * cellsW + Math.floor((x * cellsW) / img.w)] = 1;
    }
  }
  return cells;
}
