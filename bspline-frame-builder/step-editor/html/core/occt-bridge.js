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

let _occtModule = null;        // resolved factory instance
let _occtPromise = null;       // in-flight load
const TEXT_ENCODER = new TextEncoder();

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
