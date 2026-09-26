/**
 * frame-mesh.js — FB-APP S3 (F7), design §3.4: the 3D preview trims the
 * carved panel to the frame's cut profile and shows the frame bars in wood.
 *
 * ONE outline source: the spec is built by editor-frame-profile.js from the
 * generated frame definition (the same one the editor profile and the Fusion
 * build read). Everything here is plain geometry on flat arrays (testable
 * without WebGL); the THREE wrappers at the bottom only wrap those arrays.
 *
 * World mapping (MEASURED, drape-svg.js DRAPE_TEXTURE_FLIPY): editor/SVG
 * (x, y-down from the top) -> world (x - W/2, H/2 - y), z up.
 *
 * Trim: panel triangles whose centroid lies outside the outline are dropped
 * (index filter, geometry otherwise untouched; the drape overlay shares the
 * geometry so it is trimmed too), and a wall is built along the exact outline
 * from the underside to the top surface, hiding the <= one-cell jag.
 * Bars: the ring between the outline and the frame's inner edge, as a quad
 * strip between CORRESPONDING samples of the two (same primitive topology,
 * same fractions), extruded straight (no taper) from frame-bottom z up to the
 * panel underside. The corner correspondences are the miter lines.
 */

/** Sample a closed primitive loop (editor coords) at fixed fractions per
 *  primitive, so two loops of the same topology correspond point-for-point. */
export function sampleOutline(primitives, arcSteps = 12) {
  const pts = [];
  for (const p of primitives) {
    if (p.type === 'L') { pts.push({ x: p.p0.x, y: p.p0.y }); continue; }
    for (let k = 0; k < arcSteps; k++) {
      const th = p.theta1 + (p.dTheta * k) / arcSteps;
      pts.push({ x: p.cx + p.rx * Math.cos(th), y: p.cy + p.ry * Math.sin(th) });
    }
  }
  return pts;
}

export const toWorld = (pts, W, H) => pts.map((p) => ({ x: p.x - W / 2, y: H / 2 - p.y }));

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Keep only triangles whose (x, y) centroid is inside `poly` (world). */
export function trimIndices(index, positions, poly) {
  const out = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const cx = (positions[a] + positions[b] + positions[c]) / 3;
    const cy = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
    if (pointInPolygon(cx, cy, poly)) out.push(index[t], index[t + 1], index[t + 2]);
  }
  return out;
}

/** Bilinear z of a heightfield grid laid out as buildHeightField does:
 *  vertex (i, j) at x = -W/2 + i/(nx-1)*W, y = -H/2 + j/(nz-1)*H. */
export function sampleGridZ(pos, nx, nz, W, H, x, y) {
  const fi = Math.min(nx - 1, Math.max(0, ((x + W / 2) / W) * (nx - 1)));
  const fj = Math.min(nz - 1, Math.max(0, ((y + H / 2) / H) * (nz - 1)));
  const i0 = Math.min(nx - 2, Math.floor(fi)), j0 = Math.min(nz - 2, Math.floor(fj));
  const u = fi - i0, v = fj - j0;
  const z = (i, j) => pos[(j * nx + i) * 3 + 2];
  return (1 - u) * (1 - v) * z(i0, j0) + u * (1 - v) * z(i0 + 1, j0)
    + (1 - u) * v * z(i0, j0 + 1) + u * v * z(i0 + 1, j0 + 1);
}

/** A vertical strip along closed `poly` from zBot(p) to zTop(p). */
export function wallArrays(poly, zBot, zTop) {
  const n = poly.length, positions = [], index = [];
  poly.forEach((p) => { positions.push(p.x, p.y, zBot(p), p.x, p.y, zTop(p)); });
  for (let k = 0; k < n; k++) {
    const a = 2 * k, b = 2 * ((k + 1) % n);
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { positions, index };
}

/** The bar ring between corresponding `outer`/`inner` loops: top (at the
 *  underside), bottom (at zBottom), outer wall and inner wall. */
export function ringArrays(outer, inner, zBottom, zTop) {
  const n = outer.length;
  if (inner.length !== n) throw new Error(`ringArrays: loops do not correspond (${n} vs ${inner.length})`);
  const positions = [], index = [];
  const v = (p, z) => { positions.push(p.x, p.y, z); return positions.length / 3 - 1; };
  const oT = outer.map((p) => v(p, zTop(p))), iT = inner.map((p) => v(p, zTop(p)));
  const oB = outer.map((p) => v(p, zBottom)), iB = inner.map((p) => v(p, zBottom));
  for (let k = 0; k < n; k++) {
    const m = (k + 1) % n;
    index.push(oT[k], oT[m], iT[k], iT[k], oT[m], iT[m]); // top
    index.push(oB[k], iB[k], oB[m], iB[k], iB[m], oB[m]); // bottom
    index.push(oB[k], oB[m], oT[k], oT[k], oB[m], oT[m]); // outer wall
    index.push(iB[k], iT[k], iB[m], iT[k], iT[m], iB[m]); // inner wall
  }
  return { positions, index };
}

function _mesh(THREE, { positions, index }, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

/**
 * Apply `spec` (see editor-frame-profile.js frameSolidSpec) to a built panel
 * mesh: trim its index in place (from the untrimmed copy kept in userData)
 * and return the extra meshes (edge wall + bars) the caller adds to the scene.
 * `spec == null` restores the untrimmed panel and returns [].
 */
export function applyFrameToPanel(THREE, panelMesh, grid, spec) {
  const geom = panelMesh.geometry;
  if (!geom.userData.fullIndex && geom.index) geom.userData.fullIndex = Array.from(geom.index.array);
  const full = geom.userData.fullIndex;
  if (!full) return [];
  if (!spec) { geom.setIndex(full.slice()); return []; }
  const { W, H, nx, nz, topPos, botPos } = grid;
  const outer = toWorld(spec.outline, W, H);
  geom.setIndex(trimIndices(full, geom.attributes.position.array, outer));
  const extra = [];
  if (topPos && botPos) {
    const top = (p) => sampleGridZ(topPos, nx, nz, W, H, p.x, p.y);
    const bot = (p) => sampleGridZ(botPos, nx, nz, W, H, p.x, p.y);
    const wallMat = panelMesh.material.clone();
    wallMat.vertexColors = false;
    wallMat.side = THREE.DoubleSide;
    extra.push(_mesh(THREE, wallArrays(outer, bot, top), wallMat));
    if (spec.inner) {
      const inner = toWorld(spec.inner, W, H);
      const barMat = new THREE.MeshPhongMaterial({ color: spec.color || '#d9c9a3', side: THREE.DoubleSide, shininess: 12 });
      const bars = _mesh(THREE, ringArrays(outer, inner, spec.frameBottomZ, bot), barMat);
      bars.name = 'frame-bars';
      extra.push(bars);
    }
  }
  return extra;
}
