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
import { clipPolygonToBoard, roundPolygonCorners, signedArea, polygonIntersection } from '../geometry.js';
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
  // the region's far EDGE (seat E, 2026-10-08; Fred's joint rule, every seam a real grout joint): a last course the edge would
  // leave thinner than this share of a course joins the one before it, which runs to the edge -- MEASURED on main: its stones
  // fell under the floor and the wall stopped 1.5 - 2 joints short of the ring along the bottom row (T1 7x9 1 in)
  edgeCourseShare: 0.5, // x brickHeightIn
  // ... and along a course: a stone the region's edge cuts to a sliver under the floor joins its neighbour in the course
  // (which then runs on to the edge, the clip trimming it) -- MEASURED on main: dropped, it left a strip 1.5 - 2 joints wide
  // up the region's sides (T1 7x9 1 in lower sides, T18 7x9 1.25 in beside the head)
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
  const lastTop = minY + heights.slice(0, -1).reduce((t, h) => t + h + J, 0);
  let merged = -1; // the course that took a thin last one (no tall stone reaches into it: it would pass two courses)
  if (heights.length > 1 && maxY - lastTop < R.edgeCourseShare * H) { heights[heights.length - 2] += J + (maxY - lastTop); heights.pop(); merged = heights.length - 1; }
  const cells = [];
  let nextId = 0, blocked = [], y = minY;
  const minArea = MIN_PIECE_FRACTION * L * H;
  for (let c = 0; c < heights.length; c++) {
    const h = heights[c], nextBlocked = [];
    let x = minX - rand('phase', c) * L * R.lengthRange[1], k = 0;
    const stones = []; // the course planned first: { x, len, sh, tall, k }
    while (x < maxX) {
      const block = blocked.find((b) => x < b[1] && b[0] < x + J); // inside a tall stone from the course above
      if (block) { x = block[1] + J; continue; }
      let len = L * (R.lengthRange[0] + rand('length', c * 1009 + k) * (R.lengthRange[1] - R.lengthRange[0]));
      const ahead = blocked.filter((b) => b[0] > x).sort((a, b) => a[0] - b[0])[0];
      if (ahead && x + len > ahead[0] - J) len = ahead[0] - J - x; // stop short of the tall stone
      const tall = c + 1 < heights.length && c + 1 !== merged && rand('tall', c * 1009 + k) < R.tallRate;
      const sh = tall ? h + J + heights[c + 1] : h;
      const takes = tall ? [x, x + len] : null; // the stretch a tall stone takes from the next course (updated if it grows)
      if (takes) nextBlocked.push(takes);
      k++;
      if (len > R.minLength * L) stones.push({ x, len, sh, tall, k, takes });
      x += Math.max(len, 0) + J;
    }
    // an edge sliver (inside the region, but under the floor) joins its neighbour in the course: the neighbour grows over it
    const inside = (st) => { const q = polygonIntersection([{ x: st.x, y }, { x: st.x + st.len, y }, { x: st.x + st.len, y: y + st.sh }, { x: st.x, y: y + st.sh }], boardOutline); return q.length >= 3 ? Math.abs(signedArea(q)) : 0; };
    // a sliver of a two-course (tall) stone is not merged; a tall NEIGHBOUR may grow over a one-course sliver (its block too)
    const adjacent = (p, q, sliver) => Math.abs(p.x + p.len + J - q.x) < 1e-9 && !sliver.tall;
    const grew = (st) => { if (st.takes) { st.takes[0] = st.x; st.takes[1] = st.x + st.len; } };
    for (let i = 0; i < stones.length; i++) {
      const a = inside(stones[i]);
      if (!(a > 0 && a < minArea)) continue;
      if (i > 0 && adjacent(stones[i - 1], stones[i], stones[i])) { stones[i - 1].len = stones[i].x + stones[i].len - stones[i - 1].x; grew(stones[i - 1]); stones.splice(i--, 1); }
      else if (i + 1 < stones.length && adjacent(stones[i], stones[i + 1], stones[i])) { stones[i + 1].len += stones[i + 1].x - stones[i].x; stones[i + 1].x = stones[i].x; grew(stones[i + 1]); stones.splice(i--, 1); }
    }
    for (const { x: sx, len, sh, k: sk } of stones) {
      const short = Math.min(len, sh);
      const pull = (q) => R.cornerInset * short * rand('corner', (c * 1009 + sk) * 4 + q);
      const rect = [
        { x: sx + pull(0), y: y + pull(1) }, { x: sx + len - pull(2), y: y + pull(3) },
        { x: sx + len - pull(4), y: y + sh - pull(5) }, { x: sx + pull(6), y: y + sh - pull(7) },
      ];
      const stone = roundPolygonCorners(rect, R.cornerRound * short);
      const cx = sx + len / 2, cy = y + sh / 2;
      const clipped = clipPolygonToBoard(stone, boardOutline, { x: cx, y: cy });
      if (clipped.length >= 3 && Math.abs(signedArea(clipped)) >= minArea) {
        cells.push({ id: nextId++, polygon: clipped, courseIndex: c, cx, cy, neighbors: {} });
      }
    }
    blocked = nextBlocked;
    y += h + J;
  }
  return { cells };
}
