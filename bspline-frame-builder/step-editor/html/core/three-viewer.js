/**
 * three-viewer.js — Three.js renderer for tessellated STEP meshes.
 *
 * SELF-CONTAINED: no imports from sibling modules. Three.js is loaded
 * as a global (window.THREE) by the palette HTML. The actual mesh data
 * comes from outside this module — typically core/occt-bridge.js, but
 * core/stp-tessellate.js (our hand-rolled B-spline tessellator) emits
 * the same shape and works as a drop-in for files that don't need full
 * occt coverage.
 *
 * Input shape (per mesh):
 *   { name?, color?, position: Float32Array,
 *                    normal:   Float32Array,
 *                    index:    Uint32Array }
 *
 * Camera model: spherical-coordinate orbit around an auto-computed
 * target. Drag to rotate, wheel to zoom. No pan in v1.
 */

const T = (typeof window !== 'undefined') ? window.THREE : null;

// Fallback palette when a mesh arrives without an explicit colour.
const FALLBACK_COLOURS = [
  0xf59e0b, 0x3b82f6, 0x10b981, 0xec4899,
  0xfbbf24, 0x06b6d4, 0xa855f7, 0xef4444,
];

let scene    = null;
let camera   = null;
let renderer = null;
let canvas   = null;
let resizeObs = null;
let frame    = 0;

const meshObjects = [];   // [{ mesh, name, baseColor, originalSize }]

const orbit = {
  target: null,            // THREE.Vector3
  azimuth: Math.PI / 4,
  polar:   Math.PI / 3,
  distance: 1000,
};

const drag = { active: false, lastX: 0, lastY: 0 };

/* ────────────────────────────────────────────────────────────────────
 * Public API
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Bootstrap the scene on the supplied <canvas>. Idempotent — calling
 * twice disposes the old scene and rebuilds.
 *
 * Adds: ambient + directional lights, an AxesHelper at the origin, the
 * orbit-camera mouse handlers, and a ResizeObserver so the renderer
 * follows the canvas size when the palette is resized or docked.
 */
export function init(canvasEl) {
  if (!T) {
    console.warn('[three-viewer] window.THREE not loaded; viewer disabled.');
    return false;
  }
  if (renderer) dispose();

  canvas = canvasEl;
  scene = new T.Scene();
  // Light theme — mirrors --canvas-bg in step-editor.css so the canvas
  // blends with the rest of the palette. Three.js needs the colour as
  // a number (0xRRGGBB), not the CSS variable.
  scene.background = new T.Color(0xe8eaed);

  const w = canvas.clientWidth  || 800;
  const h = canvas.clientHeight || 600;

  camera = new T.PerspectiveCamera(50, w / h, 0.1, 1e7);
  orbit.target = new T.Vector3(0, 0, 0);
  applyOrbit();

  renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(w, h, false);

  // Lighting — ambient for fill, directional for shading. We attach
  // the directional to the camera so the highlight always sits where
  // the user expects it to be (no dark side after orbiting around).
  const ambient = new T.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);
  const dir = new T.DirectionalLight(0xffffff, 0.8);
  dir.position.set(1, 1, 1);
  scene.add(dir);
  scene.add(dir.target);
  // Re-aim the directional light so it tracks the camera each frame.
  scene.userData._dirLight = dir;

  const axes = new T.AxesHelper(50);
  scene.add(axes);

  attachMouseControls();
  resizeObs = new ResizeObserver(() => onResize());
  resizeObs.observe(canvas);

  const tick = () => {
    if (!renderer) return;
    // Light follows camera direction.
    if (camera && scene.userData._dirLight) {
      const d = scene.userData._dirLight;
      d.position.copy(camera.position);
      d.target.position.copy(orbit.target);
    }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return true;
}

/** Expose the THREE.Scene so add-on modules (text preview, future
 *  overlays) can mount their own helpers without re-implementing the
 *  camera/light/render pipeline. */
export function getScene() {
  return scene;
}

/** Tear down the scene and unbind event listeners. */
export function dispose() {
  cancelAnimationFrame(frame); frame = 0;
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
  detachMouseControls();
  for (const m of meshObjects) {
    scene && scene.remove(m.mesh);
    if (m.mesh.geometry) m.mesh.geometry.dispose();
    if (m.mesh.material) m.mesh.material.dispose();
  }
  meshObjects.length = 0;
  if (renderer) { renderer.dispose(); renderer = null; }
  scene = null;
  camera = null;
  canvas = null;
}

/**
 * Replace the current mesh set with `meshes`. Each entry is the shape
 * documented at the top of this file. Camera re-frames on the union
 * bounding box so the new content fits in view.
 *
 * @param {Array} meshes
 */
export function setMeshes(meshes) {
  if (!scene || !T) return;

  for (const m of meshObjects) {
    scene.remove(m.mesh);
    if (m.mesh.geometry) m.mesh.geometry.dispose();
    if (m.mesh.material) m.mesh.material.dispose();
  }
  meshObjects.length = 0;

  if (!meshes || !meshes.length) { refitCamera(null); return; }

  const totalBox = new T.Box3();

  for (let i = 0; i < meshes.length; i++) {
    const src = meshes[i];
    if (!src.position || !src.index) continue;

    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.BufferAttribute(src.position, 3));
    if (src.normal && src.normal.length === src.position.length) {
      geom.setAttribute('normal', new T.BufferAttribute(src.normal, 3));
    }
    geom.setIndex(new T.BufferAttribute(src.index, 1));
    if (!src.normal) geom.computeVertexNormals();
    geom.computeBoundingBox();

    const baseColor = src.color
      ? new T.Color(src.color[0], src.color[1], src.color[2])
      : new T.Color(FALLBACK_COLOURS[i % FALLBACK_COLOURS.length]);

    const mat = new T.MeshPhongMaterial({
      color: baseColor,
      shininess: 30,
      flatShading: false,
      side: T.DoubleSide,         // BREP faces aren't always wound consistently
    });

    const mesh = new T.Mesh(geom, mat);
    mesh.userData.name = src.name || `mesh_${i}`;
    scene.add(mesh);
    meshObjects.push({ mesh, name: mesh.userData.name, baseColor: baseColor.clone() });

    if (geom.boundingBox) totalBox.union(geom.boundingBox);
  }

  refitCamera(totalBox.isEmpty() ? null : totalBox);
}

/**
 * Visually emphasise a mesh by name. Pass `null` to clear emphasis.
 * Non-matching meshes fade to a darker version of their base colour.
 *
 * @param {string|null} name
 */
export function highlightByName(name) {
  for (const m of meshObjects) {
    const sel = name && m.name === name;
    if (sel) {
      m.mesh.material.color.copy(m.baseColor);
      m.mesh.material.opacity = 1.0;
      m.mesh.material.transparent = false;
    } else {
      m.mesh.material.color.copy(m.baseColor).multiplyScalar(0.4);
      m.mesh.material.opacity = name ? 0.5 : 1.0;
      m.mesh.material.transparent = name ? true : false;
    }
    m.mesh.material.needsUpdate = true;
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Private — camera & input
 * ──────────────────────────────────────────────────────────────────── */

function applyOrbit() {
  if (!camera || !orbit.target) return;
  const r = orbit.distance;
  const sp = Math.sin(orbit.polar), cp = Math.cos(orbit.polar);
  const sa = Math.sin(orbit.azimuth), ca = Math.cos(orbit.azimuth);
  camera.position.set(
    orbit.target.x + r * sp * ca,
    orbit.target.y + r * cp,
    orbit.target.z + r * sp * sa,
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(orbit.target);
}

function refitCamera(bbox) {
  if (!camera) return;
  if (!bbox) {
    orbit.target.set(0, 0, 0);
    orbit.distance = 100;
    applyOrbit();
    return;
  }
  const centre = bbox.getCenter(new T.Vector3());
  const size   = Math.max(bbox.getSize(new T.Vector3()).length(), 1);
  orbit.target.copy(centre);
  orbit.distance = size * 1.5;
  camera.near = Math.max(orbit.distance / 1000, 0.1);
  camera.far  = orbit.distance * 100;
  camera.updateProjectionMatrix();
  applyOrbit();
}

function onResize() {
  if (!renderer || !camera || !canvas) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const onDown = (e) => {
  if (e.button !== 0) return;
  drag.active = true;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
};
const onMove = (e) => {
  if (!drag.active) return;
  const dx = e.clientX - drag.lastX;
  const dy = e.clientY - drag.lastY;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  orbit.azimuth -= dx * 0.005;
  orbit.polar    = Math.max(0.01, Math.min(Math.PI - 0.01, orbit.polar + dy * 0.005));
  applyOrbit();
};
const onUp = () => { drag.active = false; };
const onWheel = (e) => {
  e.preventDefault();
  const k = Math.exp(e.deltaY * 0.001);
  orbit.distance = Math.max(0.1, orbit.distance * k);
  if (camera) {
    camera.near = Math.max(orbit.distance / 1000, 0.1);
    camera.far  = orbit.distance * 100;
    camera.updateProjectionMatrix();
  }
  applyOrbit();
};

function attachMouseControls() {
  if (!canvas) return;
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup',   onUp);
  canvas.addEventListener('wheel',     onWheel, { passive: false });
}

function detachMouseControls() {
  if (canvas) {
    canvas.removeEventListener('mousedown', onDown);
    canvas.removeEventListener('wheel',     onWheel);
  }
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup',   onUp);
}
