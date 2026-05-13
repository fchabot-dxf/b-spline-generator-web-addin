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
 * Parse a B_SPLINE_SURFACE_WITH_KNOTS entity into a structured record.
 *
 * @returns {{
 *   degU:number, degV:number,
 *   nu:number, nv:number,
 *   cps: Float64Array,    // flat (nu*nv*3) row-major: cps[(i*nv + j)*3 + k]
 *   knotsU: Float64Array, // expanded full knot vector for U
 *   knotsV: Float64Array, // expanded full knot vector for V
 * } | null}
 */
export function parseBSplineSurface(parsed, entity) {
  const args = entity.args;
  if (!args || args.length < 12) return null;

  // arg[1] = degU, arg[2] = degV
  const degU = Number(args[1]);
  const degV = Number(args[2]);
  if (!Number.isFinite(degU) || !Number.isFinite(degV)) return null;

  // arg[3] = 2D control point ref grid like "((#1,#2),(#3,#4))"
  const cpGrid = parseRefGrid2D(args[3]);
  if (!cpGrid || !cpGrid.length || !cpGrid[0].length) return null;
  const nu = cpGrid.length;
  const nv = cpGrid[0].length;

  // Resolve each ref to (x, y, z) by looking up the CARTESIAN_POINT.
  const cps = new Float64Array(nu * nv * 3);
  for (let i = 0; i < nu; i++) {
    if (!cpGrid[i] || cpGrid[i].length !== nv) return null; // ragged grid
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

  // arg[8] = U knot multiplicities, arg[9] = V knot multiplicities
  // arg[10] = U knots, arg[11] = V knots
  const multU  = parseNumberList(args[8]);
  const multV  = parseNumberList(args[9]);
  const knotsU = parseNumberList(args[10]);
  const knotsV = parseNumberList(args[11]);
  if (!multU || !multV || !knotsU || !knotsV) return null;
  if (multU.length !== knotsU.length || multV.length !== knotsV.length) return null;

  // Expand to full knot vector by repeating each knot value.
  const expandU = expandKnots(knotsU, multU);
  const expandV = expandKnots(knotsV, multV);

  // Sanity: full knot vector length must be n + degree + 1.
  if (expandU.length !== nu + degU + 1) return null;
  if (expandV.length !== nv + degV + 1) return null;

  return {
    degU, degV, nu, nv, cps,
    knotsU: new Float64Array(expandU),
    knotsV: new Float64Array(expandV),
  };
}

/**
 * Sample a B-spline surface on a regular UV grid and emit triangles.
 * Per-vertex normals are computed by averaging adjacent face normals.
 */
export function tessellateBSplineSurface(surf, resolution = DEFAULT_RES) {
  const { degU, degV, nu, nv, cps, knotsU, knotsV } = surf;
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
      for (let i = 0; i < nu; i++) {
        const bu = basisU.values[i - basisU.span + degU];
        if (!bu) continue;
        for (let j = 0; j < nv; j++) {
          const bv = basisV.values[j - basisV.span + degV];
          if (!bv) continue;
          const k = (i * nv + j) * 3;
          const w = bu * bv;
          x += w * cps[k];
          y += w * cps[k + 1];
          z += w * cps[k + 2];
        }
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
 * Private — B-spline basis evaluation (Cox-de Boor)
 * ──────────────────────────────────────────────────────────────────── */

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
