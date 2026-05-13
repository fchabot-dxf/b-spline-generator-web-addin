/**
 * stp-regrid.js — re-parameterize B-spline surfaces to a uniform N×M
 * control-point grid.
 *
 * SELF-CONTAINED: imports only from sibling modules in core/. The math
 * sits on top of stp-tessellate.js's parser + Cox-de Boor evaluation,
 * and the graph mutations sit on top of stp-bodies.js's reachability.
 *
 * What it does:
 *   For every B_SPLINE_SURFACE_WITH_KNOTS reachable from the selected
 *   body, sample the existing surface at a fine `sampleRes × sampleRes`
 *   parameter grid, then fit a new tensor-product B-spline surface
 *   with `targetNu × targetNv` control points on a clamped uniform
 *   knot vector. The original surface entity is rewritten in place
 *   to reference the new control points and the new knot vectors.
 *   Old CARTESIAN_POINTs become orphans (no longer referenced by any
 *   path the body walks — Fusion's importer prunes them automatically).
 *
 * Math:
 *   Tensor-product B-spline fitting decomposes into two sequential
 *   1D problems:
 *     1. For each row of samples (fixed u, varying v), fit a curve in
 *        v with targetNv CPs. Result: sampleRes × targetNv intermediate
 *        grid.
 *     2. For each column of intermediates (fixed v, varying u), fit a
 *        curve in u with targetNu CPs. Result: targetNu × targetNv
 *        final CP grid.
 *
 *   Each 1D fit solves the normal equations  (Bᵀ·B)·P = Bᵀ·S,
 *   where B is the basis matrix evaluated at the sample parameters
 *   and S is the sample data. Gauss-Jordan elimination on the
 *   N×(N+K) augmented matrix; N stays small (8-32 typically) so the
 *   cubic cost is negligible.
 *
 * NOT done in v1:
 *   - Endpoint interpolation constraint (samples at u=0 and u=1 are
 *     used as data but not pinned to the new CPs). Result: the new
 *     surface may drift slightly from the original at the boundary.
 *     A clamped uniform knot vector still gives close-to-endpoint
 *     fit because the corner basis functions are 1 at the corners.
 *   - Rational (NURBS) surfaces. Pure B-spline only. Files dominated
 *     by RATIONAL_B_SPLINE_SURFACE fall through to the skipped count.
 */

import { reachableEntities } from './stp-bodies.js';
import { parseBSplineSurface } from './stp-tessellate.js';

/* ────────────────────────────────────────────────────────────────────
 * Public API
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Regrid every B-spline surface in `bodyId`'s sub-graph to a uniform
 * `targetNu × targetNv` CP grid.
 *
 * @param {import('./stp-parser.js').ParsedStep} parsed
 * @param {number} bodyId
 * @param {object} [opts]
 * @param {number} [opts.targetNu=8]   target CPs in U
 * @param {number} [opts.targetNv=8]   target CPs in V
 * @param {number} [opts.sampleRes=32] sampleRes × sampleRes evaluation grid
 * @returns {{ surfaces:number, skipped:number, newPoints:number }}
 */
export function regridBody(parsed, bodyId, opts = {}) {
  const targetNu  = Math.max(2, opts.targetNu  | 0 || 8);
  const targetNv  = Math.max(2, opts.targetNv  | 0 || 8);
  const sampleRes = Math.max(targetNu + 4, Math.max(targetNv + 4, opts.sampleRes | 0 || 32));

  const reachable = reachableEntities(parsed, bodyId);

  // Allocate fresh IDs above the current max so new CARTESIAN_POINTs
  // never collide with existing ones.
  let nextId = 0;
  for (const id of parsed.entities.keys()) if (id > nextId) nextId = id;
  nextId += 1;

  let surfaces = 0, skipped = 0, newPoints = 0;

  for (const id of reachable) {
    const e = parsed.entities.get(id);
    if (!e || e.type !== 'B_SPLINE_SURFACE_WITH_KNOTS') continue;

    const surf = parseBSplineSurface(parsed, e);
    if (!surf) { skipped++; continue; }

    // Skip degenerate request: target grid not bigger than degree.
    if (targetNu <= surf.degU || targetNv <= surf.degV) { skipped++; continue; }

    const newCps = fitTensorBSpline(surf, targetNu, targetNv, sampleRes);
    if (!newCps) { skipped++; continue; }

    // Mint new CARTESIAN_POINT entities for the freshly-fit CPs.
    const newIds = new Array(targetNu);
    for (let i = 0; i < targetNu; i++) {
      newIds[i] = new Array(targetNv);
      for (let j = 0; j < targetNv; j++) {
        const k = (i * targetNv + j) * 3;
        const x = newCps[k], y = newCps[k + 1], z = newCps[k + 2];
        const ptId = nextId++;
        parsed.entities.set(ptId, {
          id: ptId, type: 'CARTESIAN_POINT', compound: null,
          args: ["''", `(${fmt(x)},${fmt(y)},${fmt(z)})`],
        });
        newIds[i][j] = ptId;
        newPoints++;
      }
    }

    // Rewrite the surface's args: control point grid, knot multiplicities,
    // knot vectors. Other args (name, degrees, closed flags, knot spec)
    // stay as-is.
    const cpGridArg = '(' + newIds.map(row =>
      '(' + row.map(id => `#${id}`).join(',') + ')'
    ).join(',') + ')';

    const { multStr: multU, knotStr: knotU } = uniformKnotStrings(targetNu, surf.degU);
    const { multStr: multV, knotStr: knotV } = uniformKnotStrings(targetNv, surf.degV);

    e.args[3]  = cpGridArg;
    e.args[8]  = multU;
    e.args[9]  = multV;
    e.args[10] = knotU;
    e.args[11] = knotV;

    surfaces++;
  }

  return { surfaces, skipped, newPoints };
}

/* ────────────────────────────────────────────────────────────────────
 * Private — fitting
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Fit a uniform `Nu × Nv` B-spline surface to a sampled version of
 * `surf` by tensor-product least squares. Returns a flat Float64Array
 * (length Nu*Nv*3) of new control point coordinates.
 */
function fitTensorBSpline(surf, Nu, Nv, sampleRes) {
  const { degU, degV } = surf;

  // 1. Sample the source surface at sampleRes × sampleRes points.
  //    Parameters span the active knot range of each direction.
  const uMin = surf.knotsU[degU];
  const uMax = surf.knotsU[surf.nu];
  const vMin = surf.knotsV[degV];
  const vMax = surf.knotsV[surf.nv];
  const S = new Float64Array(sampleRes * sampleRes * 3);
  for (let i = 0; i < sampleRes; i++) {
    const u = uMin + (uMax - uMin) * (i / (sampleRes - 1));
    for (let j = 0; j < sampleRes; j++) {
      const v = vMin + (vMax - vMin) * (j / (sampleRes - 1));
      const [x, y, z] = evalSurface(surf, u, v);
      const k = (i * sampleRes + j) * 3;
      S[k] = x; S[k + 1] = y; S[k + 2] = z;
    }
  }

  // 2. Target uniform clamped knot vectors.
  const knotsU = uniformKnotVector(Nu, degU);
  const knotsV = uniformKnotVector(Nv, degV);

  // 3. Sample parameter values (uniform spacing across the new domain).
  //    Domain is [0, 1] for the new uniform surface.
  const paramU = new Float64Array(sampleRes);
  const paramV = new Float64Array(sampleRes);
  for (let i = 0; i < sampleRes; i++) {
    paramU[i] = i / (sampleRes - 1);
    paramV[i] = i / (sampleRes - 1);
  }

  // 4. Basis matrices: B_u (sampleRes × Nu), B_v (sampleRes × Nv).
  const Bu = buildBasisMatrix(paramU, degU, knotsU, Nu);
  const Bv = buildBasisMatrix(paramV, degV, knotsV, Nv);

  // 5. First pass — fit each row of samples in V direction.
  //    Intermediate Q has shape sampleRes × Nv × 3.
  const Q = new Float64Array(sampleRes * Nv * 3);
  // Pre-compute (Bv^T Bv) once: same for every row.
  const BvTBv = matATA(Bv, sampleRes, Nv);     // Nv × Nv
  for (let i = 0; i < sampleRes; i++) {
    // S_row = S[i, *, *]  (shape sampleRes × 3)
    const rhs = new Float64Array(Nv * 3);
    for (let j = 0; j < sampleRes; j++) {
      const sIdx = (i * sampleRes + j) * 3;
      for (let l = 0; l < Nv; l++) {
        const w = Bv[j * Nv + l];
        if (w === 0) continue;
        rhs[l * 3]     += w * S[sIdx];
        rhs[l * 3 + 1] += w * S[sIdx + 1];
        rhs[l * 3 + 2] += w * S[sIdx + 2];
      }
    }
    // Solve (Bv^T Bv) Q_row = rhs  for Q[i, *, *].
    const sol = solveSystem(cloneMatrix(BvTBv, Nv), rhs, Nv, 3);
    if (!sol) return null;
    for (let l = 0; l < Nv; l++) {
      const qIdx = (i * Nv + l) * 3;
      Q[qIdx]     = sol[l * 3];
      Q[qIdx + 1] = sol[l * 3 + 1];
      Q[qIdx + 2] = sol[l * 3 + 2];
    }
  }

  // 6. Second pass — fit each column of Q in U direction.
  //    Final P has shape Nu × Nv × 3.
  const P = new Float64Array(Nu * Nv * 3);
  const BuTBu = matATA(Bu, sampleRes, Nu);     // Nu × Nu
  for (let l = 0; l < Nv; l++) {
    const rhs = new Float64Array(Nu * 3);
    for (let i = 0; i < sampleRes; i++) {
      const qIdx = (i * Nv + l) * 3;
      for (let k = 0; k < Nu; k++) {
        const w = Bu[i * Nu + k];
        if (w === 0) continue;
        rhs[k * 3]     += w * Q[qIdx];
        rhs[k * 3 + 1] += w * Q[qIdx + 1];
        rhs[k * 3 + 2] += w * Q[qIdx + 2];
      }
    }
    const sol = solveSystem(cloneMatrix(BuTBu, Nu), rhs, Nu, 3);
    if (!sol) return null;
    for (let k = 0; k < Nu; k++) {
      const pIdx = (k * Nv + l) * 3;
      P[pIdx]     = sol[k * 3];
      P[pIdx + 1] = sol[k * 3 + 1];
      P[pIdx + 2] = sol[k * 3 + 2];
    }
  }

  return P;
}

/** Evaluate the source B-spline surface at (u, v). Mirrors the
 *  tessellator's eval; inlined here so this module doesn't depend on
 *  the tessellator's internal helpers. */
function evalSurface(surf, u, v) {
  const { degU, degV, nu, nv, cps, knotsU, knotsV } = surf;
  const bu = computeBasis(u, degU, knotsU);
  const bv = computeBasis(v, degV, knotsV);
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < nu; i++) {
    const wu = bu.values[i - (bu.span - degU)];
    if (!wu) continue;
    for (let j = 0; j < nv; j++) {
      const wv = bv.values[j - (bv.span - degV)];
      if (!wv) continue;
      const k = (i * nv + j) * 3;
      const w = wu * wv;
      x += w * cps[k];
      y += w * cps[k + 1];
      z += w * cps[k + 2];
    }
  }
  return [x, y, z];
}

/* ────────────────────────────────────────────────────────────────────
 * Private — uniform knot vector helpers
 * ──────────────────────────────────────────────────────────────────── */

/** Build a clamped uniform knot vector for `n` CPs at degree `deg`. */
function uniformKnotVector(n, deg) {
  const interior = n - deg - 1;   // count of interior knots
  const total = n + deg + 1;
  const out = new Float64Array(total);
  for (let i = 0; i <= deg; i++) out[i] = 0;
  for (let i = 1; i <= interior; i++) out[deg + i] = i / (interior + 1);
  for (let i = 0; i <= deg; i++) out[n + i] = 1;
  return out;
}

/** STEP-syntax strings for a uniform clamped knot vector at degree
 *  `deg` with `n` CPs. */
function uniformKnotStrings(n, deg) {
  const distinct = n - deg + 1;  // count of distinct knot values
  const mult = new Array(distinct);
  const knot = new Array(distinct);
  mult[0] = deg + 1;
  mult[distinct - 1] = deg + 1;
  for (let i = 1; i < distinct - 1; i++) mult[i] = 1;
  for (let i = 0; i < distinct; i++) knot[i] = i / (distinct - 1);
  const multStr = '(' + mult.join(',') + ')';
  const knotStr = '(' + knot.map(fmt).join(',') + ')';
  return { multStr, knotStr };
}

/* ────────────────────────────────────────────────────────────────────
 * Private — linear algebra
 * ──────────────────────────────────────────────────────────────────── */

/** Build the (M × N) basis matrix at parameters `params`. Flat row-major. */
function buildBasisMatrix(params, deg, knots, N) {
  const M = params.length;
  const B = new Float64Array(M * N);
  for (let i = 0; i < M; i++) {
    const b = computeBasis(params[i], deg, knots);
    const start = b.span - deg;
    for (let k = 0; k <= deg; k++) {
      const j = start + k;
      if (j >= 0 && j < N) B[i * N + j] = b.values[k];
    }
  }
  return B;
}

/** Compute Bᵀ·B for a (M×N) row-major matrix. Returns N×N row-major. */
function matATA(B, M, N) {
  const C = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      let s = 0;
      for (let k = 0; k < M; k++) s += B[k * N + i] * B[k * N + j];
      C[i * N + j] = s;
      C[j * N + i] = s;
    }
  }
  return C;
}

/** Solve A·X = B (N×N × N×K = N×K) via Gauss-Jordan with partial pivot.
 *  Modifies `A` in place. Returns the solution as a fresh flat Float64Array. */
function solveSystem(A, B, N, K) {
  // Augment B as a working copy so the caller-supplied buffer survives.
  const X = new Float64Array(B);
  for (let i = 0; i < N; i++) {
    // Partial pivot.
    let pivotRow = i;
    let pivotMag = Math.abs(A[i * N + i]);
    for (let r = i + 1; r < N; r++) {
      const m = Math.abs(A[r * N + i]);
      if (m > pivotMag) { pivotMag = m; pivotRow = r; }
    }
    if (pivotMag < 1e-12) return null;  // singular
    if (pivotRow !== i) {
      // Swap rows in A.
      for (let c = i; c < N; c++) {
        const t = A[i * N + c]; A[i * N + c] = A[pivotRow * N + c]; A[pivotRow * N + c] = t;
      }
      for (let c = 0; c < K; c++) {
        const t = X[i * K + c]; X[i * K + c] = X[pivotRow * K + c]; X[pivotRow * K + c] = t;
      }
    }
    // Normalise pivot row.
    const inv = 1 / A[i * N + i];
    for (let c = i; c < N; c++) A[i * N + c] *= inv;
    for (let c = 0; c < K; c++) X[i * K + c] *= inv;
    // Eliminate other rows.
    for (let r = 0; r < N; r++) {
      if (r === i) continue;
      const f = A[r * N + i];
      if (f === 0) continue;
      for (let c = i; c < N; c++) A[r * N + c] -= f * A[i * N + c];
      for (let c = 0; c < K; c++) X[r * K + c] -= f * X[i * K + c];
    }
  }
  return X;
}

function cloneMatrix(A, N) {
  return new Float64Array(A);
}

/* ────────────────────────────────────────────────────────────────────
 * Private — Cox-de Boor basis (inlined copy)
 * ──────────────────────────────────────────────────────────────────── */

/** Local copy of the basis evaluator used by stp-tessellate.js — kept
 *  here so this module's only sibling import is reachableEntities. */
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
 * Private — number formatting (STEP-compatible)
 * ──────────────────────────────────────────────────────────────────── */

function fmt(n) {
  if (!Number.isFinite(n)) return '0.';
  if (n === 0)             return '0.';
  let s = n.toPrecision(9);
  if (/[eE]/.test(s)) {
    s = s.replace(/[eE]([+-]?)0*(\d+)/, (_, sign, digits) => `E${sign}${digits}`);
    return s;
  }
  if (s.includes('.')) {
    s = s.replace(/(\.\d*?)0+$/, '$1');
    if (s.endsWith('.')) return s;
    return s;
  }
  return s + '.';
}
