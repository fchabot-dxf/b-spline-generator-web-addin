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
 * Enumerate every B-spline surface (plain or rational) reachable from
 * the given body root. Used by the UI to populate the regrid panel's
 * "Surface" dropdown so the user can target one surface at a time.
 *
 * @returns {Array<{id:number, nu:number|null, nv:number|null, rational:boolean}>}
 *   one entry per surface, sorted by entity id.
 */
export function listBSplineSurfaces(parsed, bodyId) {
  if (!parsed || !parsed.entities) return [];
  const out = [];
  for (const id of reachableEntities(parsed, bodyId)) {
    const e = parsed.entities.get(id);
    if (!e || !isBSplineSurfaceEntity(e)) continue;
    const surf = parseBSplineSurface(parsed, e);
    out.push({
      id,
      nu: surf ? surf.nu : null,
      nv: surf ? surf.nv : null,
      rational: !!(surf && surf.rational),
    });
  }
  return out.sort((a, b) => a.id - b.id);
}


/**
 * Regrid B-spline surfaces in `bodyId`'s sub-graph to a uniform
 * `targetNu × targetNv` CP grid.
 *
 * @param {import('./stp-parser.js').ParsedStep} parsed
 * @param {number} bodyId
 * @param {object} [opts]
 * @param {number} [opts.targetNu=8]    target CPs in U
 * @param {number} [opts.targetNv=8]    target CPs in V
 * @param {number} [opts.sampleRes=32]  sampleRes × sampleRes evaluation grid
 * @param {number|null} [opts.targetSurfaceId=null]
 *        Restrict the operation to a single surface (entity id of the
 *        B_SPLINE_SURFACE_WITH_KNOTS or compound RATIONAL_B_SPLINE_SURFACE).
 *        When null/undefined, all B-spline surfaces reachable from the
 *        body are regridded (legacy behaviour).
 * @param {'uniform'|'chord'|'centripetal'|'periodic'} [opts.knotMode='uniform']
 *        How to parameterize the sample points and build the new knot
 *        vector. 'uniform' (default) is clamped uniform; 'chord' /
 *        'centripetal' use sample-spacing-aware parameterisation
 *        (better for non-uniform source shapes); 'periodic' emits a
 *        non-clamped uniform knot vector for closed surfaces.
 * @returns {{ surfaces:number, skipped:number, newPoints:number }}
 */
export function regridBody(parsed, bodyId, opts = {}) {
  const targetNu        = Math.max(2, opts.targetNu  | 0 || 8);
  const targetNv        = Math.max(2, opts.targetNv  | 0 || 8);
  const sampleRes       = Math.max(targetNu + 4, Math.max(targetNv + 4, opts.sampleRes | 0 || 32));
  const targetSurfaceId = opts.targetSurfaceId ?? null;
  const knotMode        = opts.knotMode || 'uniform';

  // Pre-validate the knot mode so a typo gets caught at the top.
  if (!['uniform', 'chord', 'centripetal', 'periodic'].includes(knotMode)) {
    return { surfaces: 0, skipped: 0, newPoints: 0, error: `unknown knotMode ${knotMode}` };
  }

  // ID allocation for new CARTESIAN_POINTs.
  let nextId = 0;
  for (const id of parsed.entities.keys()) if (id > nextId) nextId = id;
  nextId += 1;

  let surfaces = 0, skipped = 0, newPoints = 0;

  // Pick the candidate entity set: a single target id, or every
  // surface reachable from the body root.
  const candidates = targetSurfaceId != null
    ? [targetSurfaceId]
    : [...reachableEntities(parsed, bodyId)];

  for (const id of candidates) {
    const e = parsed.entities.get(id);
    if (!e) continue;
    if (!isBSplineSurfaceEntity(e)) continue;

    const surf = parseBSplineSurface(parsed, e);
    if (!surf) { skipped++; continue; }

    if (targetNu <= surf.degU || targetNv <= surf.degV) { skipped++; continue; }

    const newCps = fitTensorBSpline(surf, targetNu, targetNv, sampleRes, knotMode);
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

    // Build the new arg strings.
    const cpGridArg = '(' + newIds.map(row =>
      '(' + row.map(id => `#${id}`).join(',') + ')'
    ).join(',') + ')';
    const { multStr: multU, knotStr: knotU } = knotStringsFor(knotMode, targetNu, surf.degU);
    const { multStr: multV, knotStr: knotV } = knotStringsFor(knotMode, targetNv, surf.degV);

    // Rewrite into either the simple or compound entity form so the
    // emitted file matches the source's surface kind.
    rewriteSurfaceEntity(e, surf, cpGridArg, multU, multV, knotU, knotV, targetNu, targetNv);

    surfaces++;
  }

  return { surfaces, skipped, newPoints };
}

/* ────────────────────────────────────────────────────────────────────
 * Private — entity recognition + rewriting
 *
 * Both forms of B-spline surface are recognised:
 *   - Simple:   #N=B_SPLINE_SURFACE_WITH_KNOTS(...)
 *   - Compound: #N=(B_SPLINE_SURFACE(...) B_SPLINE_SURFACE_WITH_KNOTS(...)
 *                   RATIONAL_B_SPLINE_SURFACE(...) ...)
 *
 * After regrid, the entity is rewritten in place so its outer shape
 * (simple vs compound, rational vs not) is preserved. Rational
 * surfaces keep their compound structure but their weights are set
 * to 1 — least-squares fitting on a uniform basis doesn't naturally
 * produce weights, and treating w=1 across the new grid is the
 * standard NURBS-to-B-spline conversion convention.
 * ──────────────────────────────────────────────────────────────────── */

function isBSplineSurfaceEntity(e) {
  if (e.type === 'B_SPLINE_SURFACE_WITH_KNOTS') return true;
  if (e.compound && e.compound.length) {
    for (const p of e.compound) if (p.type === 'B_SPLINE_SURFACE_WITH_KNOTS') return true;
  }
  return false;
}

function rewriteSurfaceEntity(entity, surf, cpGridArg, multU, multV, knotU, knotV, nu, nv) {
  if (entity.type === 'B_SPLINE_SURFACE_WITH_KNOTS') {
    // Simple form: rewrite args[3] (CP grid), args[8..11] (knot info).
    entity.args[3]  = cpGridArg;
    entity.args[8]  = multU;
    entity.args[9]  = multV;
    entity.args[10] = knotU;
    entity.args[11] = knotV;
    return;
  }
  // Compound form: rewrite the matching inner part's args.
  for (const part of entity.compound) {
    if (part.type === 'B_SPLINE_SURFACE') {
      // args: [degU, degV, cpGrid, surfaceForm, uClosed, vClosed, selfIntersect]
      part.args[2] = cpGridArg;
    } else if (part.type === 'B_SPLINE_SURFACE_WITH_KNOTS') {
      // args: [uMults, vMults, uKnots, vKnots, knotSpec]
      part.args[0] = multU;
      part.args[1] = multV;
      part.args[2] = knotU;
      part.args[3] = knotV;
    } else if (part.type === 'RATIONAL_B_SPLINE_SURFACE') {
      // Reset weights to 1.0 over the new (nu × nv) grid.
      const rows = [];
      for (let i = 0; i < nu; i++) {
        const row = [];
        for (let j = 0; j < nv; j++) row.push('1.');
        rows.push('(' + row.join(',') + ')');
      }
      part.args[0] = '(' + rows.join(',') + ')';
    }
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Private — fitting
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Fit a `Nu × Nv` B-spline surface to a sampled version of `surf` by
 * tensor-product least squares.  Returns a flat Float64Array (length
 * Nu*Nv*3) of new control point coordinates.
 *
 * @param {object} surf            output of parseBSplineSurface()
 * @param {number} Nu, Nv          target CP grid dimensions
 * @param {number} sampleRes       Nrows = Ncols of source samples
 * @param {string} knotMode        'uniform' | 'chord' | 'centripetal' | 'periodic'
 */
function fitTensorBSpline(surf, Nu, Nv, sampleRes, knotMode) {
  const { degU, degV } = surf;

  // 1. Sample the source surface at sampleRes × sampleRes points,
  //    walking uniform positions across its native parametric domain.
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

  // 2. Target knot vectors. 'periodic' switches to unclamped uniform;
  //    everything else stays clamped uniform.  Sample-aware knot
  //    vectors (de Boor averaging from chord params) would tighten the
  //    fit a few percent on highly non-uniform surfaces but cost more
  //    code than the gain is worth on the canoe-class fixtures we're
  //    targeting — uniform clamped + chord-length sample params is
  //    the documented "good enough" compromise (Piegl/Tiller §9.4.4).
  const knotsU = (knotMode === 'periodic') ? periodicKnotVector(Nu, degU) : uniformKnotVector(Nu, degU);
  const knotsV = (knotMode === 'periodic') ? periodicKnotVector(Nv, degV) : uniformKnotVector(Nv, degV);

  // 3. Sample parameter values. 'uniform'/'periodic' use evenly spaced
  //    params; 'chord' and 'centripetal' derive params from the actual
  //    sample spacing along a representative row/column of the source.
  const paramU = computeSampleParams(S, sampleRes, /*axis=*/ 0, knotMode);
  const paramV = computeSampleParams(S, sampleRes, /*axis=*/ 1, knotMode);

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

/** Build a clamped uniform knot vector for `n` CPs at degree `deg`.
 *  Total length = n + deg + 1.  First and last `deg+1` knots are
 *  pinned to 0 / 1 so the surface passes through corner CPs. */
function uniformKnotVector(n, deg) {
  const interior = n - deg - 1;   // count of interior knots
  const total = n + deg + 1;
  const out = new Float64Array(total);
  for (let i = 0; i <= deg; i++) out[i] = 0;
  for (let i = 1; i <= interior; i++) out[deg + i] = i / (interior + 1);
  for (let i = 0; i <= deg; i++) out[n + i] = 1;
  return out;
}

/** Build an unclamped uniform knot vector — every knot evenly spaced,
 *  no endpoint clamping.  Used for closed/periodic surfaces.  Knot
 *  values run from -deg/(n-deg) to (n)/(n-deg) so the active range
 *  [knots[deg], knots[n]] still maps to [0, 1]. */
function periodicKnotVector(n, deg) {
  const total = n + deg + 1;
  const out = new Float64Array(total);
  const step = 1 / (n - deg);
  for (let i = 0; i < total; i++) out[i] = (i - deg) * step;
  return out;
}

/** STEP-syntax strings for a uniform clamped knot vector at degree
 *  `deg` with `n` CPs. */
function uniformKnotStrings(n, deg) {
  const distinct = n - deg + 1;
  const mult = new Array(distinct);
  const knot = new Array(distinct);
  mult[0] = deg + 1;
  mult[distinct - 1] = deg + 1;
  for (let i = 1; i < distinct - 1; i++) mult[i] = 1;
  for (let i = 0; i < distinct; i++) knot[i] = i / (distinct - 1);
  return {
    multStr: '(' + mult.join(',') + ')',
    knotStr: '(' + knot.map(fmt).join(',') + ')',
  };
}

/** STEP-syntax strings for an unclamped (periodic) uniform knot vector.
 *  Multiplicities are all 1, knot values evenly spaced and matching
 *  what periodicKnotVector() emits.  Total knot count = n + deg + 1. */
function periodicKnotStrings(n, deg) {
  const total = n + deg + 1;
  const step = 1 / (n - deg);
  const mults = new Array(total).fill(1);
  const knots = new Array(total);
  for (let i = 0; i < total; i++) knots[i] = (i - deg) * step;
  return {
    multStr: '(' + mults.join(',') + ')',
    knotStr: '(' + knots.map(fmt).join(',') + ')',
  };
}

/** Dispatch from a knot-mode label to the right knot-string emitter. */
function knotStringsFor(mode, n, deg) {
  return (mode === 'periodic') ? periodicKnotStrings(n, deg) : uniformKnotStrings(n, deg);
}

/**
 * Compute sample parameter values for the least-squares fit.
 *
 * 'uniform' / 'periodic': evenly spaced in [0, 1].
 * 'chord' / 'centripetal': cumulative chord lengths (raw or sqrt'd)
 * along a representative row (axis=0 → row j=0, varying i) or
 * column (axis=1 → column i=0, varying j).  Normalised to [0, 1].
 */
function computeSampleParams(S, sampleRes, axis, mode) {
  const params = new Float64Array(sampleRes);
  params[0] = 0;
  if (mode === 'uniform' || mode === 'periodic') {
    for (let i = 1; i < sampleRes; i++) params[i] = i / (sampleRes - 1);
    return params;
  }
  const expon = (mode === 'centripetal') ? 0.5 : 1.0;
  const dists = new Float64Array(sampleRes);
  for (let i = 1; i < sampleRes; i++) {
    let pPrev, pCurr;
    if (axis === 0) {
      // Vary i, fix j=0 (top edge in V).
      pPrev = ((i - 1) * sampleRes + 0) * 3;
      pCurr = (i        * sampleRes + 0) * 3;
    } else {
      // Vary j, fix i=0 (left edge in U).
      pPrev = (0 * sampleRes + (i - 1)) * 3;
      pCurr = (0 * sampleRes + i      ) * 3;
    }
    const dx = S[pCurr]     - S[pPrev];
    const dy = S[pCurr + 1] - S[pPrev + 1];
    const dz = S[pCurr + 2] - S[pPrev + 2];
    const d  = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dists[i] = Math.pow(d, expon);
  }
  let total = 0;
  for (let i = 1; i < sampleRes; i++) {
    total += dists[i];
    params[i] = total;
  }
  if (total > 0) {
    for (let i = 1; i < sampleRes; i++) params[i] /= total;
  } else {
    // Degenerate (all samples identical): fall back to uniform.
    for (let i = 1; i < sampleRes; i++) params[i] = i / (sampleRes - 1);
  }
  params[sampleRes - 1] = 1;  // pin to defeat float drift
  return params;
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
