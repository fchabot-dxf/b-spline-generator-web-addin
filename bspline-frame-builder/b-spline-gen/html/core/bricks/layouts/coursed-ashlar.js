/**
 * layouts/coursed-ashlar.js -- ROUGH ASHLAR, broken course (Fred picked mock E, 2026-10-10; references
 * shots/advisor/ashlar/ref_random_ashlar.jpg + ref_rough_broken.jpg): near-rectangular blocks laid in BANDS, each band
 * either one TALL block or a stack of two short courses beside it, so the horizontal joints break and never run the full
 * width; every joint straight and square before the rough step. Declared (COURSED_ASHLAR, every length x the set's
 * brickHeightIn = H, the base course height):
 *   - bands, from the region's min y edge on: a band's two-course stacks (all summing to the same height), picked by weight; a tall block is
 *     the band's full height (its stack + the joint between);
 *   - along a band: a tall block (tallRate, never two side by side) or a ZONE of stacked courses, each zone course filled
 *     with blocks of `lengths`; every new vertical joint at least `minOverlap` from the joints of the course above
 *     (re-drawn up to `retries` times: best effort);
 *   - the region's far edge: a remainder too short for a band is one single-course band, and one under `lastCourseMin`
 *     grows the band before it (no thin last row);
 *   - a course crossing a concave notch is laid as separate SPANS (the region's inside intervals along it), each span
 *     filled on its own; a block the region's edge cuts under the floor (piece-floor.js: MIN_PIECE_FRACTION of L x H)
 *     joins its neighbour in the course, which grows over it (as coursed-rubble.js does);
 *   - rough: each block's corners pulled IN by a share of its shorter side, each edge bowed in at 1/3 and 2/3, corners
 *     rounded. Inward only, so never an overlap; the joints read wider and uneven (Fred's photo).
 * Seeded (rng.js hashedRandom), clipped to the region lobe by lobe (geometry.js clipPolygonToRegion, as the tile2d layouts:
 * a region bridged by a zero-width corridor keeps each block's piece in its own lobe).
 * cells[i] = { id, polygon, courseIndex, cx, cy, neighbors: {} }.
 */
import { clipPolygonToRegion, roundPolygonCorners, signedArea, inwardSignFor } from '../geometry.js';
import { hashedRandom } from '../rng.js';
import { MIN_PIECE_FRACTION } from '../library.js';

export const COURSED_ASHLAR = Object.freeze({
  bands: Object.freeze([
    Object.freeze({ stacks: [[1, 1]], weight: 2 }), // tall 2H + J beside H over H
    Object.freeze({ stacks: [[1, 1.5], [1.5, 1]], weight: 1 }), // tall 2.5H + J beside H over 1.5H (or 1.5H over H)
  ]),
  tallRate: 0.4, // share of a band's segments that are one tall block (never two side by side)
  tallLengths: [1.0, 2.0], // x H
  zoneLengths: [2.0, 5.0], // x H: a stretch of stacked courses between tall blocks
  lengths: [1.0, 2.5], // x H: a block in a stacked course
  minOverlap: 0.4, // x H: a vertical joint stays this far from the joints of the course above
  retries: 16,
  lastCourseMin: 0.7, // x H: a remainder under this grows the band before it
  scanLevels: 9, // the levels a course's inside intervals are read at (its spans: the union over them)
  rough: Object.freeze({
    cornerJitter: [0.03, 0.06], // x the block's shorter side: a corner's inward pull, per axis
    softCornerShare: 0.3, // share of corner pulls scaled down by softCornerFactor (not every corner chipped)
    softCornerFactor: 0.3,
    edgeWave: 0.025, // x the shorter side: each edge bowed in at 1/3 and 2/3 by up to this
    cornerRound: 0.06, // x the shorter side: the corner radius
  }),
});

/** the region's inside x-intervals along the horizontal line y (even-odd scanline) */
function intervalsAt(poly, y) {
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a.y <= y) !== (b.y <= y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  xs.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] > xs[i]) out.push([xs[i], xs[i + 1]]);
  return out;
}
/** a course's SPANS between y0 and y1: the union of its inside intervals over `levels` levels (a notch that cuts the
 *  course through splits it) */
export function spansOf(poly, y0, y1, levels) {
  const all = [];
  for (let k = 0; k < levels; k++) all.push(...intervalsAt(poly, y0 + 1e-6 + ((y1 - y0 - 2e-6) * k) / (levels - 1)));
  all.sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const iv of all) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], iv[1]);
    else out.push([...iv]);
  }
  return out;
}

export function coursedAshlarLayout(boardOutline, set, _zones, seed = 0) {
  return layAshlar(boardOutline, set, seed, COURSED_ASHLAR);
}

/** The lay itself, with its params passed in (tests lay it without the rough step, to measure the coverage exactly). */
export function layAshlar(boardOutline, set, seed, R) {
  const H = set.brickHeightIn, J = set.grout.widthIn;
  const rand = (purpose, k) => hashedRandom(seed, `ashlar-${purpose}`, k);
  const ys = boardOutline.map((p) => p.y);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const lo = R.lengths[0] * H, hi = R.lengths[1] * H, minOv = R.minOverlap * H;
  const tooClose = (x, above) => above.some((a) => Math.abs(x - a) < minOv);

  // bands, from the region's min y up: { def (null: one course), y0, h }
  const wsum = R.bands.reduce((a, b) => a + b.weight, 0);
  const pickBand = (i) => { let r = rand('band', i) * wsum; for (const b of R.bands) { r -= b.weight; if (r < 0) return b; } return R.bands[0]; };
  const bandHeightOf = (stack) => stack.reduce((a, b) => a + b, 0) * H + (stack.length - 1) * J;
  const minBand = Math.min(...R.bands.map((b) => bandHeightOf(b.stacks[0])));
  const bands = [];
  for (let y = minY, i = 0; ;) {
    const rem = maxY - y;
    if (rem >= minBand) {
      const b = pickBand(i);
      const h = bandHeightOf(b.stacks[0]);
      if (h <= rem) { bands.push({ def: b, y0: y, h }); y += h + J; i++; continue; }
      // the picked band does not fit: the smallest one does
      const small = R.bands.find((d) => bandHeightOf(d.stacks[0]) === minBand);
      bands.push({ def: small, y0: y, h: minBand }); y += minBand + J; i++; continue;
    }
    if (rem >= R.lastCourseMin * H || !bands.length) { if (rem > 0) bands.push({ def: null, y0: y, h: rem }); }
    else { const last = bands[bands.length - 1]; last.h += J + rem; last.grown = J + rem; }
    break;
  }

  // a course's blocks from xa to xb: lengths lo..hi, the last never under lo; joints kept off `above`
  const fill = (xa, xb, above, key) => {
    const out = []; let x = xa, k = 0;
    if (xb - xa <= 1e-9) return out;
    for (;;) {
      const rem = xb - x;
      if (rem <= hi) { out.push([x, xb]); break; }
      const top = Math.max(lo, Math.min(hi, rem - J - lo));
      let len, t = 0;
      do { len = lo + rand('len', key * 7919 + k * 101 + t) * (top - lo); t++; } while (t < R.retries && tooClose(x + len + J / 2, above));
      out.push([x, x + len]); x += len + J; k++;
    }
    return out;
  };
  const jointsOf = (blocks) => blocks.slice(0, -1).map((b) => b[1] + J / 2);

  const rects = []; // planned blocks { x0, x1, y0, y1, row, key }
  let above = [], row = 0;
  for (let bi = 0; bi < bands.length; bi++) {
    const { def, y0, h } = bands[bi], y1 = y0 + h;
    // the band's courses: a picked stack per zone (the last band takes what it grew by on its bottom course)
    const stackFor = (k) => {
      if (!def) return [h];
      const st = def.stacks[Math.floor(rand('stack', bi * 977 + k) * def.stacks.length)].map((c) => c * H);
      if (bands[bi].grown) st[st.length - 1] += bands[bi].grown;
      return st;
    };
    const bandSpans = spansOf(boardOutline, y0, y1, R.scanLevels);
    const below = [];
    let k = 0;
    for (const [sx0, sx1] of bandSpans) {
      let x = sx0, lastTall = false;
      while (x < sx1 - 1e-9) {
        const tall = def && !lastTall && rand('tall', bi * 977 + k) < R.tallRate;
        const [a, b] = tall ? R.tallLengths : R.zoneLengths;
        let w, t = 0;
        do { w = H * (a + rand('seg', bi * 977 + k * 31 + t) * (b - a)); t++; } while (t < R.retries && tooClose(x + w + J / 2, above));
        if (sx1 - (x + w + J) < lo) w = sx1 - x; // no short stub at the span's end: this segment runs to it
        const x1 = Math.min(x + w, sx1);
        if (tall) {
          rects.push({ x0: x, x1, y0, y1, row, key: rects.length });
        } else {
          const stack = stackFor(k);
          let cy = y0, prev = above;
          for (const [ci, ch] of stack.entries()) {
            // the zone's course runs only where the region is along IT (a curved side narrows the upper / lower course)
            const sub = spansOf(boardOutline, cy, cy + ch, R.scanLevels).map(([p, q]) => [Math.max(p, x), Math.min(q, x1)]).filter(([p, q]) => q - p > 1e-9);
            const blocks = sub.flatMap(([p, q], si) => fill(p, q, prev, (bi * 4 + ci) * 977 + k * 7 + si));
            for (const [p, q] of blocks) rects.push({ x0: p, x1: q, y0: cy, y1: cy + ch, row: row + ci, key: rects.length });
            prev = jointsOf(blocks);
            if (ci === stack.length - 1) below.push(...prev);
            cy += ch + J;
          }
        }
        if (x1 < sx1 - 1e-9) below.push(x1 + J / 2);
        x = x1 + J; k++; lastTall = tall;
      }
    }
    above = below;
    row += def ? Math.max(...def.stacks.map((s) => s.length)) : 1;
  }

  // a block the region cuts under the floor joins its neighbour in the course (same rows, a joint apart), which grows
  // over it; one with no such neighbour drops below
  const floor = MIN_PIECE_FRACTION * set.brickLengthIn * H;
  const rectPoly = (r) => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];
  const areas = new Map(); // rect -> its area inside the region (dropped when the rect grows)
  const insideArea = (r) => {
    if (!areas.has(r)) { const q = clipPolygonToRegion(rectPoly(r), boardOutline); areas.set(r, q.length >= 3 ? Math.abs(signedArea(q)) : 0); }
    return areas.get(r);
  };
  const sameCourse = (p, q) => Math.abs(p.y0 - q.y0) < 1e-9 && Math.abs(p.y1 - q.y1) < 1e-9;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const a = insideArea(r);
    if (!(a > 0 && a < floor)) continue;
    const left = rects.find((q) => q !== r && sameCourse(q, r) && Math.abs(q.x1 + J - r.x0) < 1e-9);
    const right = rects.find((q) => q !== r && sameCourse(q, r) && Math.abs(r.x1 + J - q.x0) < 1e-9);
    const into = left && right ? (insideArea(left) <= insideArea(right) ? left : right) : left || right;
    if (!into) continue;
    if (into === left) into.x1 = r.x1; else into.x0 = r.x0;
    areas.delete(into);
    rects.splice(i, 1); i = -1; // a grown block may now be the one to merge: re-scan (few blocks; each pass removes one)
  }

  const cells = [];
  let nextId = 0;
  for (const r of rects) {
    let poly = rectPoly(r);
    if (R.rough) poly = roughen(poly, r, R.rough, (k) => rand('rough', r.key * 64 + k));
    const clipped = clipPolygonToRegion(poly, boardOutline, { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
    if (clipped.length < 3 || Math.abs(signedArea(clipped)) < floor) continue;
    cells.push({ id: nextId++, polygon: clipped, courseIndex: r.row, cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2, neighbors: {} });
  }
  return { cells };
}

/** corners pulled IN (never out: no overlap), each edge bowed in at 1/3 and 2/3, corners rounded */
function roughen(rect, r, R, rnd) {
  const short = Math.min(r.x1 - r.x0, r.y1 - r.y0);
  const pull = (k) => short * (R.cornerJitter[0] + rnd(k) * (R.cornerJitter[1] - R.cornerJitter[0])) * (rnd(k + 20) < R.softCornerShare ? R.softCornerFactor : 1);
  const c = rect.map((p, k) => ({
    x: p.x + (k === 0 || k === 3 ? 1 : -1) * pull(2 * k),
    y: p.y + (k === 0 || k === 1 ? 1 : -1) * pull(2 * k + 1),
  }));
  const sign = inwardSignFor(c);
  const out = [];
  for (let k = 0; k < 4; k++) {
    const a = c[k], b = c[(k + 1) % 4], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * sign, ny = (dx / len) * sign;
    out.push(a);
    for (const [m, t] of [[0, 1 / 3], [1, 2 / 3]]) {
      const d = short * R.edgeWave * rnd(40 + k * 2 + m);
      out.push({ x: a.x + dx * t + nx * d, y: a.y + dy * t + ny * d });
    }
  }
  return roundPolygonCorners(out, short * R.cornerRound);
}
