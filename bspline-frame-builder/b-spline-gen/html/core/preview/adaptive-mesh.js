/**
 * F35 item 17 — ADAPTIVE DISPLAY MESH (opt-in, P.adaptiveDisplay).
 *
 * The 3D preview's height field is sampled on a regular nx × nz grid at the
 * display spacing; the regular mesh spends 2 triangles on every cell, flat or
 * not. This builds an RTIN (right-triangulated irregular network, the
 * Martini scheme) index over the SAME vertices instead: the display spacing
 * stays the finest detail kept, flat areas collapse into big right triangles,
 * and sharp detail (grout lines, brick edges, artwork edges) keeps full
 * resolution.
 *
 * DISPLAY ONLY. Vertices are untouched (same positions / colours / uvs / grid
 * layout), only the triangle index changes — so everything keyed by grid
 * index (vertex colours, brush highlight, drape uvs, side walls) keeps
 * working, and the Send/STEP export (built from lastResult heights, not from
 * this mesh) never sees it.
 *
 * Error metric (stricter than Martini's midpoint estimate): a triangle is kept
 * only if EVERY grid sample inside it lies within `maxError` of the
 * triangle's own plane (checked per listed coordinate component — the top cap
 * checks z, a thickened bottom checks x, y and z since offset points can move
 * sideways). Flags propagate child → parent and are shared across a
 * hypotenuse (one slot per midpoint), which is what keeps the result
 * crack-free.
 *
 * Non-square / non-(2^k+1) grids: the RTIN runs on a virtual (2^k+1)² square
 * covering the grid. A triangle fully outside the real grid is dropped; one
 * straddling its edge is forced to split, so at the finest level every
 * triangle is either fully inside or fully outside (unit-cell triangles), and
 * the real boundary is kept at full resolution (which also keeps the solid's
 * side walls, built from boundary vertices, matching both caps exactly).
 */

/** Declared tuning — data, not code. maxErrorIn: the largest deviation (inches) any grid
 *  sample may have from the adaptive surface. 0.002 in ≈ invisible at preview scale while a
 *  0.034 in brick grout line (≫ 0.002) is always kept at full resolution. */
export const ADAPTIVE_DISPLAY = Object.freeze({ maxErrorIn: 0.002 });

/** At least two of the three coordinates equal `line` (i.e. a triangle edge lies on it). */
const onBoundaryLine = (p, q, r, line) => (p === line) + (q === line) + (r === line) >= 2;

/**
 * Adaptive triangle index for one nx × nz grid cap.
 * @param {ArrayLike<number>} pos  flat xyz positions; the cap's vertex (i, j) is at pos[(base + j*nx + i)*3]
 * @param {number} nx
 * @param {number} nz
 * @param {object} [opts]
 * @param {number} [opts.maxError=ADAPTIVE_DISPLAY.maxErrorIn]
 * @param {number[]} [opts.comps=[2]]   coordinate components checked (0=x, 1=y, 2=z)
 * @param {number} [opts.base=0]        vertex offset of this cap inside pos (and of the emitted indices)
 * @param {boolean} [opts.invert=false] reverse winding (bottom cap), same convention as gridQuadFaceIndices
 * @returns {number[]} triangle indices, winding matching gridQuadFaceIndices(nx, nz, base, invert)
 */
export function adaptiveGridIndices(pos, nx, nz, opts = {}) {
  const maxError = opts.maxError ?? ADAPTIVE_DISPLAY.maxErrorIn;
  const comps = opts.comps || [2];
  const base = opts.base || 0;
  const invert = !!opts.invert;
  if (nx < 2 || nz < 2) return [];

  const maxI = nx - 1, maxJ = nz - 1;
  let tile = 1;
  while (tile < Math.max(maxI, maxJ)) tile <<= 1;
  const size = tile + 1;
  const split = new Uint8Array(size * size); // 1 = the triangle(s) with this hypotenuse midpoint must split

  // Every grid sample inside the right triangle (a, b hypotenuse; c the right angle) within
  // maxError of its plane? Early-exits on the first violation.
  const exceeds = (ax, ay, bx, by, cx, cy) => {
    const ux = ax - cx, uy = ay - cy, vx = bx - cx, vy = by - cy;
    const L2 = ux * ux + uy * uy;
    const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx);
    const y0 = Math.min(ay, by, cy), y1 = Math.max(ay, by, cy);
    const ia = (base + ay * nx + ax) * 3, ib = (base + by * nx + bx) * 3, ic = (base + cy * nx + cx) * 3;
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const sn = dx * ux + dy * uy, tn = dx * vx + dy * vy;
        if (sn < 0 || tn < 0 || sn + tn > L2) continue;
        const s = sn / L2, t = tn / L2;
        const ip = (base + y * nx + x) * 3;
        for (let k = 0; k < comps.length; k++) {
          const c = comps[k];
          const vc = pos[ic + c];
          const interp = vc + s * (pos[ia + c] - vc) + t * (pos[ib + c] - vc);
          if (Math.abs(pos[ip + c] - interp) > maxError) return true;
        }
      }
    }
    return false;
  };

  // Phase 1 — bottom-up, one tree depth at a time (finest parents first), so every child
  // slot is final before its parent reads it. Each pass walks down from the two roots to
  // `depth`, pruning subtrees fully outside the real grid (a non-square board wastes nothing).
  const flag = (ax, ay, bx, by, cx, cy) => {
    const mid = ((ay + by) >> 1) * size + ((ax + bx) >> 1);
    if (split[mid]) return; // the diamond partner already forced it
    if (Math.max(ax, bx, cx) > maxI || Math.max(ay, by, cy) > maxJ) { split[mid] = 1; return; } // straddles the edge
    // An edge lying ON the grid boundary: full res too, so every boundary vertex is a cap
    // vertex (the solid's side walls and the frame trim use all of them — no T-junctions).
    if (onBoundaryLine(ax, bx, cx, 0) || onBoundaryLine(ax, bx, cx, maxI)
      || onBoundaryLine(ay, by, cy, 0) || onBoundaryLine(ay, by, cy, maxJ)) { split[mid] = 1; return; }
    // Children are leaves when the legs are unit diagonals — they own no slots then.
    if (!(Math.abs(ax - cx) === 1 && Math.abs(ay - cy) === 1)) {
      if (split[((ay + cy) >> 1) * size + ((ax + cx) >> 1)] || split[((by + cy) >> 1) * size + ((bx + cx) >> 1)]) {
        split[mid] = 1; return;
      }
    }
    if (exceeds(ax, ay, bx, by, cx, cy)) split[mid] = 1;
  };
  const descend = (ax, ay, bx, by, cx, cy, depth) => {
    if (Math.min(ax, bx, cx) > maxI || Math.min(ay, by, cy) > maxJ) return; // fully outside: dropped
    if (depth === 0) { flag(ax, ay, bx, by, cx, cy); return; }
    const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
    descend(cx, cy, ax, ay, mx, my, depth - 1);
    descend(bx, by, cx, cy, mx, my, depth - 1);
  };
  const leafDepth = 2 * Math.round(Math.log2(tile)); // legs halve in area per level: tile → 1
  for (let depth = leafDepth - 1; depth >= 0; depth--) {
    descend(0, 0, tile, tile, tile, 0, depth);
    descend(tile, tile, 0, 0, 0, tile, depth);
  }

  // Phase 2 — top-down extraction.
  const out = [];
  const emit = (ax, ay, bx, by, cx, cy) => {
    if (Math.max(ax, bx, cx) > maxI || Math.max(ay, by, cy) > maxJ) return; // outside leaf
    const a = base + ay * nx + ax, b = base + by * nx + bx, c = base + cy * nx + cx;
    const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0;
    if (ccw !== invert) out.push(a, b, c); else out.push(a, c, b);
  };
  const walk = (ax, ay, bx, by, cx, cy) => {
    if (Math.min(ax, bx, cx) > maxI || Math.min(ay, by, cy) > maxJ) return;
    const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
    if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && split[my * size + mx]) {
      walk(cx, cy, ax, ay, mx, my);
      walk(bx, by, cx, cy, mx, my);
    } else {
      emit(ax, ay, bx, by, cx, cy);
    }
  };
  walk(0, 0, tile, tile, tile, 0);
  walk(tile, tile, 0, 0, 0, tile);
  return out;
}
