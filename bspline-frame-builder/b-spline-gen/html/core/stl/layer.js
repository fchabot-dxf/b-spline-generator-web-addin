/**
 * stl/layer.js -- STL-RELIEF (STL-RELIEF-DESIGN.md): the STL layer RECORD (P.stlLayers[i]), its declared defaults, and the stamp PASS it
 * becomes. Self-contained (Fred: no stack, the app's parameters are scattered): every STL setting lives in the record and reads none
 * of the other stamp / brick / photo keys. The pass joins the app at exactly one place: core/engine/rebuild.js _collectStampPasses.
 *
 * A saved record stores its OWN values; a field it lacks reads as the declared default (normaliseStlLayer never writes back to a
 * loaded board -- AGENTS.md rule 3).
 */
import { indexMesh, decimate, encodeMesh, decodeMesh, meshBounds, meshHealth } from './mesh.js';
import { renderDepth } from './raster.js';
import { gaussianSmooth } from '../gaussian.js';

export const STL_BLENDS = Object.freeze(['max', 'add']);
/** 'withSurface' (slice 1): part of the heights like any stamp. 'afterBack' (later slice): the back stays as before the STL. */
export const STL_PLACEMENTS = Object.freeze(['withSurface', 'afterBack']);
/** Triangles a stored mesh is capped at when imported (a size WARNING shows past STL_WARN_TOTAL_TRIS; no hard stop). */
export const STL_STORED_DETAIL_DEFAULT = 50000;
export const STL_WARN_TOTAL_TRIS = 150000;

/** The declared defaults. position x/y are inches from the board centre, z the Z offset (inches; negative sinks it into the surface). */
export const STL_LAYER_DEFAULTS = Object.freeze({
  v: 1,
  enabled: true,
  name: 'STL',
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  rotation: Object.freeze({ x: 0, y: 0, z: 0 }), // degrees
  scale: 1,        // uniform, on top of unitIn
  zScale: 1,       // the relief's height factor ("Depth")
  unitIn: 1,       // inches per mesh unit (fitted at import)
  compress: 0,     // 0 = linear; 1 = strongly compressed (bas-relief tone map)
  blend: 'max',
  raise: true,     // false = carve (the STL's shape as a hollow)
  softness: 0,     // inches of edge blur
  placement: 'withSurface',
  storedDetail: STL_STORED_DETAIL_DEFAULT,
});

/** A record with every absent field read as its declared default (a fresh object; the input is never touched). */
export function normaliseStlLayer(rec) {
  const d = STL_LAYER_DEFAULTS;
  const r = rec || {};
  return {
    ...d, ...r,
    position: { ...d.position, ...(r.position || {}) },
    rotation: { ...d.rotation, ...(r.rotation || {}) },
    blend: STL_BLENDS.includes(r.blend) ? r.blend : d.blend,
    placement: STL_PLACEMENTS.includes(r.placement) ? r.placement : d.placement,
  };
}

/** The bas-relief tone map on a 0..1 value: 0 = linear, towards 1 = the low parts lifted (the tall parts compressed). */
export function compressRelief(body, c) {
  if (!(c > 0)) return body;
  const a = 1 + 30 * Math.min(1, c);
  return Math.log(1 + (a - 1) * body) / Math.log(a);
}

let _idSeq = 0;
export const newStlId = () => `stl${Date.now().toString(36)}${(_idSeq++).toString(36)}`;

/** inches per mesh unit so the STL's longest horizontal side is half the board's shorter side (a first fit; the Scale slider adjusts). */
export function fitUnitIn(mesh, board) {
  const { min, max } = meshBounds(mesh.positions);
  const side = Math.max(max[0] - min[0], max[1] - min[1]) || 1;
  return (0.5 * Math.min(board.widthIn, board.heightIn)) / side;
}

/**
 * Build the record for an imported STL soup. The ORIGINAL welded mesh is returned too (kept in memory this session so
 * Stored detail can go up as well as down; only the stored copy is saved).
 * @returns {{ record: object, original: {positions, indices} }}
 */
export function createStlLayer({ soup, name, board, storedDetail = STL_STORED_DETAIL_DEFAULT }) {
  const original = indexMesh(soup);
  const stored = decimate(original, storedDetail);
  const record = {
    ...normaliseStlLayer({}),
    id: newStlId(),
    name: name || 'STL',
    unitIn: fitUnitIn(original, board),
    storedDetail,
    origTris: original.indices.length / 3,
    storedTris: stored.indices.length / 3,
    mesh: encodeMesh(stored),
  };
  return { record, original };
}

/** Re-store the layer's mesh at a new detail from `source` (the in-memory original, or the stored copy: lower only). */
export function restoreAtDetail(record, source, storedDetail) {
  const stored = decimate(source, storedDetail);
  return { ...record, storedDetail, storedTris: stored.indices.length / 3, mesh: encodeMesh(stored) };
}

export const stlHealth = (record) => meshHealth(decodeMesh(record.mesh));

/** Total stored triangles over the project's STLs (the panel's size warning reads this). */
export const totalStoredTris = (layers) => (layers || []).reduce((n, l) => n + (l?.storedTris || l?.mesh?.nt || 0), 0);

// ── the pass ────────────────────────────────────────────────────────────────────────────────────────────────────────
const _meshCache = new Map(); // mesh.h -> decoded mesh (small LRU)
function decoded(rec) {
  const key = rec.mesh.h || `${rec.mesh.nv}:${rec.mesh.nt}`;
  let m = _meshCache.get(key);
  if (!m) {
    m = decodeMesh(rec.mesh);
    _meshCache.set(key, m);
    if (_meshCache.size > 4) _meshCache.delete(_meshCache.keys().next().value);
  }
  return m;
}
const _rasterCache = new Map(); // key -> { height, covered, hMax } (small LRU)
const rasterKey = (rec, g) => JSON.stringify([rec.mesh.h || rec.mesh.nt, rec.unitIn, rec.scale, rec.zScale, rec.position.x, rec.position.y, rec.rotation, g.nx, g.nz, g.widthIn, g.heightIn]);

/** One STL record as a stamp pass (core/engine/apply-stamp-layers.js), or null when it contributes nothing. */
export function stlPass(rawRec, grid) {
  const rec = normaliseStlLayer(rawRec);
  if (rec.enabled === false || !rec.mesh) return null;
  const { nx, nz, widthIn, heightIn } = grid;
  const key = rasterKey(rec, grid);
  let r = _rasterCache.get(key);
  if (!r) {
    r = renderDepth(decoded(rec), rec, grid);
    _rasterCache.set(key, r);
    if (_rasterCache.size > 8) _rasterCache.delete(_rasterCache.keys().next().value);
  }
  const n = nx * nz;
  let body = new Float32Array(n);
  let covered = r.covered;
  if (r.hMax > 1e-9) for (let k = 0; k < n; k++) body[k] = r.covered[k] ? r.height[k] / r.hMax : 0;
  if (rec.compress > 0) for (let k = 0; k < n; k++) if (covered[k]) body[k] = compressRelief(body[k], rec.compress);
  if (rec.softness > 0) {
    const sigma = rec.softness / (widthIn / (nx - 1));
    body = gaussianSmooth(body, nx, nz, sigma);
    covered = Uint8Array.from(covered, (c, k) => (c || body[k] > 1e-4 ? 1 : 0));
  }
  return {
    id: `stl:${rec.id}`,
    kind: 'stl',
    name: rec.name,
    enabled: true,
    svg: '1', // applyStampLayers' guard wants a non-empty marker; the mask is already built
    mask: { body, fillet: null, isStamped: covered },
    depth: (rec.raise ? 1 : -1) * r.hMax,
    blend: rec.blend,
    zOffset: rec.position.z,
    profile: 'flat',
    suppression: 0,
    smoothing: 0,
    edgeFilletRadius: 0,
    filletPower: 1,
  };
}

/** Every enabled STL record as a pass, in list order (the grid is the build's own). [] when there are none. */
export function stlPasses(layers, grid) {
  if (!Array.isArray(layers) || !layers.length) return [];
  return layers.map((l) => stlPass(l, grid)).filter(Boolean);
}

export function _resetStlCachesForTests() { _meshCache.clear(); _rasterCache.clear(); }
