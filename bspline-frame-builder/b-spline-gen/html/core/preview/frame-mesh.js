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

const _primLength = (p) => (p.type === 'L'
  ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y)
  : Math.abs(p.dTheta) * p.rx);
const _primPoint = (p, t) => (p.type === 'L'
  ? { x: p.p0.x + (p.p1.x - p.p0.x) * t, y: p.p0.y + (p.p1.y - p.p0.y) * t }
  : { x: p.cx + p.rx * Math.cos(p.theta1 + p.dTheta * t), y: p.cy + p.ry * Math.sin(p.theta1 + p.dTheta * t) });

/**
 * F7 AMEND (Fred: the bar top must meet the SCULPTED underside): sample two
 * loops of the same topology with the SAME number of steps per primitive pair,
 * each step no longer than `maxStep` (the terrain cell), so a bar top vertex
 * exists at least every cell along the ring and can follow the underside.
 */
export function samplePairedOutlines(outerPrims, innerPrims, maxStep) {
  if (outerPrims.length !== innerPrims.length) throw new Error('samplePairedOutlines: topologies differ');
  const outer = [], inner = [];
  outerPrims.forEach((po, i) => {
    const pi = innerPrims[i];
    const n = Math.max(1, Math.ceil(Math.max(_primLength(po), _primLength(pi)) / maxStep));
    for (let k = 0; k < n; k++) { outer.push(_primPoint(po, k / n)); inner.push(_primPoint(pi, k / n)); }
  });
  return { outer, inner };
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
export function ringArrays(outer, inner, zBottom, zTop, maxStep = Infinity) {
  const n = outer.length;
  if (inner.length !== n) throw new Error(`ringArrays: loops do not correspond (${n} vs ${inner.length})`);
  const positions = [], index = [];
  const v = (p, z) => { positions.push(p.x, p.y, z); return positions.length / 3 - 1; };
  // Rows across the ring width (outer -> inner), so the TOP follows the
  // underside across the bar too, not just along its edges.
  let widest = 0;
  for (let k = 0; k < n; k++) widest = Math.max(widest, Math.hypot(outer[k].x - inner[k].x, outer[k].y - inner[k].y));
  const rows = Math.max(1, Math.ceil(widest / maxStep));
  const at = (k, r) => ({ x: outer[k].x + (inner[k].x - outer[k].x) * (r / rows), y: outer[k].y + (inner[k].y - outer[k].y) * (r / rows) });
  const top = [];
  for (let r = 0; r <= rows; r++) top.push(Array.from({ length: n }, (_, k) => { const p = at(k, r); return v(p, zTop(p)); }));
  const oB = outer.map((p) => v(p, zBottom)), iB = inner.map((p) => v(p, zBottom));
  for (let k = 0; k < n; k++) {
    const m = (k + 1) % n;
    for (let r = 0; r < rows; r++) {
      const a = top[r], b = top[r + 1];
      index.push(a[k], a[m], b[k], b[k], a[m], b[m]); // top, row r
    }
    index.push(oB[k], iB[k], oB[m], iB[k], iB[m], oB[m]); // bottom (flat, at frame-bottom z)
    const oT = top[0], iT = top[rows];
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
  const cell = Math.min(W / Math.max(1, nx - 1), H / Math.max(1, nz - 1));
  // The edge wall needs grid-fine sampling even without bars (a long straight
  // edge must follow the terrain top), so the outline is always densified.
  const paired = samplePairedOutlines(spec.outerPrimitives, spec.innerPrimitives || spec.outerPrimitives, cell);
  const outer = toWorld(paired.outer, W, H);
  geom.setIndex(trimIndices(full, geom.attributes.position.array, outer));
  const extra = [];
  if (topPos && botPos) {
    const top = (p) => sampleGridZ(topPos, nx, nz, W, H, p.x, p.y);
    const bot = (p) => sampleGridZ(botPos, nx, nz, W, H, p.x, p.y);
    const wallMat = panelMesh.material.clone();
    wallMat.vertexColors = false;
    wallMat.side = THREE.DoubleSide;
    extra.push(_mesh(THREE, wallArrays(outer, bot, top), wallMat));
    if (spec.innerPrimitives) {
      const inner = toWorld(paired.inner, W, H);
      const barMat = new THREE.MeshPhongMaterial({ color: spec.color || '#d9c9a3', side: THREE.DoubleSide, shininess: 12 });
      const bars = _mesh(THREE, ringArrays(outer, inner, spec.frameBottomZ, bot, cell), barMat);
      bars.name = 'frame-bars';
      extra.push(bars);
    }
  }
  return extra;
}
