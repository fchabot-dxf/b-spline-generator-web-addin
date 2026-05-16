/**
 * occt-bridge.js — load occt-import-js (a WASM OpenCascade wrapper) and
 * use it to tessellate a STEP file into Three.js-ready mesh data.
 *
 * SELF-CONTAINED: no imports from sibling modules. The only external
 * dependency is `window.occtimportjs` — the global the upstream library
 * registers when its <script> tag finishes loading.
 *
 * Why occt-import-js: it links a slimmed-down OpenCascade build (~5 MB
 * WASM) that handles ALL STEP surface types, trim curves, BREP
 * topology, and per-face colours. Strictly more accurate than the
 * hand-rolled B-spline-only path in stp-tessellate.js, at the cost of
 * a one-time WASM download.
 *
 * Loading the WASM:
 *   The palette HTML pulls the library from a CDN at boot:
 *
 *     <script src="https://cdn.jsdelivr.net/npm/occt-import-js@<ver>/dist/occt-import-js.js"></script>
 *
 *   …which registers `window.occtimportjs` (a factory). On first use we
 *   call the factory and tell it where the matching .wasm file lives
 *   (same CDN folder by default). Override `window.OCCT_BASE_URL` if
 *   you'd rather host the WASM locally.
 *
 * Public API:
 *   isAvailable()       → boolean — true if the loader script is present
 *   tessellate(text)    → Promise<{meshes:[…], success:boolean}>
 *
 * Each entry in `meshes` is shaped to drop straight into Three.js:
 *   {
 *     name:     string,
 *     color:    [r, g, b] | null,
 *     position: Float32Array,    // flat x,y,z (3 floats per vertex)
 *     normal:   Float32Array,
 *     index:    Uint32Array,
 *   }
 */

import { isFusion, sendToPython, pyLog, registerPythonRoutes } from './runtime.js';

let _occtModule = null;        // resolved factory instance
let _occtPromise = null;       // in-flight load
const TEXT_ENCODER = new TextEncoder();

/* ────────────────────────────────────────────────────────────────────
 * Fast path: when running inside Fusion, route tessellation through
 * the Python add-in instead of the WASM OCCT loader. Fusion's native
 * STEP importer + meshManager.createMeshCalculator tessellates the
 * 14 MB canoe in ~50 ms; WASM takes minutes on the same file.
 *
 * The Python side (step-editor.py _handle_tessellate_via_fusion):
 *   1. Receives chunked STEP text via the existing generate_*
 *      contract with params.mode = 'tessellate'.
 *   2. Imports STEP into a throwaway document (NOT the user's
 *      active doc — no design-tree pollution).
 *   3. Walks every BRep body, tessellates at LowQuality.
 *   4. Closes the temp doc and reactivates the user's previous doc.
 *   5. Ships meshes back as base64'd Float32/Int32 buffers in
 *      256 KB chunks via tess_result_start / _chunk / _finish.
 * ──────────────────────────────────────────────────────────────────── */

/** True if the Fusion tessellation fast-path is usable. */
export function isFusionTessAvailable() {
  return isFusion();
}

/**
 * Tessellate a STEP file via the Fusion add-in. Same return shape as
 * tessellate() so callers can swap paths without branching elsewhere.
 *
 * @param {string} stepText
 * @param {(p:{msg:string})=>void} [onProgress]
 * @returns {Promise<{success:boolean, meshes:Array, message?:string, stats?:object}>}
 */
export function tessellateViaFusion(stepText, onProgress) {
  return new Promise((resolve) => {
    const CHUNK_SIZE = 256 * 1024;
    const envelope = JSON.stringify({
      stepText,
      params: { mode: 'tessellate', filename: 'preview.stp' },
    });
    const totalChunks = Math.ceil(envelope.length / CHUNK_SIZE);
    pyLog(`tessellateViaFusion: ${envelope.length} bytes in ${totalChunks} chunk(s)`);

    // Mesh-result accumulator. Filled by tess_result_chunk callbacks.
    let resultBuffer = [];
    let expectedResultChunks = 0;
    let stats = null;

    const TIMEOUT_MS = 5 * 60 * 1000;
    const timer = setTimeout(() => {
      detach();
      resolve({ success: false, meshes: [], message: `Fusion tessellation timed out after ${TIMEOUT_MS / 1000}s` });
    }, TIMEOUT_MS);

    const detach = registerPythonRoutes({
      import_progress: (data) => {
        if (onProgress && data && data.msg) onProgress({ msg: String(data.msg) });
      },
      import_error: (data) => {
        clearTimeout(timer);
        detach();
        resolve({ success: false, meshes: [], message: (data && data.msg) || 'Fusion reported import_error' });
      },
      tess_result_start: (data) => {
        expectedResultChunks = Number(data?.totalChunks || 0);
        stats = data || null;
        resultBuffer = [];
        if (onProgress) onProgress({ msg: `Receiving ${data?.meshCount ?? '?'} mesh(es)…` });
      },
      tess_result_chunk: (data) => {
        resultBuffer.push(String(data?.data || ''));
      },
      tess_result_finish: () => {
        clearTimeout(timer);
        detach();
        try {
          const json = resultBuffer.join('');
          resultBuffer = [];
          if (expectedResultChunks && /* sanity */ json.length === 0) {
            resolve({ success: false, meshes: [], message: 'tessellate: empty result' });
            return;
          }
          const parsed = JSON.parse(json);
          const meshes = (parsed.meshes || []).map((m) => ({
            name:     m.name || '',
            color:    null,
            position: b64ToFloat32(m.coords_b64),
            normal:   b64ToFloat32(m.normals_b64),
            index:    b64ToUint32(m.indices_b64),
          })).filter((m) => m.position && m.index);
          pyLog(`tessellateViaFusion: parsed ${meshes.length} mesh(es)`);
          resolve({ success: true, meshes, stats });
        } catch (e) {
          resolve({ success: false, meshes: [], message: `tess_result parse failed: ${e.message}` });
        }
      },
    });

    // Ship the STEP text in chunks (same wire contract as the Send-to-Fusion
    // import flow — Python's generate_* handlers don't care about mode).
    try {
      sendToPython('generate_start', { totalChunks });
      for (let i = 0; i < totalChunks; i++) {
        const data = envelope.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        sendToPython('generate_chunk', { index: i, data });
        if (onProgress && (i + 1) % 10 === 0) {
          onProgress({ msg: `Sending STEP to Fusion… ${Math.round(((i + 1) / totalChunks) * 100)}%` });
        }
      }
      sendToPython('generate_finish', {});
    } catch (e) {
      clearTimeout(timer);
      detach();
      resolve({ success: false, meshes: [], message: `chunked send failed: ${e.message}` });
    }
  });
}

/* Decode a base64-encoded little-endian Float32 buffer into a Float32Array. */
function b64ToFloat32(b64) {
  if (!b64) return null;
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(buf);
}

/* Decode a base64-encoded little-endian Uint32 buffer into a Uint32Array. */
function b64ToUint32(b64) {
  if (!b64) return null;
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Uint32Array(buf);
}

/** True if the loader script (the global factory) was found on window. */
export function isAvailable() {
  return typeof window !== 'undefined' && typeof window.occtimportjs === 'function';
}

/**
 * One-time async load of the WASM module. Subsequent calls return the
 * cached instance — both the JS factory and the WASM binary load just
 * once per palette session.
 */
export async function loadOcct() {
  if (_occtModule) return _occtModule;
  if (_occtPromise) return _occtPromise;
  if (!isAvailable()) {
    throw new Error(
      'occt-import-js not loaded. Add the <script src="…/occt-import-js.js"> '
      + 'tag to step_editor_palette.html or define window.occtimportjs before '
      + 'opening the palette.'
    );
  }
  // Optional: where to fetch the .wasm from. Default uses jsDelivr CDN —
  // override window.OCCT_BASE_URL to vendor locally (must end with '/').
  const baseUrl = (typeof window !== 'undefined' && window.OCCT_BASE_URL)
    || 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.22/dist/';

  _occtPromise = window.occtimportjs({
    locateFile: (path) => baseUrl + path,
  }).then((mod) => {
    _occtModule = mod;
    return mod;
  });
  return _occtPromise;
}

/**
 * Tessellate the supplied STEP file text into Three.js-ready meshes.
 *
 * occt-import-js wants a Uint8Array of the file bytes. We encode the
 * string the palette is holding in memory rather than re-fetching it
 * from disk so an edited graph (after a scale, etc.) can be visualised
 * without a round-trip.
 *
 * @param {string} stepText  the STEP file as a string
 * @param {object} [opts]    forwarded to occt-import-js
 * @returns {Promise<{success:boolean, meshes:Array, message?:string}>}
 */
export async function tessellate(stepText, opts = null) {
  const occt = await loadOcct();
  const bytes = TEXT_ENCODER.encode(stepText);
  const raw = occt.ReadStepFile(bytes, opts);

  // Normalise the result so callers get the same shape every time.
  if (!raw || raw.success !== true) {
    return { success: false, meshes: [], message: raw?.error || 'occt returned no meshes' };
  }

  const meshes = (raw.meshes || []).map((m) => ({
    name:     m.name || '',
    color:    Array.isArray(m.color) ? m.color : null,
    position: extractAttr(m, 'position'),
    normal:   extractAttr(m, 'normal'),
    index:    extractIndex(m),
  })).filter((m) => m.position && m.index);

  return { success: true, meshes };
}

/* ────────────────────────────────────────────────────────────────────
 * Private — attribute unpacking
 *
 * occt-import-js evolves its output shape across versions. We probe
 * each known location and return the first match, so a CDN bump
 * doesn't silently strand us with an empty mesh.
 * ──────────────────────────────────────────────────────────────────── */

function extractAttr(mesh, kind) {
  const a = mesh?.attributes?.[kind];
  if (a && a.array) return new Float32Array(a.array);
  if (a && Array.isArray(a))     return new Float32Array(a);
  if (mesh && Array.isArray(mesh[kind])) return new Float32Array(mesh[kind]);
  return null;
}

function extractIndex(mesh) {
  const idx = mesh?.index;
  if (idx && idx.array)        return new Uint32Array(idx.array);
  if (Array.isArray(idx))      return new Uint32Array(idx);
  return null;
}
