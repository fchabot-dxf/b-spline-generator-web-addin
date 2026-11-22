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
  if (!(c > 1e-6)) return body; // numerics, not a user clamp: below ~1e-16 a = 1 + 30c rounds to 1 and 0/0 is NaN; this tiny is linear anyway
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

export const STL_NO_TRIANGLES_MESSAGE = 'The STL has no usable triangles.';

/**
 * Build the record for an imported STL soup. The ORIGINAL welded mesh is returned too (kept in memory this session so
 * Stored detail can go up as well as down; only the stored copy is saved).
 * The mesh health is measured on the ORIGINAL here and kept in the record (`health`): the decimated copy's vertex
 * clustering makes open / non-manifold edges of its own, so measuring the stored copy would report holes the file has not.
 * A soup with no usable triangle (empty, or every triangle collapsed) throws STL_NO_TRIANGLES_MESSAGE (the panel shows it).
 * @returns {{ record: object, original: {positions, indices} }}
 */
export function createStlLayer({ soup, name, board, storedDetail = STL_STORED_DETAIL_DEFAULT }) {
  const original = indexMesh(soup);
  if (!(original.indices.length > 0)) throw new Error(STL_NO_TRIANGLES_MESSAGE);
  const stored = decimate(original, storedDetail);
  const record = {
    ...normaliseStlLayer({}),
    id: newStlId(),
    name: name || 'STL',
    unitIn: fitUnitIn(original, board),
    storedDetail,
    origTris: original.indices.length / 3,
    storedTris: stored.indices.length / 3,
    health: meshHealth(original),
    mesh: encodeMesh(stored),
  };
  return { record, original };
}

/** Re-store the layer's mesh at a new detail from `source` (the in-memory original, or the stored copy: lower only).
 *  The record's `health` (measured on the original at import) is kept as it is. */
export function restoreAtDetail(record, source, storedDetail) {
  const stored = decimate(source, storedDetail);
  return { ...record, storedDetail, storedTris: stored.indices.length / 3, mesh: encodeMesh(stored) };
}

/** The mesh report: the one measured on the original at import (record.health), else measured on the stored copy. */
export const stlHealth = (record) => record.health ?? meshHealth(decodeMesh(record.mesh));

/** Total stored triangles over the project's STLs (the panel's size warning reads this). */
export const totalStoredTris = (layers) => (layers || []).reduce((n, l) => n + (l?.storedTris || l?.mesh?.nt || 0), 0);

// ── the pass ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Three LRU caches (a get moves the entry to the newest end; the oldest is dropped past the cap):
//   mesh   mesh.h -> the decoded mesh
//   raster (mesh, unit, scale, zScale, position x/y, rotation, grid) -> renderDepth's { height, covered, hMax }
//   body   raster key + compress + softness -> the FINAL { body, covered, hMax } a pass carries (the softness blur is the
//          costly step: ~1e9 multiply-adds on a 1000 x 1000 grid at 2 in)
// position.z, raise and blend are applied at pass time / in applyStampLayers, so they never rebuild a raster or a body.
export const STL_CACHE_CAPS = Object.freeze({ mesh: 8, raster: 16, body: 16 });
const _meshCache = new Map();
const _rasterCache = new Map();
const _bodyCache = new Map();
function lruGet(map, key) {
  const v = map.get(key);
  if (v !== undefined) { map.delete(key); map.set(key, v); }
  return v;
}
function lruSet(map, key, v, cap) {
  map.set(key, v);
  while (map.size > cap) map.delete(map.keys().next().value);
  return v;
}
function decoded(rec) {
  const key = rec.mesh.h || `${rec.mesh.nv}:${rec.mesh.nt}`;
  return lruGet(_meshCache, key) || lruSet(_meshCache, key, decodeMesh(rec.mesh), STL_CACHE_CAPS.mesh);
}
const rasterKey = (rec, g) => JSON.stringify([rec.mesh.h || rec.mesh.nt, rec.unitIn, rec.scale, rec.zScale, rec.position.x, rec.position.y, rec.rotation, g.nx, g.nz, g.widthIn, g.heightIn]);

/** The pass's final body (0..1), its coverage and the relief height, from the caches when the inputs are the same. */
function passBody(rec, grid) {
  const { nx, nz, widthIn } = grid;
  const rKey = rasterKey(rec, grid);
  const bKey = JSON.stringify([rKey, rec.compress, rec.softness]);
  const hit = lruGet(_bodyCache, bKey);
  if (hit) { lruGet(_rasterCache, rKey); return hit; } // the body's raster is "used" too: the two caches age together
  const r = lruGet(_rasterCache, rKey) || lruSet(_rasterCache, rKey, renderDepth(decoded(rec), rec, grid), STL_CACHE_CAPS.raster);
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
  return lruSet(_bodyCache, bKey, { body, covered, hMax: r.hMax }, STL_CACHE_CAPS.body);
}

/**
 * One STL record as a stamp pass (core/engine/apply-stamp-layers.js), or null when it contributes nothing.
 * `carve` carries Raised / Carved on its own: a flat mesh has hMax 0, so the sign of `depth` (-0) cannot say it.
 * The mask arrays are SHARED with the cache (applyStampLayers only reads them): never write into them.
 */
export function stlPass(rawRec, grid) {
  const rec = normaliseStlLayer(rawRec);
  if (rec.enabled === false || !rec.mesh) return null;
  const { body, covered, hMax } = passBody(rec, grid);
  return {
    id: `stl:${rec.id}`,
    kind: 'stl',
    name: rec.name,
    enabled: true,
    svg: '1', // applyStampLayers' guard wants a non-empty marker; the mask is already built
    mask: { body, fillet: null, isStamped: covered },
    depth: (rec.raise ? 1 : -1) * hMax,
    carve: !rec.raise,
    blend: rec.blend,
    zOffset: rec.position.z,
    profile: 'flat',
    suppression: 0,
    smoothing: 0,
    edgeFilletRadius: 0,
    filletPower: 1,
  };
}

// ── errors ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// The one STL error map: record id -> message. stlPasses clears and refills it at each call (a layer that cannot be read is
// skipped, never breaks the board's build); updateStlGhosts (core/stl/ghost.js) adds its own failures. The panel reads it.
const _errors = new Map();
/** The id a record's error is filed under (its own id; `#<list index>` for a record without one). */
export const stlErrorId = (rec, i) => (rec && rec.id != null ? String(rec.id) : `#${i}`);
export function recordStlError(id, err) { _errors.set(String(id), String((err && err.message) || err)); }
/** { recordId: message } for every STL layer the last build (and the ghosts since) could not use. A fresh plain object. */
export function getStlErrors() { return Object.fromEntries(_errors); }

/** Every enabled STL record as a pass, in list order (the grid is the build's own). [] when there are none.
 *  A record that throws (a bad stored mesh) is skipped and its message recorded (getStlErrors). */
export function stlPasses(layers, grid) {
  _errors.clear();
  if (!Array.isArray(layers) || !layers.length) return [];
  const out = [];
  layers.forEach((l, i) => {
    try {
      const p = stlPass(l, grid);
      if (p) out.push(p);
    } catch (e) { recordStlError(stlErrorId(l, i), e); }
  });
  return out;
}

export function _resetStlCachesForTests() { _meshCache.clear(); _rasterCache.clear(); _bodyCache.clear(); _errors.clear(); }
