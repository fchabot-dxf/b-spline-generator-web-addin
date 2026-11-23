/**
 * stl/ghost-trim.js -- the STL ghost trimmed to the board outline (Fred 2026-11-22, claude 47 / template_3: the ghost hung
 * past the frame's waist notch over empty space). Used by the 3D preview only (core/preview/index.js setStlGhosts). A module
 * of its own so core/stl/ghost.js -- which the heights stage imports (sampleGridAt) -- stays out of frame-mesh.js's import
 * closure (tests/heights-inert-keys.test.js scans that closure).
 */
import { meetLine } from './ghost.js';
import { polygonPointTester } from '../preview/frame-mesh.js'; // the terrain trim's own batched point-in-polygon

/**
 * The ghost `g` (core/stl/ghost.js ghostGeometry's shape) TRIMMED to the board outline `poly` -- the SAME loop the terrain
 * preview is trimmed to (core/preview/index.js _trimPoly = frameLoopsWorld(spec, grid).panel, scene x / y; null = no frame
 * template: the board rectangle, nothing trimmed and `g` itself comes back). Every triangle whose centroid (x, y) lies outside
 * `poly` is DROPPED (not drawn faint: the faint set means "the pending crop cuts this", and past the trim there is no board to
 * show it on); the crop preview's faint triangles are trimmed the same way. The vertices only dropped triangles used are
 * dropped too (the gizmo's arrow sits on the kept ghost's top) and the meet line is recomputed from the kept triangles.
 * `counts` stay the whole STL's.
 */
export function trimGhost(g, poly) {
  if (!g || !Array.isArray(poly) || poly.length < 3) return g;
  const inside = polygonPointTester(poly), p = g.positions;
  const keepTris = (ix) => {
    const out = [];
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      if (inside((p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3)) out.push(ix[t], ix[t + 1], ix[t + 2]);
    }
    return out;
  };
  const kept = keepTris(g.indices), cut = g.cutIndices ? keepTris(g.cutIndices) : null;
  if (kept.length === g.indices.length && (!cut || cut.length === g.cutIndices.length)) return g;
  const nv = p.length / 3, map = new Int32Array(nv).fill(-1);
  let n = 0;
  for (const v of kept) if (map[v] < 0) map[v] = n++;
  if (cut) for (const v of cut) if (map[v] < 0) map[v] = n++;
  const positions = new Float32Array(n * 3), colours = new Float32Array(n * 3), kinds = new Uint8Array(n), rels = new Float64Array(n);
  for (let v = 0; v < nv; v++) {
    const k = map[v];
    if (k < 0) continue;
    for (let a = 0; a < 3; a++) { positions[k * 3 + a] = p[v * 3 + a]; colours[k * 3 + a] = g.colours[v * 3 + a]; }
    kinds[k] = g.kinds[v];
    rels[k] = g.rels ? g.rels[v] : 0;
  }
  const indices = Uint32Array.from(kept, (v) => map[v]);
  return {
    ...g, positions, colours, kinds, rels, indices,
    meetLine: g.rels ? meetLine(positions, rels, indices) : new Float32Array(0),
    ...(cut ? { cutIndices: Uint32Array.from(cut, (v) => map[v]) } : {}),
  };
}
