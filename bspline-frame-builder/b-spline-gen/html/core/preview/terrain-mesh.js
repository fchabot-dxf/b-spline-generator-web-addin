/**
 * Terrain mesh builders — pure functions that produce THREE objects (or
 * raw vertex arrays) from a height grid.
 *
 *   buildHeightField        → flat-array description of the top surface
 *   buildLiveBrushColours   → soft brush highlight overlaid on vertex colours
 *   buildTopOnlyMesh        → THREE.Mesh of just the top surface
 *   buildSolidMesh          → THREE.Mesh of top + bottom + side walls
 *   buildSolidWireframe     → THREE.Line[] of B-spline iso lines on a solid
 *   buildIsoCurves          → THREE.Group of the top surface's iso curves
 *   extractSolidExportArrays → { verts, indices } in the requested orientation
 *                              for Fusion CustomGraphics export
 *
 * All functions are stateless. The caller (TerrainPreview) is responsible
 * for adding/removing the returned objects from its scene and disposing
 * geometries / materials.
 */

import { clampedKnots, evalBSplineSurface } from '../bspline-math.js';
import { COORD_SYSTEM } from '../coords.js';
import { dbg } from '../debug.js';

const safeNum = v => Number.isFinite(v) ? v : 0;

/** Flat-array description of the height grid's top surface. */
export function buildHeightField(heights, nx, nz, W, H) {
  const count = nx * nz;
  const pos = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const indices = [];
  let minZ = Infinity, maxZ = -Infinity;

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i;
      const u = i / Math.max(1, nx - 1);
      const v = j / Math.max(1, nz - 1);
      const x = -W / 2 + u * W;
      const y = -H / 2 + v * H;
      let z = heights[idx];
      if (isNaN(z)) z = 0;

      pos[idx * 3 + 0] = isNaN(x) ? 0 : x;
      pos[idx * 3 + 1] = isNaN(y) ? 0 : y;
      pos[idx * 3 + 2] = z;
      uvs[idx * 2 + 0] = isNaN(u) ? 0 : u;
      uvs[idx * 2 + 1] = isNaN(v) ? 0 : v;

      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = (j + 1) * nx + i, d = c + 1;
      indices.push(a, b, c, c, b, d);
    }
  }

  return { pos, uvs, indices, minZ, maxZ };
}

/**
 * Soft falloff highlight under the sculpt brush, blended on top of the
 * existing vertex colours. Returns null when no sculpt is active.
 */
export function buildLiveBrushColours(meshColours, sculpt, nx, nz) {
  if (!sculpt || sculpt.ci === undefined || sculpt.cj === undefined || !sculpt.radiusIn) return null;

  const count = nx * nz;
  const out = meshColours ? meshColours.slice() : new Float32Array(count * 3);
  const dx = sculpt.widthIn  / (sculpt.nx - 1);
  const dy = sculpt.heightIn / (sculpt.nz - 1);
  const r  = sculpt.radiusIn;
  const cx = -sculpt.widthIn  / 2 + sculpt.ci * dx;
  const cy =  sculpt.heightIn / 2 - sculpt.cj * dy;

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i;
      const x = -sculpt.widthIn  / 2 + i * dx;
      const y =  sculpt.heightIn / 2 - j * dy;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > r) continue;

      const t = dist / r;
      const falloff = 1 - (t * t * (3 - 2 * t));
      const base0 = meshColours ? meshColours[idx * 3 + 0] : 0;
      const base1 = meshColours ? meshColours[idx * 3 + 1] : 0;
      const base2 = meshColours ? meshColours[idx * 3 + 2] : 0;
      out[idx * 3 + 0] = base0 * (1 - falloff) + 0.6 * falloff;
      out[idx * 3 + 1] = base1 * (1 - falloff) + 1.0 * falloff;
      out[idx * 3 + 2] = base2 * (1 - falloff) + 0.6 * falloff;
    }
  }
  return out;
}

/** THREE.Mesh of just the top surface (no bottom, no side walls). */
export function buildTopOnlyMesh(THREE, field, colours, { isWireframeMode, flatShading }) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(field.pos, 3));
  geometry.setAttribute('uv',       new THREE.BufferAttribute(field.uvs, 2));
  geometry.setIndex(field.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  if (colours) geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));

  const useColours = !!colours;
  const mat = new THREE.MeshPhongMaterial({
    color:        useColours ? 0xffffff : 0xd4b896,
    vertexColors: useColours,
    specular:     0x222222,
    shininess:    60,
    side:         THREE.DoubleSide,
    flatShading,
    transparent:  isWireframeMode,
    opacity:      isWireframeMode ? 0.35 : 1.0,
  });
  return new THREE.Mesh(geometry, mat);
}

/**
 * THREE.Mesh of a watertight thickened solid: top + bottom + side walls.
 * Vertices are arranged as: [Top (count), Bottom (count), SideTop (B), SideBot (B)],
 * with side-wall verts duplicated so normals at corners stay sharp.
 */
export function buildSolidMesh(THREE, topPos, offsetPts, nx, nz, opts) {
  const { topColours, botColours, flatShading } = opts || {};
  const count = nx * nz;
  const boundaryIndices = COORD_SYSTEM.gridBoundaryIndices(nx, nz);
  const B = boundaryIndices.length;

  const totalVerts = count * 2 + B * 2;
  const pos = new Float32Array(totalVerts * 3);
  const col = new Float32Array(totalVerts * 3);
  const useColours = !!(topColours && topColours.length === count * 3);

  // Top + bottom positions.
  for (let i = 0; i < count * 3; i++) {
    pos[i] = safeNum(topPos[i]);
    pos[count * 3 + i] = safeNum(offsetPts[i]);
  }

  // Top + bottom colours.
  if (useColours) {
    col.set(topColours, 0);
    if (botColours && botColours.length === count * 3) col.set(botColours, count * 3);
    else col.set(topColours, count * 3);
  } else {
    col.fill(1.0);
  }

  // Side walls (duplicated boundary vertices).
  const SIDE_START = count * 2;
  const baseBot = count * 3;
  for (let i = 0; i < B; i++) {
    const idx = boundaryIndices[i];

    pos[(SIDE_START + i) * 3 + 0]     = safeNum(topPos[idx * 3 + 0]);
    pos[(SIDE_START + i) * 3 + 1]     = safeNum(topPos[idx * 3 + 1]);
    pos[(SIDE_START + i) * 3 + 2]     = safeNum(topPos[idx * 3 + 2]);
    pos[(SIDE_START + B + i) * 3 + 0] = safeNum(offsetPts[idx * 3 + 0]);
    pos[(SIDE_START + B + i) * 3 + 1] = safeNum(offsetPts[idx * 3 + 1]);
    pos[(SIDE_START + B + i) * 3 + 2] = safeNum(offsetPts[idx * 3 + 2]);

    if (useColours) {
      col[(SIDE_START + i) * 3 + 0]     = col[idx * 3 + 0];
      col[(SIDE_START + i) * 3 + 1]     = col[idx * 3 + 1];
      col[(SIDE_START + i) * 3 + 2]     = col[idx * 3 + 2];
      col[(SIDE_START + B + i) * 3 + 0] = col[baseBot + idx * 3 + 0];
      col[(SIDE_START + B + i) * 3 + 1] = col[baseBot + idx * 3 + 1];
      col[(SIDE_START + B + i) * 3 + 2] = col[baseBot + idx * 3 + 2];
    } else {
      const grey = 0.55;
      col[(SIDE_START + i) * 3 + 0]     = grey;
      col[(SIDE_START + i) * 3 + 1]     = grey;
      col[(SIDE_START + i) * 3 + 2]     = grey;
      col[(SIDE_START + B + i) * 3 + 0] = grey;
      col[(SIDE_START + B + i) * 3 + 1] = grey;
      col[(SIDE_START + B + i) * 3 + 2] = grey;
    }
  }

  // NaN/Inf guard so Raycaster + boundingSphere don't poison the scene.
  let badCount = 0;
  for (let i = 0, L = pos.length; i < L; i++) {
    if (!Number.isFinite(pos[i])) { pos[i] = 0; badCount++; }
  }
  if (badCount > 0) console.warn(`[WARN] buildSolidMesh corrected ${badCount} invalid position values (NaN/Inf)`);

  const indices = solidIndices(nx, nz, B, SIDE_START);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (useColours) geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mat = new THREE.MeshPhongMaterial({
    color:        useColours ? 0xffffff : 0xd4b896,
    vertexColors: useColours,
    specular:     0x111111,
    shininess:    30,
    side:         THREE.FrontSide,
    flatShading,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  dbg('VertexColor', 'buildSolidMesh: useColours', useColours);

  return new THREE.Mesh(geometry, mat);
}

/**
 * Top-cap + bottom-cap + side-wall index buffer for a solid laid out as
 * [Top (count), Bottom (count), SideTop (B), SideBot (B)].
 */
function solidIndices(nx, nz, B, sideStart) {
  let indices = COORD_SYSTEM.gridQuadFaceIndices(nx, nz, 0, false);
  indices = indices.concat(COORD_SYSTEM.gridQuadFaceIndices(nx, nz, nx * nz, true));
  for (let i = 0; i < B; i++) {
    const next = (i + 1) % B;
    const t1 = sideStart + i;
    const t2 = sideStart + next;
    const b1 = sideStart + B + i;
    const b2 = sideStart + B + next;
    indices.push(t1, b1, t2, t2, b1, b2);
  }
  return indices;
}

/**
 * THREE.Line[] approximating the bottom (offset) surface and 4 wall seams
 * with their actual B-spline isoparameter curves. Caller adds them to the
 * scene and is responsible for disposal.
 */
export function buildSolidWireframe(THREE, topPos, offsetPts, nx, nz) {
  const count = nx * nz;
  if (!offsetPts || !topPos || offsetPts.length < count * 3 || topPos.length < count * 3) return [];

  const wireMat   = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 1.0, depthTest: false, depthWrite: false, linewidth: 2 });
  const pillarMat = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 1.0, depthTest: false, depthWrite: false, linewidth: 2 });

  const ukn = clampedKnots(nx, 3);
  const vkn = clampedKnots(nz, 3);

  const buildCtrl = (flatPts) => {
    const c = [];
    for (let i = 0; i < nx; i++) {
      c.push([]);
      for (let j = 0; j < nz; j++) {
        const idx = j * nx + i;
        c[i].push({ x: flatPts[idx * 3], y: flatPts[idx * 3 + 1], z: flatPts[idx * 3 + 2] });
      }
    }
    return c;
  };
  const topCtrl = buildCtrl(topPos);
  const botCtrl = buildCtrl(offsetPts);

  const lines = [];
  const addLine = (pts, mat) => {
    const sanitized = pts.map(p => new THREE.Vector3(safeNum(p.x), safeNum(p.y), safeNum(p.z)));
    const geo = new THREE.BufferGeometry().setFromPoints(sanitized);
    lines.push(new THREE.Line(geo, mat.clone()));
  };

  const NLINES_U = Math.min(nx, 22);
  const NLINES_V = Math.min(nz, 18);
  const STEPS    = 60;

  // Bottom surface iso-curves.
  for (let li = 0; li <= NLINES_U; li++) {
    const u = li / NLINES_U;
    const pts = [];
    for (let s = 0; s <= STEPS; s++) pts.push(evalBSplineSurface(botCtrl, nx, nz, ukn, vkn, u, s / STEPS));
    addLine(pts, wireMat);
  }
  for (let li = 0; li <= NLINES_V; li++) {
    const v = li / NLINES_V;
    const pts = [];
    for (let s = 0; s <= STEPS; s++) pts.push(evalBSplineSurface(botCtrl, nx, nz, ukn, vkn, s / STEPS, v));
    addLine(pts, wireMat);
  }

  // 4 wall seams: top edge + bottom edge + connecting pillars.
  const WALL_PILLARS = 12;
  const wallEdges = [
    { fixed: 'v', t: 0 },
    { fixed: 'v', t: 1 },
    { fixed: 'u', t: 0 },
    { fixed: 'u', t: 1 },
  ];
  for (const e of wallEdges) {
    const topEdge = [], botEdge = [];
    for (let s = 0; s <= WALL_PILLARS; s++) {
      const param = s / WALL_PILLARS;
      const uu = e.fixed === 'u' ? e.t : param;
      const vv = e.fixed === 'v' ? e.t : param;
      topEdge.push(evalBSplineSurface(topCtrl, nx, nz, ukn, vkn, uu, vv));
      botEdge.push(evalBSplineSurface(botCtrl, nx, nz, ukn, vkn, uu, vv));
    }
    addLine(topEdge, pillarMat);
    addLine(botEdge, pillarMat);
    for (let s = 0; s <= WALL_PILLARS; s++) addLine([topEdge[s], botEdge[s]], pillarMat);
  }
  return lines;
}

/**
 * THREE.Group of B-spline iso curves over the top surface. Skipped when
 * the grid is dense and the curves aren't currently visible.
 */
export function buildIsoCurves(THREE, heights, nx, nz, W, H, curvesVisible) {
  const group = new THREE.Group();
  const count = nx * nz;
  const shouldDraw = curvesVisible || count < 1000;
  if (!shouldDraw) return group;

  const ukn = clampedKnots(nx, 3);
  const vkn = clampedKnots(nz, 3);
  const ctrl = [];
  for (let i = 0; i < nx; i++) {
    ctrl.push([]);
    for (let j = 0; j < nz; j++) {
      ctrl[i].push({
        x: -W / 2 + i * W / (nx - 1),
        y: -H / 2 + j * H / (nz - 1),
        z: heights[j * nx + i],
      });
    }
  }

  const skipU = nx > 100 ? 4 : (nx > 60 ? 2 : 1);
  const skipV = nz > 100 ? 4 : (nz > 60 ? 2 : 1);
  const steps = count > 5000 ? 20 : 40;
  const mat   = new THREE.LineBasicMaterial({ color: 0x5577aa, transparent: true, opacity: 0.6 });

  for (let i = 0; i < nx; i += skipU) {
    const u = i / (nx - 1);
    const pts = [];
    for (let j = 0; j <= steps; j++) {
      const v = j / steps;
      const p = evalBSplineSurface(ctrl, nx, nz, ukn.full, vkn.full, u, v);
      pts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
  for (let i = 0; i < nz; i += skipV) {
    const v = i / (nz - 1);
    const pts = [];
    for (let j = 0; j <= steps; j++) {
      const u = j / steps;
      const p = evalBSplineSurface(ctrl, nx, nz, ukn.full, vkn.full, u, v);
      pts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
  return group;
}

/**
 * Pull verts + indices out of a top-only mesh and (optionally) extend with
 * bottom + side-wall geometry, for export to Fusion CustomGraphics. Verts
 * are converted to cm and oriented per `orientation`.
 *
 * Uses 4 explicit edge loops for the side walls (sharing corner vertices
 * across edges); CustomGraphics doesn't need sharp normals at corners.
 */
export function extractSolidExportArrays(mesh, offsetPts, nx, nz, orientation) {
  if (!mesh || !mesh.geometry) return null;
  const geom = mesh.geometry;
  const posAttribute = geom.getAttribute('position');
  const idxAttribute = geom.getIndex();
  if (!posAttribute || !idxAttribute) return null;

  const rawPos = posAttribute.array;
  const count  = rawPos.length;          // nx * nz * 3
  const N      = count / 3;              // top-layer vertex count

  const transform = (src, out, offset = 0) => {
    for (let i = 0; i < src.length; i += 3) {
      const [tx, ty, tz] = COORD_SYSTEM.transformPoint(src[i], src[i + 1], src[i + 2], orientation);
      out[offset + i]     = tx * 2.54;
      out[offset + i + 1] = ty * 2.54;
      out[offset + i + 2] = tz * 2.54;
    }
  };

  const hasSolid   = !!(offsetPts && offsetPts.length === count);
  const totalVerts = hasSolid ? count * 2 : count;
  const verts = new Float32Array(totalVerts);
  transform(rawPos, verts, 0);

  const topIdx = idxAttribute.array;
  const finalIndices = [];
  for (let i = 0; i < topIdx.length; i += 3) {
    finalIndices.push(topIdx[i], topIdx[i + 1], topIdx[i + 2]);
  }

  if (hasSolid) {
    transform(offsetPts, verts, count);

    // Bottom faces (CW).
    for (let i = 0; i < topIdx.length; i += 3) {
      finalIndices.push(topIdx[i] + N, topIdx[i + 2] + N, topIdx[i + 1] + N);
    }

    // Side walls: 4 explicit edge loops sharing corner verts.
    for (let i = 0; i < nx - 1; i++) {
      const t1 = i, t2 = i + 1;
      const b1 = N + i, b2 = N + i + 1;
      finalIndices.push(t1, b1, t2, t2, b1, b2);
    }
    for (let i = 0; i < nx - 1; i++) {
      const t1 = (nz - 1) * nx + i, t2 = t1 + 1;
      const b1 = N + t1, b2 = N + t2;
      finalIndices.push(t1, t2, b1, t2, b2, b1);
    }
    for (let j = 0; j < nz - 1; j++) {
      const t1 = j * nx, t2 = (j + 1) * nx;
      const b1 = N + t1, b2 = N + t2;
      finalIndices.push(t1, b1, t2, t2, b1, b2);
    }
    for (let j = 0; j < nz - 1; j++) {
      const t1 = j * nx + (nx - 1), t2 = (j + 1) * nx + (nx - 1);
      const b1 = N + t1, b2 = N + t2;
      finalIndices.push(t1, t2, b1, t2, b2, b1);
    }
  }

  return { verts: Array.from(verts), indices: finalIndices };
}
