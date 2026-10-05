/**
 * layouts/coursed-rubble.js -- T86 item 25 (Fred's photo shots/fred/grey_set/rubble_coursed_stone_600.png): COURSED
 * RUBBLE, irregular stones in rough horizontal courses, next to 'fieldstone' (the free-packed cobble look). Declared:
 *   - courses: each one brickHeightIn x (1 +/- COURSED_RUBBLE.courseJitter), a grout joint between courses;
 *   - stones along a course: lengths brickLengthIn x COURSED_RUBBLE.lengthRange, a grout joint between stones, the
 *     first one starting a random share of a stone before the region's left edge (no vertical joints lining up);
 *   - a stone now and then (COURSED_RUBBLE.tallRate) spans its course AND the next (never more than two): the course
 *     above it leaves that stretch free;
 *   - each stone is its cell's rectangle with every corner pulled IN by a random share (COURSED_RUBBLE.cornerInset of
 *     its shorter side), then rounded: rough, uneven joints, and since corners only move inward, never an overlap.
 * Seeded (rng.js hashedRandom), clipped to the region like every layout (geometry.js clipPolygonToBoard), pieces under
 * library.js MIN_PIECE_FRACTION of a stone dropped. cells[i] = { id, polygon, courseIndex, cx, cy, neighbors: {} }.
 */
import { clipPolygonToBoard, roundPolygonCorners, signedArea } from '../geometry.js';
import { hashedRandom } from '../rng.js';
import { MIN_PIECE_FRACTION } from '../library.js';

export const COURSED_RUBBLE = Object.freeze({
  courseJitter: 0.25, // a course is 75-125% of brickHeightIn
  lengthRange: [0.6, 1.6], // x brickLengthIn
  tallRate: 0.12, // share of stones that span two courses
  // tuned on the sheet against rubble_coursed_stone_600.png (seat B, 2026-10-05): 0.16 / 0.18 left joints several
  // times the photo's; the photo's stones are near-full rectangles with rounded corners
  cornerInset: 0.06, // max inward pull of a corner, x the stone's shorter side
  cornerRound: 0.12, // corner radius, x the stone's shorter side
  minLength: 0.2, // x brickLengthIn: a stone cut short by a tall one is kept down to this (no hole beside it)
});

export function coursedRubbleLayout(boardOutline, set, _zones, seed = 0) {
  const R = COURSED_RUBBLE;
  const xs = boardOutline.map((p) => p.x), ys = boardOutline.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const L = set.brickLengthIn, H = set.brickHeightIn, J = set.grout.widthIn;
  const rand = (purpose, k) => hashedRandom(seed, `rubble-${purpose}`, k);
  // course heights, top to bottom of the region
  const heights = [];
  for (let y = minY, c = 0; y < maxY; c++) {
    const h = H * (1 + R.courseJitter * (2 * rand('course', c) - 1));
    heights.push(h);
    y += h + J;
  }
  const cells = [];
  let nextId = 0, blocked = [], y = minY;
  const minArea = MIN_PIECE_FRACTION * L * H;
  for (let c = 0; c < heights.length; c++) {
    const h = heights[c], nextBlocked = [];
    let x = minX - rand('phase', c) * L * R.lengthRange[1], k = 0;
    while (x < maxX) {
      const block = blocked.find((b) => x < b[1] && b[0] < x + J); // inside a tall stone from the course above
      if (block) { x = block[1] + J; continue; }
      let len = L * (R.lengthRange[0] + rand('length', c * 1009 + k) * (R.lengthRange[1] - R.lengthRange[0]));
      const ahead = blocked.filter((b) => b[0] > x).sort((a, b) => a[0] - b[0])[0];
      if (ahead && x + len > ahead[0] - J) len = ahead[0] - J - x; // stop short of the tall stone
      const tall = c + 1 < heights.length && rand('tall', c * 1009 + k) < R.tallRate;
      const sh = tall ? h + J + heights[c + 1] : h;
      if (tall) nextBlocked.push([x, x + len]);
      k++;
      if (len > R.minLength * L) {
        const short = Math.min(len, sh);
        const pull = (q) => R.cornerInset * short * rand('corner', (c * 1009 + k) * 4 + q);
        const rect = [
          { x: x + pull(0), y: y + pull(1) }, { x: x + len - pull(2), y: y + pull(3) },
          { x: x + len - pull(4), y: y + sh - pull(5) }, { x: x + pull(6), y: y + sh - pull(7) },
        ];
        const stone = roundPolygonCorners(rect, R.cornerRound * short);
        const cx = x + len / 2, cy = y + sh / 2;
        const clipped = clipPolygonToBoard(stone, boardOutline, { x: cx, y: cy });
        if (clipped.length >= 3 && Math.abs(signedArea(clipped)) >= minArea) {
          cells.push({ id: nextId++, polygon: clipped, courseIndex: c, cx, cy, neighbors: {} });
        }
      }
      x += Math.max(len, 0) + J;
    }
    blocked = nextBlocked;
    y += h + J;
  }
  return { cells };
}
