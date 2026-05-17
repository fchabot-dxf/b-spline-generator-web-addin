/**
 * stp-tessellate.js — convert parsed STEP B-spline surfaces into
 * triangle meshes ready for Three.js BufferGeometry.
 *
 * SELF-CONTAINED: imports only from stp-parser.js / stp-bodies.js in
 * this same folder. No external dependencies.
 *
 * SCOPE FOR V1 — what we tessellate, what we skip:
 *
 *   ✓ B_SPLINE_SURFACE_WITH_KNOTS — full Cox-de Boor evaluation on a
 *     regular UV grid. Handles arbitrary degree, knot multiplicities,
 *     and grid dimensions. Vast majority of organic-shape STEP files
 *     (the canoe is 100% this type).
 *
 *   ✗ Trimming via FACE_BOUNDS — we render the WHOLE parametric patch
 *     ignoring any trim curves. Result: extra "flaps" at face edges
 *     for parts of the surface that ought to be cut away. Acceptable
 *     for visual identification / scale-checking; real CAD viewing
 *     would need a 2D trim polygon clipper.
 *
 *   ✗ Other surface types — PLANE, CYLINDRICAL_SURFACE, CONICAL_SURFACE,
 *     SPHERICAL_SURFACE, TOROIDAL_SURFACE, SURFACE_OF_REVOLUTION,
 *     SURFACE_OF_LINEAR_EXTRUSION. Each is one extra parametric formula
 *     and ~30 lines to add later when a file needs them.
 *
 * Output shape (everything Three.js needs to build a BufferGeometry):
 *   {
 *     positions: Float32Array,  // x,y,z … (3 floats per vertex)
 *     normals:   Float32Array,  // nx,ny,nz … (per vertex, area-weighted)
 *     indices:   Uint32Array,   // i0,i1,i2 per triangle
 *     surfaceCount: number,     // how many B-spline surfaces were meshed
 *     skippedCount: number,     // how many were skipped (non-B-spline, malformed)
 *   }
 */

import { tokenizeArgs } from './stp-parser.js';
import { reachableEntities } from './stp-bodies.js';

const DEFAULT_RES = 16;   // samples per UV direction per surface

/* ────────────────────────────────────────────────────────────────────
 * Public API
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Tessellate every B-spline surface reachable from a body root into
 * a single merged mesh. Returns null if no surfaces were found.
 *
 * @param {import('./stp-parser.js').ParsedStep} parsed
 * @param {number} bodyId
 * @param {number} [resolution]  samples per UV axis per surface
 * @returns {{positions:Float32Array, normals:Float32Array, indices:Uint32Array, surfaceCount:number, skippedCount:number} | null}
 */
export function tessellateBody(parsed, bodyId, resolution = DEFAULT_RES) {
  if (!parsed || !parsed.entities || !parsed.entities.has(bodyId)) return null;

  const reachable = reachableEntities(parsed, bodyId);
  const positions = [];
  const normals   = [];
  const indices   = [];

  let surfaceCount = 0;
  let skippedCount = 0;

  for (const id of reachable) {
    const e = parsed.entities.get(id);
    if (!e || e.type !== 'B_SPLINE_SURFACE_WITH_KNOTS') continue;

    const surf = parseBSplineSurface(parsed, e);
    if (!surf) { skippedCount++; continue; }

    const mesh = tessellateBSplineSurface(surf, resolution);
    if (!mesh) { skippedCount++; continue; }

    const baseVertex = positions.length / 3;
    for (let i = 0; i < mesh.positions.length; i++) positions.push(mesh.positions[i]);
    for (let i = 0; i < mesh.normals.length;   i++) normals.push(mesh.normals[i]);
    for (let i = 0; i < mesh.indices.length;   i++) indices.push(mesh.indices[i] + baseVertex);
    surfaceCount++;
  }

  if (!surfaceCount) return null;

  return {
    positions:    new Float32Array(positions),
    normals:      new Float32Array(normals),
    indices:      new Uint32Array(indices),
    surfaceCount,
    skippedCount,
  };
}

/**
 * Parse a B-spline surface (plain or rational) into a structured record.
 *
 * Two STEP encodings are handled:
 *
 *   1. Simple `B_SPLINE_SURFACE_WITH_KNOTS(...)` — no weights, args
 *      laid out as documented in ISO 10303-42.
 *
 *   2. Compound `(...)` rows whose inner slots include
 *      `B_SPLINE_SURFACE`, `B_SPLINE_SURFACE_WITH_KNOTS`, and
 *      `RATIONAL_B_SPLINE_SURFACE`.  The control-point grid and degree
 *      come from B_SPLINE_SURFACE, the knot multiplicities/values from
 *      B_SPLINE_SURFACE_WITH_KNOTS, and the per-CP weights from
 *      RATIONAL_B_SPLINE_SURFACE.  Result is a rational (NURBS) surface
 *      with `weights` populated.
 *
 * @returns {{
 *   degU:number, degV:number,
 *   nu:number, nv:number,
 *   cps: Float64Array,        // flat (nu*nv*3) row-major
 *   weights: Float64Array|null, // nu*nv per-CP weights, or null if plain
 *   knotsU: Float64Array,
 *   knotsV: Float64Array,
 *   rational: boolean,        // mirror of `!!weights` for convenience
 *   compoundShape: object|null, // if input was compound, the slot names
 *                                // for round-trip emission; else null
 * } | null}
 */
export function parseBSplineSurface(parsed, entity) {
  // Dispatch: compound vs simple.
  const slots = collectSurfaceSlots(entity);
  if (!slots) return null;

  const { spline, splineWithKnots, rational, compoundShape } = slots;

  // arg[0] is the name; arg[1]=degU, arg[2]=degV, arg[3]=cpGrid in the
  // simple form. For the compound form, B_SPLINE_SURFACE has its own
  // args[0]=degU, args[1]=degV, args[2]=cpGrid (no name slot — the
  // name lives in the compound's REPRESENTATION_ITEM slot instead).
  const isCompound = !!compoundShape;
  const degU   = Number(isCompound ? spline.args[0] : spline.args[1]);
  const degV   = Number(isCompound ? spline.args[1] : spline.args[2]);
  const cpArg  =        isCompound ? spline.args[2] : spline.args[3];
  if (!Number.isFinite(degU) || !Number.isFinite(degV)) return null;

  const cpGrid = parseRefGrid2D(cpArg);
  if (!cpGrid || !cpGrid.length || !cpGrid[0].length) return null;
  const nu = cpGrid.length;
  const nv = cpGrid[0].length;

  const cps = new Float64Array(nu * nv * 3);
  for (let i = 0; i < nu; i++) {
    if (!cpGrid[i] || cpGrid[i].length !== nv) return null;
    for (let j = 0; j < nv; j++) {
      const ptId = cpGrid[i][j];
      const p = parsed.entities.get(ptId);
      if (!p || p.type !== 'CARTESIAN_POINT') return null;
      const xyz = parseTuple(p.args[1]);
      if (!xyz) return null;
      const k = (i * nv + j) * 3;
      cps[k]     = xyz[0] || 0;
      cps[k + 1] = xyz[1] || 0;
      cps[k + 2] = xyz[2] || 0;
    }
  }

  // Knot multiplicities + knot values. Same arg layout for the simple
  // and compound B_SPLINE_SURFACE_WITH_KNOTS — the compound slot is
  // just a separate inner entity with the four args concatenated.
  const wkArgs = splineWithKnots.args;
  const multU  = parseNumberList(isCompound ? wkArgs[0] : wkArgs[8]);
  const multV  = parseNumberList(isCompound ? wkArgs[1] : wkArgs[9]);
  const knotsU = parseNumberList(isCompound ? wkArgs[2] : wkArgs[10]);
  const knotsV = parseNumberList(isCompound ? wkArgs[3] : wkArgs[11]);
  if (!multU || !multV || !knotsU || !knotsV) return null;
  if (multU.length !== knotsU.length || multV.length !== knotsV.length) return null;

  const expandU = expandKnots(knotsU, multU);
  const expandV = expandKnots(knotsV, multV);
  if (expandU.length !== nu + degU + 1) return null;
  if (expandV.length !== nv + degV + 1) return null;

  // Optional weight grid (rational surfaces only). Same 2D-grid shape
  // as the CP grid; values are plain floats.
  let weights = null;
  if (rational) {
    const grid = parseNumberGrid2D(rational.args[0]);
    if (grid && grid.length === nu && grid.every(row => row.length === nv)) {
      weights = new Float64Array(nu * nv);
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) weights[i * nv + j] = grid[i][j];
      }
    }
  }

  return {
    degU, degV, nu, nv, cps, weights,
    knotsU: new Float64Array(expandU),
    knotsV: new Float64Array(expandV),
    rational: !!weights,
    compoundShape,
  };
}

/**
 * Inspect a top-level surface entity (either simple or compound) and
 * return the structural slots the parser cares about, or null if the
 * entity isn't a recognised B-spline surface form.
 *
 * For compound entities, also returns a `compoundShape` record that
 * lists the inner slot names in their original order so we can rewrite
 * the compound back out unchanged when emitting from regrid.
 */
function collectSurfaceSlots(entity) {
  if (entity.type === 'B_SPLINE_SURFACE_WITH_KNOTS') {
    // Simple form — both spline and spline-with-knots are the same row.
    if (!entity.args || entity.args.length < 12) return null;
    return {
      spline: entity,
      splineWithKnots: entity,
      rational: null,
      compoundShape: null,
    };
  }
  if (entity.compound && entity.compound.length) {
    const byType = {};
    const slotOrder = [];
    for (const part of entity.compound) {
      byType[part.type] = part;
      slotOrder.push(part.type);
    }
    const spline = byType.B_SPLINE_SURFACE;
    const splineWithKnots = byType.B_SPLINE_SURFACE_WITH_KNOTS;
    if (!spline || !splineWithKnots) return null;
    return {
      spline,
      splineWithKnots,
      rational: byType.RATIONAL_B_SPLINE_SURFACE || null,
      compoundShape: { slotOrder, parts: byType },
    };
  }
  return null;
}

/**
 * Sample a B-spline (or rational B-spline) surface on a regular UV
 * grid and emit triangles.  Rational evaluation uses the standard
 *
 *      S(u,v) = Σ_i Σ_j  N_i(u)·M_j(v)·w_ij·P_ij
 *               ─────────────────────────────────
 *               Σ_i Σ_j  N_i(u)·M_j(v)·w_ij
 *
 *  Per-vertex normals are computed by averaging adjacent face normals.
 */
export function tessellateBSplineSurface(surf, resolution = DEFAULT_RES) {
  const { degU, degV, nu, nv, cps, knotsU, knotsV, weights } = surf;
  const resU = resolution;
  const resV = resolution;

  // Sample u/v range from the knot vector — the surface is only defined
  // between knots[deg] and knots[n] (Cox-de Boor convention).
  const uMin = knotsU[degU];
  const uMax = knotsU[nu];
  const vMin = knotsV[degV];
  const vMax = knotsV[nv];
  if (!(uMax > uMin) || !(vMax > vMin)) return null;

  const W = resU + 1;
  const H = resV + 1;
  const positions = new Float64Array(W * H * 3);
  const normals   = new Float64Array(W * H * 3);

  // Evaluate the surface at each grid point. Cache basis functions per
  // u row so we don't recompute them for every column.
  const basisCache = new Array(W);
  for (let iu = 0; iu < W; iu++) {
    const u = uMin + (uMax - uMin) * (iu / resU);
    basisCache[iu] = computeBasis(u, degU, knotsU);
  }

  for (let iv = 0; iv < H; iv++) {
    const v = vMin + (vMax - vMin) * (iv / resV);
    const basisV = computeBasis(v, degV, knotsV);

    for (let iu = 0; iu < W; iu++) {
      const basisU = basisCache[iu];
      let x = 0, y = 0, z = 0;
      let wsum = 0;
      for (let i = 0; i < nu; i++) {
        const bu = basisU.values[i - basisU.span + degU];
        if (!bu) continue;
        for (let j = 0; j < nv; j++) {
          const bv = basisV.values[j - basisV.span + degV];
          if (!bv) continue;
          const k = (i * nv + j) * 3;
          // Rational surfaces fold per-CP weights into the numerator
          // (Σ N·M·w·P) and accumulate the denominator (Σ N·M·w)
          // separately; non-rational is just w = 1 everywhere.
          const w = weights ? weights[i * nv + j] : 1;
          const c = bu * bv * w;
          x += c * cps[k];
          y += c * cps[k + 1];
          z += c * cps[k + 2];
          wsum += c;
        }
      }
      // For rational surfaces, divide by Σ N·M·w. Guard against the
      // pathological all-zero-weight case so we don't NaN the mesh.
      if (weights && wsum !== 0) {
        x /= wsum; y /= wsum; z /= wsum;
      }
      const idx = (iv * W + iu) * 3;
      positions[idx]     = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;
    }
  }

  // Build triangle indices: 2 triangles per grid cell.
  const indices = new Uint32Array(resU * resV * 6);
  let p = 0;
  for (let iv = 0; iv < resV; iv++) {
    for (let iu = 0; iu < resU; iu++) {
      const a = iv * W + iu;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      indices[p++] = a; indices[p++] = c; indices[p++] = b;
      indices[p++] = b; indices[p++] = c; indices[p++] = d;
    }
  }

  // Compute per-vertex normals as the area-weighted average of adjacent
  // face normals. Cheap and gives good Gouraud-shaded output.
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i],     ib = indices[i + 1], ic = indices[i + 2];
    const ax = positions[ia*3], ay = positions[ia*3+1], az = positions[ia*3+2];
    const bx = positions[ib*3], by = positions[ib*3+1], bz = positions[ib*3+2];
    const cx = positions[ic*3], cy = positions[ic*3+1], cz = positions[ic*3+2];
    // Edge vectors
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    // Cross product (area-weighted normal)
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normals[ia*3]     += nx; normals[ia*3 + 1] += ny; normals[ia*3 + 2] += nz;
    normals[ib*3]     += nx; normals[ib*3 + 1] += ny; normals[ib*3 + 2] += nz;
    normals[ic*3]     += nx; normals[ic*3 + 1] += ny; normals[ic*3 + 2] += nz;
  }
  // Normalize per-vertex normals.
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i], y = normals[i + 1], z = normals[i + 2];
    const m = Math.sqrt(x*x + y*y + z*z);
    if (m > 1e-12) { normals[i] = x / m; normals[i + 1] = y / m; normals[i + 2] = z / m; }
    else            { normals[i] = 0;    normals[i + 1] = 0;    normals[i + 2] = 1; }
  }

  return {
    positions: new Float32Array(positions),
    normals:   new Float32Array(normals),
    indices,
  };
}

/* ────────────────────────────────────────────────────────────────────
 * Public — evaluate B-spline surface at a single (u,v) with derivatives
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Evaluate a parsed B-spline (or rational B-spline) surface at the given
 * (u, v) parameters and return position + first partial derivatives.
 *
 * The (u, v) inputs are clamped to the surface's parameter domain
 * [knotsU[degU] .. knotsU[nu], knotsV[degV] .. knotsV[nv]].
 *
 * Returns `{ p: [x,y,z], du: [x,y,z], dv: [x,y,z] }`, or `null` if the
 * surface input is malformed. The surface normal at (u, v) is
 * `normalise(cross(du, dv))`.
 *
 * For rational surfaces, the standard quotient-rule derivative of the
 * homogeneous representation is used so weights are accounted for.
 */
export function evalBSplineSurfaceAt(surf, u, v) {
  if (!surf) return null;
  const { degU, degV, nu, nv, cps, knotsU, knotsV, weights } = surf;
  const uMin = knotsU[degU], uMax = knotsU[nu];
  const vMin = knotsV[degV], vMax = knotsV[nv];
  if (!(uMax > uMin) || !(vMax > vMin)) return null;
  // Clamp to domain — sample-rounding by callers can leave us a hair
  // outside, which would otherwise NaN through findKnotSpan.
  const uu = Math.min(uMax, Math.max(uMin, u));
  const vv = Math.min(vMax, Math.max(vMin, v));

  const basisU = computeBasisWithDerivs(uu, degU, knotsU);
  const basisV = computeBasisWithDerivs(vv, degV, knotsV);

  // Accumulate the homogeneous-coordinate sums:
  //   A   = Σ N(u)·M(v)·w·P    (length-3 in xyz)
  //   wsum = Σ N(u)·M(v)·w     (scalar)
  // plus their u- and v-partials. For non-rational w ≡ 1.
  let Ax = 0, Ay = 0, Az = 0, W = 0;
  let Aux = 0, Auy = 0, Auz = 0, Wu = 0;
  let Avx = 0, Avy = 0, Avz = 0, Wv = 0;

  // basisU.values / basisU.derivs are length (degU+1); they hold the
  // non-zero basis values for control points i = span-deg .. span.
  for (let ii = 0; ii <= degU; ii++) {
    const i  = basisU.span - degU + ii;
    const bu = basisU.values[ii];
    const buD = basisU.derivs[ii];
    for (let jj = 0; jj <= degV; jj++) {
      const j  = basisV.span - degV + jj;
      const bv = basisV.values[jj];
      const bvD = basisV.derivs[jj];
      const k = (i * nv + j) * 3;
      const w = weights ? weights[i * nv + j] : 1;
      const px = cps[k] * w, py = cps[k + 1] * w, pz = cps[k + 2] * w;

      const nm   = bu  * bv;
      const dNu  = buD * bv;
      const dNv  = bu  * bvD;

      Ax  += nm  * px;  Ay  += nm  * py;  Az  += nm  * pz;
      Aux += dNu * px;  Auy += dNu * py;  Auz += dNu * pz;
      Avx += dNv * px;  Avy += dNv * py;  Avz += dNv * pz;

      W  += nm  * w;
      Wu += dNu * w;
      Wv += dNv * w;
    }
  }

  // Non-rational case: W ≡ 1, Wu = Wv = 0, so the quotient rule collapses
  // to plain Σ N·M·P. Rational case uses the full derivative formula.
  let p, du, dv;
  if (W === 0) return null;
  const invW  = 1 / W;
  const invW2 = invW * invW;
  p  = [Ax  * invW, Ay  * invW, Az  * invW];
  du = [(Aux - Ax * Wu * invW) * invW,
        (Auy - Ay * Wu * invW) * invW,
        (Auz - Az * Wu * invW) * invW];
  dv = [(Avx - Ax * Wv * invW) * invW,
        (Avy - Ay * Wv * invW) * invW,
        (Avz - Az * Wv * invW) * invW];
  return { p, du, dv };
}

/** Return the surface UV parameter domain — useful for callers that
 *  need to tile in UV space without poking at knot arrays directly. */
export function bSplineSurfaceDomain(surf) {
  if (!surf) return null;
  return {
    uMin: surf.knotsU[surf.degU],
    uMax: surf.knotsU[surf.nu],
    vMin: surf.knotsV[surf.degV],
    vMax: surf.knotsV[surf.nv],
  };
}

/* ────────────────────────────────────────────────────────────────────
 * Private — B-spline basis evaluation (Cox-de Boor)
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Compute basis values AND first derivatives at parameter u. Returns
 * `{ span, values, derivs }`, each of length (deg+1). The derivative
 * formula is Piegl & Tiller A2.5 specialised for k = 1.
 *
 * For deg = 0 the derivatives are zero (a degree-0 B-spline is
 * piecewise constant and its derivative is the zero distribution
 * everywhere except at knot crossings, which we don't sample at).
 */
function computeBasisWithDerivs(u, deg, knots) {
  const span = findKnotSpan(u, deg, knots);
  const values = new Float64Array(deg + 1);
  const derivs = new Float64Array(deg + 1);
  if (deg === 0) { values[0] = 1; return { span, values, derivs }; }

  // ndu[j][r] = lower-degree basis values during the Cox-de Boor recursion;
  // we reuse it to compute the first derivative below.
  const ndu  = new Array(deg + 1);
  for (let i = 0; i <= deg; i++) ndu[i] = new Float64Array(deg + 1);
  const left  = new Float64Array(deg + 1);
  const right = new Float64Array(deg + 1);

  ndu[0][0] = 1;
  for (let j = 1; j <= deg; j++) {
    left[j]  = u - knots[span + 1 - j];
    right[j] = knots[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      ndu[j][r] = right[r + 1] + left[j - r];
      const temp = ndu[j][r] !== 0 ? ndu[r][j - 1] / ndu[j][r] : 0;
      ndu[r][j] = saved + right[r + 1] * temp;
      saved     = left[j - r] * temp;
    }
    ndu[j][j] = saved;
  }
  for (let i = 0; i <= deg; i++) values[i] = ndu[i][deg];

  // First derivative — Piegl & Tiller A2.5 with k = 1.
  for (let r = 0; r <= deg; r++) {
    // d/du N_{r,deg}(u) = deg · [ N_{r,deg-1}/(knot[r+deg]-knot[r])
    //                            − N_{r+1,deg-1}/(knot[r+deg+1]-knot[r+1]) ]
    const a0 = (r >= 1) ? ndu[r - 1][deg - 1] / ndu[deg][r - 1] : 0;
    const a1 = (r <= deg - 1) ? ndu[r][deg - 1] / ndu[deg][r]   : 0;
    derivs[r] = deg * (a0 - a1);
  }
  return { span, values, derivs };
}

/**
 * Compute the non-zero B-spline basis values N_{i,p}(u) at parameter u.
 *
 * Returns `{ span, values }` where:
 *   span   = the knot span index s such that knots[s] <= u < knots[s+1]
 *   values = Float64Array of length (deg+1), holding N_{s-deg}(u) .. N_s(u)
 *
 * Standard "The NURBS Book" algorithm A2.3 (Piegl & Tiller). O(deg²).
 */
function computeBasis(u, deg, knots) {
  const span = findKnotSpan(u, deg, knots);
  const values = new Float64Array(deg + 1);
  const left   = new Float64Array(deg + 1);
  const right  = new Float64Array(deg + 1);
  values[0] = 1;
  for (let j = 1; j <= deg; j++) {
    left[j]  = u - knots[span + 1 - j];
    right[j] = knots[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denom = right[r + 1] + left[j - r];
      const temp  = denom !== 0 ? values[r] / denom : 0;
      values[r] = saved + right[r + 1] * temp;
      saved     = left[j - r] * temp;
    }
    values[j] = saved;
  }
  return { span, values };
}

/**
 * Binary search for the knot span containing u. Clamps to [deg, n] so
 * the basis arithmetic above stays well-defined at the parameter
 * domain endpoints.
 */
function findKnotSpan(u, deg, knots) {
  const n = knots.length - deg - 2;
  if (u >= knots[n + 1]) return n;
  if (u <= knots[deg])   return deg;
  let lo = deg, hi = n + 1, mid;
  while (lo + 1 < hi) {
    mid = (lo + hi) >>> 1;
    if (u < knots[mid]) hi = mid;
    else                lo = mid;
  }
  return lo;
}

/* ────────────────────────────────────────────────────────────────────
 * Private — STEP arg helpers
 * ──────────────────────────────────────────────────────────────────── */

/** Parse "((#1,#2,#3),(#4,#5,#6))" into [[1,2,3],[4,5,6]]. */
function parseRefGrid2D(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t[0] !== '(' || t[t.length - 1] !== ')') return null;
  const rows = tokenizeArgs(t.slice(1, -1));
  const out = [];
  for (const row of rows) {
    const r = row.trim();
    if (r[0] !== '(' || r[r.length - 1] !== ')') return null;
    const refs = tokenizeArgs(r.slice(1, -1));
    const ids = refs.map(s => Number(s.trim().slice(1))); // drop leading '#'
    if (ids.some(n => !Number.isFinite(n))) return null;
    out.push(ids);
  }
  return out;
}

/** Parse "(0.,1.5,3.)" into [0, 1.5, 3]. */
function parseNumberList(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t[0] !== '(' || t[t.length - 1] !== ')') return null;
  const parts = tokenizeArgs(t.slice(1, -1));
  const out = parts.map(s => Number(s.trim()));
  if (out.some(n => !Number.isFinite(n))) return null;
  return out;
}

/** Parse "((1.,2.,3.),(4.,5.,6.))" into [[1,2,3],[4,5,6]]. Used for
 *  the weight grid in RATIONAL_B_SPLINE_SURFACE entities. */
function parseNumberGrid2D(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t[0] !== '(' || t[t.length - 1] !== ')') return null;
  const rows = tokenizeArgs(t.slice(1, -1));
  const out = [];
  for (const row of rows) {
    const inner = parseNumberList(row);
    if (!inner) return null;
    out.push(inner);
  }
  return out;
}

/** Parse "(x, y, z)" → [x, y, z]. */
function parseTuple(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t[0] !== '(' || t[t.length - 1] !== ')') return null;
  const parts = tokenizeArgs(t.slice(1, -1));
  const out = parts.map(s => Number(s.trim()));
  if (out.some(n => !Number.isFinite(n))) return null;
  return out;
}

/** Expand compact (knots, multiplicities) into the full repeated knot vector. */
function expandKnots(knots, mults) {
  const out = [];
  for (let i = 0; i < knots.length; i++) {
    const m = mults[i] | 0;
    for (let k = 0; k < m; k++) out.push(knots[i]);
  }
  return out;
}
