/**
 * photo/state.js — F34 item 1: the Photo filter's own transient (non-P)
 * cache. Two stages, because decoding a PNG/JPEG into pixels is ASYNC
 * (canvas Image.onload) while applying the declared edit steps is a pure,
 * synchronous array transform:
 *
 *   P.photoImageDataUrl (string, persisted)  --[async decode, codec.js]-->
 *     _rawBase (greyscale pixels, in-memory only, re-decoded on load)
 *       --[applyPhotoEdits, sync, ops.js]--> _processed (what fn() samples)
 *
 * `P.photoEdits` (the declared {op,params} list) is also persisted as
 * plain JSON, same convention as P.stampLayers/P.decalLayerIds (core/
 * state.js) -- written directly, not through updateP/applyParam, since
 * it is not a single scalar control.
 *
 * Both caches key off the exact inputs they depend on, so repeated terrain
 * rebuilds (every mouse-drag tick) reuse the processed image instead of
 * re-running the edit pipeline per sampled pixel.
 */
import { applyPhotoEdits } from './ops.js';
import { decodeImageToGrey } from './codec.js';

let _rawBase = null;       // { data: Float32Array, w, h } | null
let _rawBaseSourceUrl = null;
let _decodePromise = null;

let _processed = null;     // { data: Float32Array, w, h } | null
let _processedKey = null;

/** True once the CURRENT P.photoImageDataUrl has finished decoding (or
 * there is none to decode). False while a decode is in flight. */
export function isPhotoReady(photoImageDataUrl) {
  if (!photoImageDataUrl) return true;
  return _rawBaseSourceUrl === photoImageDataUrl;
}

/** Kick off (or reuse) the async decode for `dataUrl`. Resolves once
 * `getProcessedPhotoImage` can serve it. Safe to call repeatedly with the
 * same url (e.g. on every keystroke of an unrelated slider) -- only the
 * FIRST call for a given url actually decodes. */
export function ensurePhotoDecoded(dataUrl) {
  if (!dataUrl) return Promise.resolve(null);
  if (_rawBaseSourceUrl === dataUrl) return Promise.resolve(_rawBase);
  if (_decodePromise && _decodePromise.url === dataUrl) return _decodePromise.promise;
  const promise = decodeImageToGrey(dataUrl).then((raw) => {
    _rawBase = raw;
    _rawBaseSourceUrl = dataUrl;
    _processedKey = null; // force re-processing on next sample
    return raw;
  });
  _decodePromise = { url: dataUrl, promise };
  return promise;
}

/** Synchronous: the fully-processed (edits applied) image for the CURRENT
 * params, or null if nothing is loaded / still decoding. Never throws and
 * never blocks -- core/noise/photo.js's own fn() calls this every sampled
 * pixel and must stay synchronous (see terrain.js's own generateHeightmap
 * loop). */
export function getProcessedPhotoImage(params) {
  const { photoImageDataUrl, photoEdits } = params || {};
  if (!photoImageDataUrl || _rawBaseSourceUrl !== photoImageDataUrl) return null;
  const key = photoImageDataUrl + '|' + JSON.stringify(photoEdits || []);
  if (_processedKey !== key) {
    _processed = applyPhotoEdits(_rawBase, photoEdits || []);
    _processedKey = key;
  }
  return _processed;
}

/** The raw (pre-edit) decoded image, for the editor's own preview/crop UI
 * (which needs to show the UNEDITED photo plus a live preview of the
 * edits, not just the final sampled result). null if not decoded yet. */
export function getRawPhotoImage(photoImageDataUrl) {
  return _rawBaseSourceUrl === photoImageDataUrl ? _rawBase : null;
}

/** Test/reset hook -- clears both cache stages. */
export function _resetPhotoStateForTests() {
  _rawBase = null;
  _rawBaseSourceUrl = null;
  _decodePromise = null;
  _processed = null;
  _processedKey = null;
}
