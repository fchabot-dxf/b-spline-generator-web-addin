/**
 * core/polygon.js -- the app's ONE ear-clipper and point-in-polygon test, with no imports, shared by the frame trim
 * (core/preview/frame-mesh.js, where they were written; it re-exports them unchanged) and the STL crop caps (core/stl/crop.js).
 * Moved here verbatim (STL-CROP, 2026-11-22) so the crop does not pull the frame preview's modules into the heights stage.
 */

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Ear-clip a CCW polygon into triangles (index triples into `pts`). */
export function earClip(pts) {
  const idx = pts.map((_, i) => i), tris = [];
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const inTri = (p, a, b, c) => cross(a, b, p) > 1e-12 && cross(b, c, p) > 1e-12 && cross(c, a, p) > 1e-12;
  while (idx.length > 3) {
    let cut = -1;
    for (let k = 0; k < idx.length && cut < 0; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      if (cross(pts[i0], pts[i1], pts[i2]) < -1e-12) continue; // reflex
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inTri(pts[j], pts[i0], pts[i1], pts[i2]))) continue;
      cut = k;
    }
    if (cut < 0) cut = 0; // only degenerate (zero-area) corners are left
    tris.push([idx[(cut + idx.length - 1) % idx.length], idx[cut], idx[(cut + 1) % idx.length]]);
    idx.splice(cut, 1);
  }
  tris.push(idx);
  return tris;
}
