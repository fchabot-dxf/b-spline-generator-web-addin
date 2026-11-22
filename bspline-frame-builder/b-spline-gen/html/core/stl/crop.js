/**
 * stl/crop.js -- STL-CROP (STL-RELIEF-DESIGN.md section 14, Fred 2026-11-22): the ONE crop mechanism and the crop-edge falloff.
 * Pure array math (no DOM), unit-tested. The library browser's Crop mode and the STL panel's Crop group both call cropMesh.
 *
 *   cropMesh(mesh, box) -> { mesh, capped, openLoops }
 *     A REAL cut (Fred: "I don't need to keep the original"): `mesh` ({ positions, indices }, core/stl/mesh.js indexMesh's shape)
 *     is cut to `box` and only the kept part is returned. `box` = FRACTIONS of the mesh's OWN bounding box, per axis [min, max]
 *     ({ x: [0, 1], y: [0, 1], z: [0, 1] }; an absent axis = [0, 1]), so a box set on a light preview model applies to the full
 *     model of the same shape. A plane at the box's own edge (0 or 1) cuts nothing; the full box returns the SAME mesh object.
 *     The planes cut one after another: each clips every triangle (Sutherland-Hodgman, the crossing points shared per edge so the
 *     result stays welded), chains that plane's cut segments into loops (end points merged within a tolerance) and CAPS each
 *     closed loop flat: nested loops become a polygon with holes (each hole bridged to its outer loop), triangulated by the
 *     shared ear-clipper (core/preview/frame-mesh.js earClip) and wound to face out of the kept part. A closed mesh stays closed.
 *     An open mesh can leave cut chains that do not close: they are counted (`openLoops`), never capped, never an error.
 *     `capped` = how many cap polygons were added.
 *
 *   The falloff (Fred: "allow to have a falloff from the edges of the bounding box"): a LIVE stamp setting of the STL record,
 *   `cropFalloff` (STL_CROP_FALLOFF_DEFAULTS), applied to the pass body by core/stl/layer.js (cropFalloffOf + applyCropFalloff).
 *   Absent, a width of 0 or no edge on = nothing happens (the pass byte-identical to before).
 */
import { meshBounds } from './mesh.js';
import { placeMesh } from './raster.js';
import { earClip, pointInPolygon } from '../preview/frame-mesh.js';
import { BRUSH_FALLOFFS, brushFalloff, curveFromPoints } from '../height/brush.js';

export const CROP_AXES = Object.freeze(['x', 'y', 'z']);

/** `box` with every axis read: [min, max] as given (numbers), an absent axis or end = [0, 1]. A fresh object. */
export function normaliseCropBox(box) {
  const b = box && typeof box === 'object' ? box : {};
  const out = {};
  for (const a of CROP_AXES) {
    const r = Array.isArray(b[a]) ? b[a] : [];
    out[a] = [Number.isFinite(r[0]) ? r[0] : 0, Number.isFinite(r[1]) ? r[1] : 1];
  }
  return out;
}
/** True when `box` cuts nothing (every axis [<= 0, >= 1]). */
export const isFullCropBox = (box) => { const b = normaliseCropBox(box); return CROP_AXES.every((a) => b[a][0] <= 0 && b[a][1] >= 1); };

/** The absolute box ({ min: [x, y, z], max }) of fractional `box` over `bounds` (meshBounds' shape). */
export function cropBoxIn(bounds, box) {
  const b = normaliseCropBox(box);
  const min = [], max = [];
  CROP_AXES.forEach((a, k) => { const s = bounds.max[k] - bounds.min[k]; min.push(bounds.min[k] + b[a][0] * s); max.push(bounds.min[k] + b[a][1] * s); });
  return { min, max };
}
/** The absolute box `abs` ({ min, max }) as fractions of `bounds` (an axis of no size reads [0, 1]). */
export function cropBoxOf(bounds, abs) {
  const out = {};
  CROP_AXES.forEach((a, k) => {
    const s = bounds.max[k] - bounds.min[k];
    out[a] = s > 0 ? [(abs.min[k] - bounds.min[k]) / s, (abs.max[k] - bounds.min[k]) / s] : [0, 1];
  });
  return out;
}

/** The cut planes of fractional `box` over `bounds`: { axis (0..2), value, keep (+1 = keep >= value, -1 = keep <= value) }. */
function cropPlanes(bounds, box) {
  const b = normaliseCropBox(box);
  const out = [];
  CROP_AXES.forEach((ax, a) => {
    const s = bounds.max[a] - bounds.min[a];
    if (!(s > 0)) return; // a flat axis has nothing to cut
    if (b[ax][0] > 0) out.push({ axis: a, value: bounds.min[a] + b[ax][0] * s, keep: 1 });
    if (b[ax][1] < 1) out.push({ axis: a, value: bounds.min[a] + b[ax][1] * s, keep: -1 });
  });
  return out;
}

/** The welded mesh as a triangle soup (core/stl/parse.js parseStl's `.soup` shape): 9 floats per triangle. */
export function soupOfMesh(mesh) {
  const { positions: p, indices: ix } = mesh;
  const out = new Float32Array(ix.length * 3);
  for (let t = 0; t < ix.length; t++) { const v = ix[t] * 3; out[t * 3] = p[v]; out[t * 3 + 1] = p[v + 1]; out[t * 3 + 2] = p[v + 2]; }
  return out;
}

/** Tolerances, relative to the mesh's longest side: a vertex this close to a plane is ON it; cut ends this close are one point. */
export const CROP_TOLERANCE = Object.freeze({ onPlane: 1e-7, mergeEnds: 1e-6 });

export function cropMesh(mesh, box) {
  const bounds = meshBounds(mesh.positions);
  const planes = cropPlanes(bounds, box);
  if (!planes.length) return { mesh, capped: 0, openLoops: 0 };
  const ext = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) || 1;
  let pos = Float64Array.from(mesh.positions);
  let idx = Uint32Array.from(mesh.indices);
  let capped = 0, openLoops = 0;
  for (const pl of planes) {
    const r = cutAt(pos, idx, pl, ext * CROP_TOLERANCE.onPlane, ext * CROP_TOLERANCE.mergeEnds);
    pos = r.pos; idx = r.idx; capped += r.capped; openLoops += r.openLoops;
  }
  return { mesh: { positions: Float32Array.from(pos), indices: idx }, capped, openLoops };
}

/** One plane: clip, chain the cut, cap it, compact. */
function cutAt(pos, idx, { axis: a, value: c, keep: s }, eps, tol) {
  const nv = pos.length / 3;
  const d = new Float64Array(nv), side = new Int8Array(nv);
  for (let v = 0; v < nv; v++) { const dv = s * (pos[v * 3 + a] - c); d[v] = dv; side[v] = dv > eps ? 1 : dv < -eps ? -1 : 0; }
  const P = Array.from(pos); // grows: the crossing points are appended
  for (let v = 0; v < nv; v++) if (side[v] === 0) P[v * 3 + a] = c; // ON the plane: exactly on it
  const cut = new Map(); // undirected edge -> its crossing vertex (one per edge: the two triangles on it share it)
  const cross = (u, v) => {
    const lo = u < v ? u : v, hi = u < v ? v : u, k = lo * nv + hi;
    let id = cut.get(k);
    if (id === undefined) {
      const t = d[lo] / (d[lo] - d[hi]);
      id = P.length / 3;
      P.push(pos[lo * 3] + t * (pos[hi * 3] - pos[lo * 3]), pos[lo * 3 + 1] + t * (pos[hi * 3 + 1] - pos[lo * 3 + 1]), pos[lo * 3 + 2] + t * (pos[hi * 3 + 2] - pos[lo * 3 + 2]));
      P[id * 3 + a] = c;
      cut.set(k, id);
    }
    return id;
  };
  const out = [];
  const segs = [];          // cut segments, pairs of vertex ids
  const onEdges = new Map(); // an edge lying ON the plane of a kept triangle -> [u, v, uses]: used once = an edge of the cut
  const noteOn = (u, v) => { const k = u < v ? u * nv + v : v * nv + u; const e = onEdges.get(k); if (e) e[2]++; else onEdges.set(k, [u, v, 1]); };
  const vs = [0, 0, 0], ss = [0, 0, 0];
  for (let t = 0; t < idx.length; t += 3) {
    vs[0] = idx[t]; vs[1] = idx[t + 1]; vs[2] = idx[t + 2];
    ss[0] = side[vs[0]]; ss[1] = side[vs[1]]; ss[2] = side[vs[2]];
    if (ss[0] >= 0 && ss[1] >= 0 && ss[2] >= 0) {
      if (ss[0] === 0 && ss[1] === 0 && ss[2] === 0) continue; // lying in the plane: the cap covers it
      out.push(vs[0], vs[1], vs[2]);
      for (let e = 0; e < 3; e++) if (ss[e] === 0 && ss[(e + 1) % 3] === 0) noteOn(vs[e], vs[(e + 1) % 3]);
      continue;
    }
    if (ss[0] <= 0 && ss[1] <= 0 && ss[2] <= 0) continue; // cut away
    // crosses the plane: Sutherland-Hodgman on the triangle, the winding kept
    const poly = [], on = [];
    for (let e = 0; e < 3; e++) {
      const p = vs[e], q = vs[(e + 1) % 3], sp = ss[e], sq = ss[(e + 1) % 3];
      if (sp >= 0) { poly.push(p); on.push(sp === 0); }
      if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) { poly.push(cross(p, q)); on.push(true); }
    }
    for (let k = 1; k + 1 < poly.length; k++) out.push(poly[0], poly[k], poly[k + 1]);
    for (let k = 0; k < poly.length; k++) { const k2 = (k + 1) % poly.length; if (on[k] && on[k2]) { segs.push(poly[k], poly[k2]); break; } }
  }
  for (const [u, v, n] of onEdges.values()) if (n === 1) segs.push(u, v);

  // ── the cap: the 2D frame (ua, va) is chosen so that CCW faces OUT of the kept part ──
  const U = (a + 1) % 3, V = (a + 2) % 3;
  const [ua, va] = s < 0 ? [U, V] : [V, U];
  const nP = P.length / 3;
  const alias = new Int32Array(nP);
  for (let i = 0; i < nP; i++) alias[i] = i;
  const canon = new Map();
  for (let k = 0; k < segs.length; k++) {
    const id = segs[k];
    const key = `${Math.round(P[id * 3 + ua] / tol)},${Math.round(P[id * 3 + va] / tol)}`;
    const r = canon.get(key);
    if (r === undefined) canon.set(key, id); else if (r !== id) alias[id] = r;
  }
  for (let k = 0; k < out.length; k++) out[k] = alias[out[k]];
  // segments after the merge: no zero-length one, each undirected pair once
  const segList = [];
  const seen = new Set();
  for (let k = 0; k < segs.length; k += 2) {
    const u = alias[segs[k]], v = alias[segs[k + 1]];
    if (u === v) continue;
    const key = u < v ? u * nP + v : v * nP + u;
    if (seen.has(key)) continue;
    seen.add(key);
    segList.push([u, v]);
  }
  const { loops, open } = chainSegments(segList);
  let capped = 0;
  for (const poly of capPolygons(loops.map((ids) => ids.map((id) => ({ x: P[id * 3 + ua], y: P[id * 3 + va], id }))))) {
    for (const [i, j, k] of earClip(poly)) out.push(poly[i].id, poly[j].id, poly[k].id);
    capped++;
  }

  // ── compact: only the vertices the kept triangles use; a triangle the merge collapsed is dropped ──
  const keep = new Int32Array(nP).fill(-1);
  let nk = 0;
  const ix = [];
  for (let t = 0; t < out.length; t += 3) {
    const p0 = out[t], p1 = out[t + 1], p2 = out[t + 2];
    if (p0 === p1 || p1 === p2 || p0 === p2) continue;
    for (const v of [p0, p1, p2]) { if (keep[v] < 0) keep[v] = nk++; ix.push(keep[v]); }
  }
  const np = new Float64Array(nk * 3);
  for (let v = 0; v < nP; v++) { const k = keep[v]; if (k >= 0) { np[k * 3] = P[v * 3]; np[k * 3 + 1] = P[v * 3 + 1]; np[k * 3 + 2] = P[v * 3 + 2]; } }
  return { pos: np, idx: Uint32Array.from(ix), capped, openLoops: open };
}

/** Undirected segments -> closed loops (vertex id lists) and the number of chains that do not close (`open`). */
function chainSegments(segList) {
  const adj = new Map();
  segList.forEach(([u, v], i) => {
    for (const p of [u, v]) { const l = adj.get(p); if (l) l.push(i); else adj.set(p, [i]); }
  });
  const used = new Uint8Array(segList.length);
  const step = (cur) => {
    const l = adj.get(cur);
    if (l) for (const i of l) if (!used[i]) { used[i] = 1; const [u, v] = segList[i]; return u === cur ? v : u; }
    return -1;
  };
  /** Follow unused segments from p until none is left; how many were taken. */
  const walkFrom = (p) => { let cur = p, n = 0; for (;;) { const nx = step(cur); if (nx < 0) return n; n++; cur = nx; } };
  let open = 0;
  // the chains first, from their loose ends (an odd number of segments meets there): each one is an open loop
  for (const [p, l] of adj) {
    if (l.length % 2 === 0) continue;
    while (walkFrom(p) > 0) open++;
  }
  const loops = [];
  for (let i = 0; i < segList.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const [start, second] = segList[i];
    const loop = [start];
    let cur = second;
    while (cur !== start && cur >= 0) { loop.push(cur); cur = step(cur); }
    if (cur === start && loop.length >= 3) loops.push(loop);
    else if (cur !== start) open++;
  }
  return { loops, open };
}

const areaOf = (pts) => { let s = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y); return s / 2; };

/**
 * Closed loops (2D points) -> one simple CCW polygon per OUTER loop, its holes bridged in. A loop inside an even number of others
 * is an outer boundary, inside an odd number a hole of the smallest loop around it.
 */
function capPolygons(loops) {
  const L = loops.map((pts) => ({ pts, area: areaOf(pts) })).filter((l) => Math.abs(l.area) > 0);
  const inside = (i, j) => pointInPolygon(L[i].pts[0].x, L[i].pts[0].y, L[j].pts);
  const depth = L.map((_, i) => L.reduce((n, _l, j) => n + (j !== i && inside(i, j) ? 1 : 0), 0));
  const holesOf = new Map();
  L.forEach((l, i) => {
    if (depth[i] % 2 === 0) { holesOf.set(i, holesOf.get(i) || []); return; }
    let parent = -1;
    L.forEach((m, j) => { if (j !== i && depth[j] === depth[i] - 1 && inside(i, j) && (parent < 0 || Math.abs(m.area) < Math.abs(L[parent].area))) parent = j; });
    if (parent < 0) return;
    const list = holesOf.get(parent) || [];
    list.push(i);
    holesOf.set(parent, list);
  });
  const out = [];
  for (const [i, holes] of holesOf) {
    if (depth[i] % 2 !== 0) continue;
    const outer = L[i].area > 0 ? L[i].pts.slice() : L[i].pts.slice().reverse();
    const hs = holes.map((h) => (L[h].area < 0 ? L[h].pts.slice() : L[h].pts.slice().reverse()));
    out.push(hs.length ? bridgeHoles(outer, hs) : outer);
  }
  return out;
}

const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
/** Segments ab and cd cross at a point inside both (touching at an end does not count). */
function crosses(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}
const same = (p, q) => p.x === q.x && p.y === q.y;
/** Each hole (CW) joined to the outer polygon (CCW) by a bridge from its rightmost point to the nearest outer point it can see. */
function bridgeHoles(outer, holes) {
  let poly = outer;
  const todo = holes.map((h) => { let im = 0; for (let k = 1; k < h.length; k++) if (h[k].x > h[im].x) im = k; return { h, im }; })
    .sort((p, q) => q.h[q.im].x - p.h[p.im].x);
  todo.forEach(({ h, im }, n) => {
    const M = h[im];
    const others = todo.slice(n).map((t) => t.h);
    const blocked = (Pv) => {
      const ring = (pts) => pts.some((p, k) => { const q = pts[(k + 1) % pts.length]; return !same(p, M) && !same(q, M) && !same(p, Pv) && !same(q, Pv) && crosses(M, Pv, p, q); });
      return ring(poly) || others.some(ring);
    };
    const order = poly.map((_, i) => i).sort((i, j) => ((poly[i].x - M.x) ** 2 + (poly[i].y - M.y) ** 2) - ((poly[j].x - M.x) ** 2 + (poly[j].y - M.y) ** 2));
    const ip = order.find((i) => !blocked(poly[i])) ?? order[0];
    const ring = [...h.slice(im), ...h.slice(0, im + 1)];
    poly = [...poly.slice(0, ip + 1), ...ring, poly[ip], ...poly.slice(ip + 1)];
  });
  return poly;
}

// ── the crop-edge falloff (a live stamp setting of the record) ──────────────────────────────────────────────────────
/** The footprint edges a falloff can fade: the placed mesh's board-XY box (left = -X, right = +X, front = -Y, back = +Y) and
 *  'bottom' (the body fades near the model's lowest heights: a figure rises out of the board). */
export const STL_CROP_EDGES = Object.freeze([
  Object.freeze(['left', 'Left (−X)']), Object.freeze(['right', 'Right (+X)']),
  Object.freeze(['front', 'Front (−Y)']), Object.freeze(['back', 'Back (+Y)']),
  Object.freeze(['bottom', 'Bottom (rises out of the board)']),
]);
/** The record field `cropFalloff`'s declared defaults (an absent field reads as these; width 0 = off). */
export const STL_CROP_FALLOFF_DEFAULTS = Object.freeze({
  widthIn: 0,
  profile: 'smooth', // a BRUSH_FALLOFFS key (core/height/brush.js)
  customCurve: null, // [[t, value], ...] for 'custom' (null = the brush's default curve)
  edges: Object.freeze({ left: true, right: true, front: true, back: true, bottom: true }),
});

/** The record's falloff with every field read (defaults for the absent ones), or null when it does nothing (absent, width not
 *  > 0, or no edge on). */
export function cropFalloffOf(raw) {
  const r = raw && typeof raw === 'object' ? raw : null;
  if (!r || !(r.widthIn > 0)) return null;
  const d = STL_CROP_FALLOFF_DEFAULTS;
  const edges = {};
  for (const [k] of STL_CROP_EDGES) edges[k] = r.edges && r.edges[k] !== undefined ? !!r.edges[k] : d.edges[k];
  if (!STL_CROP_EDGES.some(([k]) => edges[k])) return null;
  const profile = BRUSH_FALLOFFS[r.profile] ? r.profile : d.profile;
  return { widthIn: r.widthIn, profile, customCurve: profile === 'custom' && Array.isArray(r.customCurve) ? r.customCurve : null, edges };
}

/** The placed mesh's board-XY box (scene inches, core/stl/raster.js placeMesh): { x0, x1, y0, y1 }. */
export function placedFootprint(mesh, rec) {
  const { xyz } = placeMesh(mesh, rec);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < xyz.length; i += 3) {
    const x = xyz[i], y = xyz[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, x1, y0, y1 };
}

/**
 * Fade `body` (written in place) by falloff `fo` (cropFalloffOf's shape). For each enabled side edge of the footprint `foot`,
 * the weight is the brush's falloff curve (core/height/brush.js brushFalloff, hardness 0) at t = 1 - (distance inside that edge /
 * widthIn), t kept in 0..1 (t = 0: full, t = 1: zero); 'bottom' uses the point's height above the model's lowest point
 * (`height`, renderDepth's inches) as the distance. The weights multiply. Only covered points change.
 * Grid: column i at x = -W/2 + i*dx, row j at y = -H/2 + j*dy (buildHeightField's frame).
 */
export function applyCropFalloff(body, covered, height, foot, fo, grid) {
  const { nx, nz, widthIn: W, heightIn: H } = grid;
  const dx = W / (nx - 1), dy = H / (nz - 1);
  const fn = fo.profile === 'custom' && fo.customCurve ? curveFromPoints(fo.customCurve) : null;
  const f = (dist) => {
    let t = 1 - dist / fo.widthIn;
    if (!(t > 0)) t = 0; else if (t > 1) t = 1;
    return brushFalloff(t, 1, 0, fo.profile, fn);
  };
  const e = fo.edges;
  const col = new Float64Array(nx), row = new Float64Array(nz);
  for (let i = 0; i < nx; i++) { const x = -W / 2 + i * dx; col[i] = (e.left ? f(x - foot.x0) : 1) * (e.right ? f(foot.x1 - x) : 1); }
  for (let j = 0; j < nz; j++) { const y = -H / 2 + j * dy; row[j] = (e.front ? f(y - foot.y0) : 1) * (e.back ? f(foot.y1 - y) : 1); }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!covered[k]) continue;
      body[k] *= col[i] * row[j] * (e.bottom ? f(height[k]) : 1);
    }
  }
  return body;
}
