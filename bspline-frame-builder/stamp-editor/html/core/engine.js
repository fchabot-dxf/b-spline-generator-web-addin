/**
 * engine.js — Stamp Editor's stamp pipeline (multi-layer).
 *
 * Inputs:
 *   grids   — { faceIndex, positions(mm), normals, nx, nz }[]
 *             (one per captured face, pushed by Python after capture)
 *   layers  — stamp layer documents (see html/main/layers.js):
 *             { id, name, enabled, svg, profile:{kind,depth,vbitAngle},
 *               fillet, blur, raise }
 *
 * Output:
 *   { positions: Float32Array,
 *     indices:   Uint32Array,
 *     normals:   Float32Array,
 *     stats:     { faceCount, nonZeroPx, totalPx } }
 *
 * Pipeline per face:
 *   1. Compute the face's mm extent from the grid corner positions.
 *   2. Allocate one displacement scratch buffer of size nx*nz, zeroed.
 *   3. For each enabled layer with a non-empty SVG, rasterize with the
 *      layer's blur/depth/profile, multiply masks by the layer's signed
 *      amplitude (+ for raised, − for carved) and accumulate into the
 *      scratch buffer. Layers stack additively.
 *   4. Walk the grid: position += normal * scratch[k].
 *   5. Triangulate the grid into 2 tris per (nx-1)×(nz-1) cell.
 *   6. Recompute per-vertex normals so lighting reads the carve.
 */

'use strict';

import { rasterizeSvg } from './stamp/index.js';
import { pyLog } from './runtime.js';

const MM_PER_INCH = 25.4;

function eLog(msg) { pyLog(`[engine] ${msg}`); }

export async function buildStampMesh(grids, layers) {
  const positions = [];
  const indices   = [];
  const stats     = { faceCount: 0, nonZeroPx: 0, totalPx: 0 };
  // Captured per-face deformed control-grids — the Send to Fusion path
  // ships this back to Python so it can fit a NURBS surface per face.
  const perFace   = [];

  const usableLayers = (layers || []).filter(
    l => l && l.enabled && l.svg && l.svg.trim().length > 0
  );
  eLog(`buildStampMesh: ${grids?.length || 0} grid(s), ${usableLayers.length} layer(s)`);

  for (const grid of grids || []) {
    if (!grid || !grid.positions || !grid.normals) {
      eLog(`  skip — empty/missing grid`);
      continue;
    }
    const sub = await modulateOneGrid(grid, usableLayers);
    if (!sub) {
      eLog(`  modulate returned null for face ${grid.faceIndex}`);
      continue;
    }
    const baseVert = positions.length / 3;
    for (let i = 0; i < sub.positions.length; i++) positions.push(sub.positions[i]);
    for (let i = 0; i < sub.indices.length; i++)   indices.push(sub.indices[i] + baseVert);
    stats.faceCount++;
    stats.nonZeroPx += sub.nonZeroPx || 0;
    stats.totalPx   += sub.totalPx   || 0;

    // Keep the per-face deformed grid around for the commit path.
    perFace.push({
      faceIndex: grid.faceIndex,
      nx:        grid.nx,
      nz:        grid.nz,
      positions: sub.positions,    // mm
    });
  }

  if (!positions.length) return { positions: null, indices: null, normals: null, stats, perFace: [] };

  const out = {
    positions: new Float32Array(positions),
    indices:   new Uint32Array(indices),
    normals:   new Float32Array(positions.length),
    stats,
    perFace,
  };
  recomputeNormals(out);
  return out;
}

/* ────────────────────────────────────────────────────────────────────
 * Per-grid modulation — accumulates all layers' displacements.
 * ──────────────────────────────────────────────────────────────────── */

async function modulateOneGrid(grid, layers) {
  const { positions: gp, normals: gn, nx, nz } = grid;
  if (nx < 2 || nz < 2) return null;

  const ix0 = 0, ix1 = (nx - 1) * 3;
  const iy0 = 0, iy1 = (nz - 1) * nx * 3;
  const dxW = gp[ix1]     - gp[ix0];
  const dyW = gp[ix1 + 1] - gp[ix0 + 1];
  const dzW = gp[ix1 + 2] - gp[ix0 + 2];
  const dxH = gp[iy1]     - gp[iy0];
  const dyH = gp[iy1 + 1] - gp[iy0 + 1];
  const dzH = gp[iy1 + 2] - gp[iy0 + 2];
  const widthMm  = Math.hypot(dxW, dyW, dzW);
  const heightMm = Math.hypot(dxH, dyH, dzH);
  if (!(widthMm > 0) || !(heightMm > 0)) {
    eLog(`  face ${grid.faceIndex}: degenerate extents w=${widthMm} h=${heightMm}`);
    return null;
  }
  eLog(`  face ${grid.faceIndex}: ${nx}×${nz} grid, ${widthMm.toFixed(1)}×${heightMm.toFixed(1)} mm`);

  const N = nx * nz;
  const disp      = new Float32Array(N);
  let   nonZeroPx = 0;

  for (const layer of layers) {
    const depthMm = Math.max(0, Number(layer.profile?.depth) || 0);
    if (depthMm <= 0) continue;

    const kind      = layer.profile?.kind || 'vbit';
    const vbitAngle = Number(layer.profile?.vbitAngle) || 60;
    const filletMm  = Math.max(0, Number(layer.fillet) || 0);
    const blurMm    = Math.max(0, Number(layer.blur)   || 0);
    const carveDir  = layer.raise ? +1 : -1;
    const depthSign = carveDir * depthMm;
    const filletAmp = carveDir * Math.min(filletMm, depthMm);

    let mask;
    try {
      mask = await rasterizeSvg(
        layer.svg,
        nx, nz,
        blurMm   / MM_PER_INCH,
        widthMm  / MM_PER_INCH,
        heightMm / MM_PER_INCH,
        kind,
        depthMm  / MM_PER_INCH,
        vbitAngle,
        filletMm / MM_PER_INCH,
        2.2,
      );
    } catch (e) {
      eLog(`  face ${grid.faceIndex} layer "${layer.name}": rasterize threw ${e.message}`);
      continue;
    }
    if (!mask || !mask.body || mask.body.length !== N) {
      eLog(`  face ${grid.faceIndex} layer "${layer.name}": bad mask (len=${mask?.body?.length})`);
      continue;
    }
    let layerNz = 0, mx = 0;
    for (let k = 0; k < N; k++) {
      const b = mask.body[k]   || 0;
      const f = mask.fillet ? (mask.fillet[k] || 0) : 0;
      if (b > 0 || f > 0) layerNz++;
      if (b > mx) mx = b;
      disp[k] += b * depthSign + f * filletAmp;
    }
    nonZeroPx += layerNz;
    eLog(`    layer "${layer.name}" (${kind}, d=${depthMm}mm): ${layerNz}/${N} px, max=${mx.toFixed(3)}`);
  }

  const positions = new Float32Array(N * 3);
  const indices   = new Uint32Array((nx - 1) * (nz - 1) * 6);

  for (let k = 0; k < N; k++) {
    const o = k * 3;
    const d = disp[k];
    positions[o]     = gp[o]     + gn[o]     * d;
    positions[o + 1] = gp[o + 1] + gn[o + 1] * d;
    positions[o + 2] = gp[o + 2] + gn[o + 2] * d;
  }

  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      indices[p++] = a; indices[p++] = c; indices[p++] = b;
      indices[p++] = b; indices[p++] = c; indices[p++] = d;
    }
  }

  return { positions, indices, nonZeroPx, totalPx: N };
}

function recomputeNormals(mesh) {
  const { positions, indices } = mesh;
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t], ib = indices[t + 1], ic = indices[t + 2];
    const ax = positions[ia*3], ay = positions[ia*3+1], az = positions[ia*3+2];
    const bx = positions[ib*3], by = positions[ib*3+1], bz = positions[ib*3+2];
    const cx = positions[ic*3], cy = positions[ic*3+1], cz = positions[ic*3+2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normals[ia*3]   += nx; normals[ia*3+1] += ny; normals[ia*3+2] += nz;
    normals[ib*3]   += nx; normals[ib*3+1] += ny; normals[ib*3+2] += nz;
    normals[ic*3]   += nx; normals[ic*3+1] += ny; normals[ic*3+2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const m = Math.hypot(normals[i], normals[i+1], normals[i+2]);
    if (m > 1e-12) { normals[i] /= m; normals[i+1] /= m; normals[i+2] /= m; }
  }
  mesh.normals = normals;
}
