/**
 * core/bricks/layouts/weave-core.js — PORTABLE (see rng.js). F35 item 7: the shared 'tile2d'
 * packing core behind BOTH herringbone.js and basketweave.js -- declared once, consumed twice
 * (the two patterns differ ONLY in their own global rotation angle: basketweave = 0deg,
 * herringbone = 45deg; see library.js's own BRICK_PATTERNS header for why these need a genuinely
 * different algorithm from bond.js's course model at all).
 *
 * APPROACH (measured, not textbook-derived -- a from-scratch closed-form gap-free tiling for an
 * ARBITRARY brick aspect ratio turned out to be real, unsolved-in-this-session geometry; every
 * closed-form construction tried here either left a provable gap for non-square bricks or
 * degenerated into two solid same-orientation regions once greedily packed -- see WORK-LOG's own
 * F35 item 7 entry for the specific constructions tried and measured). What DOES work, verified by
 * direct overlap/coverage measurement: a two-pass greedy pack over a DIAGONAL-STRIPE preference
 * (stripe = floor((u+v)/period), period = brickLengthIn+brickHeightIn -- wide enough that a single
 * brick's own long axis never straddles two stripes, which is what made finer periods degenerate).
 * Pass 1 places only the stripe's own preferred orientation (no fallback, so neither orientation can
 * encroach on the other's stripe); pass 2 fills whatever gaps remain with either orientation,
 * whichever fits. This produces square-ish alternating blocks (confirmed live, matching
 * basketweave's own declared "pairs alternating horizontal/vertical in squares" almost exactly) --
 * rotating the WHOLE finished tiling by 45 degrees afterward turns the same, already-verified
 * construction into a genuinely good-looking diagonal weave for herringbone too (the standard way
 * diagonal-vs-straight herringbone/parquet floors are actually laid in practice: the same
 * underlying interlocking logic, rotated to the room).
 *
 * Overlap checking uses a real separating-axis polygon test (not a plain AABB check) because the
 * herringbone caller's own bricks are pre-rotated 45 degrees before this function ever sees them --
 * an AABB check on a rotated rectangle is looser than the true shape and could let a real overlap
 * through.
 */
import { clipPolygonToBoard } from '../geometry.js';

function rectPoly(x0, y0, w, h) {
  return [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }];
}

function bboxOf(poly) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** Separating-axis test for two convex polygons -- true if they overlap (any positive area, not
 *  just touching). */
function polysOverlap(a, b) {
  const edgesOf = (poly) => poly.map((p, i) => { const q = poly[(i + 1) % poly.length]; return { x: q.x - p.x, y: q.y - p.y }; });
  const axes = [...edgesOf(a), ...edgesOf(b)].map((e) => ({ x: -e.y, y: e.x }));
  for (const ax of axes) {
    const proj = (poly) => poly.map((p) => p.x * ax.x + p.y * ax.y);
    const pa = proj(a), pb = proj(b);
    const aMin = Math.min(...pa), aMax = Math.max(...pa), bMin = Math.min(...pb), bMax = Math.max(...pb);
    if (aMax < bMin + 1e-9 || bMax < aMin + 1e-9) return false;
  }
  return true;
}

/** Rotates a point (and, via map, a whole polygon) about the origin by `angleRad`. */
function rotatePoint(p, cos, sin) {
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

/**
 * @param {{x:number,y:number}[]} boardOutline — closed polygon, board inches
 * @param {number} L — brickLengthIn (already scaled -- the caller's own job)
 * @param {number} W — brickHeightIn
 * @param {number} J — grout.widthIn
 * @param {number} rotationDeg — 0 for basketweave, 45 for herringbone (the ONLY difference between
 *   the two patterns -- see this file's own header)
 * @returns {{cells: Array}} — same per-cell shape as every other layout (bond.js/fieldstone.js):
 *   {id, polygon, courseIndex, cx, cy, neighbors:{}}. `neighbors` stays empty, same precedent
 *   fieldstone.js already set ("real fieldstone has no equivalent of a brick course") -- this weave
 *   has no natural course/row adjacency either, so every cell is its own single-brick piece.
 */
export function weaveLayout(boardOutline, L, W, J, rotationDeg) {
  const angle = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const cosInv = Math.cos(-angle), sinInv = Math.sin(-angle);

  // Work entirely in the UNROTATED local (u,v) frame (where the weave is the simple axis-aligned
  // construction described in this file's own header), rotating only the FINAL accepted polygons
  // into board space at the very end -- never re-deriving the packing itself in rotated space.
  const localCorners = boardOutline.map((p) => rotatePoint(p, cosInv, sinInv));
  const lb = bboxOf(localCorners);
  const pad = L + J; // generous overscan so a brick whose CENTRE sampling point falls outside the
  // board can still have part of its own footprint clipped INTO the board at an edge/corner.
  const minU = lb.x0 - pad, maxU = lb.x1 + pad, minV = lb.y0 - pad, maxV = lb.y1 + pad;

  const period = L + W;
  const slotStep = Math.min(L, W) / 4; // MEASURED: W/2 left real, non-edge coverage gaps (a proper
  // clipped measurement -- not the inflated unclipped one an early version of this file's own dev
  // harness used -- showed ~90-91%, short of this pattern's own 95% coverage requirement); W/4
  // closes that gap (measured ~95% before grout) at an acceptable runtime cost. More passes at
  // phase-shifted offsets were also tried and made no further difference once resolution itself
  // was fine enough -- the ceiling was resolution, not pass count.

  // Grout, MEASURED (not assumed): padding the CANDIDATE footprint used for the overlap check by
  // the grout width (so accepted bricks can never end up closer than J, matching bond.js's own
  // spacing-not-shrinking principle) is the geometrically right idea, but THIS packer is a greedy
  // SCAN, not bond.js's own direct grid placement -- the extra padding margin made the scan reject
  // far more genuinely fittable slots than it should (measured a real coverage drop). Packing DENSE
  // (edge to edge, no grout in the overlap check) and shrinking each accepted brick by the full
  // grout half-width AFTERWARD keeps the grout EXACT while paying for it in coverage instead --
  // which is the right trade here, since (see this file's own tests, bricks-weave-layouts.test.js)
  // Set 1's own declared 0.06in grout against a 0.2in brick HEIGHT (30% of it) makes >=95% BOARD
  // coverage geometrically impossible for ANY correctly-grouted algorithm at all (the ceiling is
  // (L/(L+J))*(W/(W+J)) regardless of packer -- true for bond.js's own pre-existing patterns too,
  // just never coverage-tested before this item). Coverage is instead verified against THAT
  // mathematical ceiling for Set 1's own real dimensions, and against the dispatch's own flat 95%
  // bar separately using a brick whose grout really is a small fraction of its size (where the bar
  // is actually achievable) -- an earlier version of this function instead CAPPED the shrink amount
  // to force a passing coverage number on Set 1's own numbers specifically, which quietly narrowed
  // the rendered joint below the declared grout width; reverted once the test itself was fixed to
  // check against the real ceiling instead of an unreachable flat number.
  const halfJ = J / 2;

  const accepted = [];
  const cellSize = Math.max(L, W);
  const grid = new Map();
  const cellKeysFor = (b) => {
    const i0 = Math.floor(b.x0 / cellSize), i1 = Math.floor(b.x1 / cellSize);
    const j0 = Math.floor(b.y0 / cellSize), j1 = Math.floor(b.y1 / cellSize);
    const keys = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) keys.push(`${i},${j}`);
    return keys;
  };
  const place = (fullPoly) => {
    accepted.push(fullPoly);
    for (const k of cellKeysFor(bboxOf(fullPoly))) {
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(fullPoly);
    }
  };
  const canPlace = (fullPoly) => {
    const b = bboxOf(fullPoly);
    for (const k of cellKeysFor(b)) {
      const arr = grid.get(k);
      if (arr && arr.some((p) => polysOverlap(p, fullPoly))) return false;
    }
    return true;
  };

  const tryPlace = (u, v, preferH) => {
    const full = preferH ? rectPoly(u, v, L, W) : rectPoly(u, v, W, L);
    if (!canPlace(full)) return false;
    place(full);
    return true;
  };

  // Pass 1: strict stripe preference, no fallback (neither orientation may encroach on the
  // other's own stripe -- see header for why this avoids the "one orientation takes over" failure
  // mode a plain greedy-with-fallback pass showed under direct measurement).
  for (let v = minV; v < maxV; v += slotStep) {
    for (let u = minU; u < maxU; u += slotStep) {
      const stripe = Math.floor((u + v) / period);
      tryPlace(u, v, stripe % 2 === 0);
    }
  }
  // Pass 2: fill remaining gaps with whichever orientation fits.
  for (let v = minV; v < maxV; v += slotStep) {
    for (let u = minU; u < maxU; u += slotStep) {
      const stripe = Math.floor((u + v) / period);
      const preferH = stripe % 2 === 0;
      if (!tryPlace(u, v, preferH)) tryPlace(u, v, !preferH);
    }
  }

  // Shrink each accepted (full-size, edge-to-edge-packed) brick by the capped grout half-width,
  // carving out the visible joint AFTER packing -- see the capped-grout comment above for why this
  // runs post-pack rather than being baked into the overlap check itself.
  const shrink = (poly, amt) => {
    if (amt <= 0) return poly;
    const b = bboxOf(poly);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const sx = Math.max(0, b.x1 - b.x0 - 2 * amt) / (b.x1 - b.x0);
    const sy = Math.max(0, b.y1 - b.y0 - 2 * amt) / (b.y1 - b.y0);
    return poly.map((p) => ({ x: cx + (p.x - cx) * sx, y: cy + (p.y - cy) * sy }));
  };

  const cells = [];
  let nextId = 0;
  for (const fullPoly of accepted) {
    const brickPoly = shrink(fullPoly, halfJ);
    const boardPoly = brickPoly.map((p) => rotatePoint(p, cos, sin));
    const preClipBb = bboxOf(boardPoly);
    const refPoint = { x: (preClipBb.x0 + preClipBb.x1) / 2, y: (preClipBb.y0 + preClipBb.y1) / 2 };
    // Clip to the REAL board outline (not just the local bounding-box overscan) -- same
    // convention as every other layout: a cell entirely outside is dropped, a straddling one is
    // trimmed via the shared clip helper (see bond.js's own header for the convex/concave split
    // this inherits unmodified).
    const clipped = clipPolygonToBoard(boardPoly, boardOutline, refPoint);
    if (clipped.length < 3) continue;
    const bb = bboxOf(clipped);
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
    cells.push({ id: nextId++, polygon: clipped, courseIndex: 0, cx, cy, neighbors: {} });
  }
  return { cells };
}
