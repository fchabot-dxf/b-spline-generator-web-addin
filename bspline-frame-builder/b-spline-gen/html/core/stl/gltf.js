/**
 * core/stl/gltf.js -- SMITHSONIAN-BROWSER (SMITHSONIAN-BROWSER-DESIGN.md section 3): a GLB as the SAME triangle soup an STL gives
 * (core/stl/parse.js parseStl's `.soup`: Float32Array, 9 floats per triangle), so a GLB enters the one STL import path.
 * glTF is Y-up, the board is Z-up: every vertex is turned by GLTF_TO_BOARD after its node's world matrix.
 * The loaders (three r128's GLTFLoader + DRACOLoader, pinned to the same r128 the palette loads) are added ON FIRST USE only:
 * a board that never opens a GLB never loads them.
 */

/** The declared turn, glTF (Y-up) -> board (Z-up): +90 degrees about X, (x, y, z) -> (x, -z, y). */
export const GLTF_TO_BOARD = Object.freeze((p) => [p[0], -p[2], p[1]]);

export const GLTF_LOADER_URLS = Object.freeze({
  gltf: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
  draco: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/DRACOLoader.js',
  decoderPath: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/gltf/',
});

/** A position attribute's reader: a plain BufferAttribute (array + itemSize) or an InterleavedBufferAttribute (data.stride + offset). */
function positionReader(attr) {
  if (attr.isInterleavedBufferAttribute) {
    const a = attr.data.array, stride = attr.data.stride, off = attr.offset || 0;
    return { count: attr.count ?? Math.floor((a.length - off) / stride), at: (i, k) => a[i * stride + off + k] };
  }
  const a = attr.array, size = attr.itemSize || 3;
  return { count: attr.count ?? Math.floor(a.length / size), at: (i, k) => a[i * size + k] };
}

/** Every mesh of a THREE scene (as GLTFLoader returns it), in world space, turned Z-up, as one triangle soup. */
export function soupFromGltfScene(scene) {
  scene.updateMatrixWorld?.(true);
  const parts = [];
  let total = 0;
  scene.traverse((o) => {
    if (!o || !o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    const g = o.geometry;
    const pos = positionReader(g.attributes.position);
    const idx = g.index && g.index.array ? g.index.array : null;
    const n = idx ? (g.index.count ?? idx.length) : pos.count;
    const tris = Math.floor(n / 3);
    if (!tris) return;
    const m = (o.matrixWorld && o.matrixWorld.elements) || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // column-major
    const out = new Float32Array(tris * 9);
    for (let t = 0; t < tris * 3; t++) {
      const v = idx ? idx[t] : t;
      const x = pos.at(v, 0), y = pos.at(v, 1), z = pos.at(v, 2);
      const w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      const b = GLTF_TO_BOARD(w);
      out[t * 3] = b[0]; out[t * 3 + 1] = b[1]; out[t * 3 + 2] = b[2];
    }
    parts.push(out);
    total += out.length;
  });
  const soup = new Float32Array(total);
  let at = 0;
  for (const p of parts) { soup.set(p, at); at += p.length; }
  return soup;
}

// ── the loaders, on first use ───────────────────────────────────────────────────────────────────────────────────────
let _scripts = null;   // the shared promise: both loader scripts in
let _loader = null;    // one GLTFLoader (one Draco worker pool) for the session

function addScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load the 3D model reader (${src.split('/').pop()}).`));
    document.head.appendChild(s);
  });
}

function ensureLoaderScripts() {
  const T = globalThis.THREE;
  if (!T) return Promise.reject(new Error('three.js is not loaded.'));
  if (T.GLTFLoader && T.DRACOLoader) return Promise.resolve();
  if (!_scripts) {
    _scripts = (async () => {
      if (!globalThis.THREE.GLTFLoader) await addScript(GLTF_LOADER_URLS.gltf);
      if (!globalThis.THREE.DRACOLoader) await addScript(GLTF_LOADER_URLS.draco);
    })();
    _scripts.catch(() => { _scripts = null; }); // offline: a later try loads them again
  }
  return _scripts;
}

/** A GLB's bytes -> its THREE scene (Draco decoded). */
export async function loadGlbScene(arrayBuffer) {
  await ensureLoaderScripts();
  const T = globalThis.THREE;
  if (!_loader) {
    const draco = new T.DRACOLoader();
    draco.setDecoderPath(GLTF_LOADER_URLS.decoderPath);
    _loader = new T.GLTFLoader();
    _loader.setDRACOLoader(draco);
  }
  const loader = _loader;
  return new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, '', (gltf) => resolve(gltf.scene), (e) => reject(e instanceof Error ? e : new Error(`This GLB cannot be read${e && e.message ? `: ${e.message}` : '.'}`)));
  });
}

/** Free a loaded scene's geometries / materials / textures (the soup or the preview copy has what it needs). */
export function disposeGltfScene(scene) {
  scene?.traverse?.((o) => {
    o.geometry?.dispose?.();
    for (const m of [].concat(o.material || [])) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose?.();
      m.dispose?.();
    }
  });
}

/** Test hook. */
export function _resetGltfLoaderForTests() { _scripts = null; _loader = null; }
